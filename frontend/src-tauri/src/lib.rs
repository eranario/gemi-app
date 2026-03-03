// Sidecar manager only used in production builds
#[cfg(not(debug_assertions))]
mod sidecar_manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(debug_assertions)]
    {
        // DEVELOPMENT MODE
        // Backend is started separately via npm script
        println!("Running in DEVELOPMENT mode - backend should be started separately");

        tauri::Builder::default()
            .plugin(tauri_plugin_shell::init())
            .plugin(tauri_plugin_dialog::init())
            .setup(|app| {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
                Ok(())
            })
            .run(tauri::generate_context!())
            .expect("error while running tauri application");
    }

    #[cfg(not(debug_assertions))]
    {
        // PRODUCTION MODE
        // Use sidecar to manage backend
        use sidecar_manager::SidecarManager;
        use std::sync::Arc;

        let sidecar = Arc::new(SidecarManager::new(8000));
        let sidecar_for_exit = Arc::clone(&sidecar);

        tauri::Builder::default()
            .plugin(tauri_plugin_shell::init())
            .plugin(tauri_plugin_dialog::init())
            .setup(move |app| {
                let app_handle = app.handle().clone();
                if let Err(e) = sidecar.start(&app_handle) {
                    eprintln!("Failed to start backend: {}", e);
                } else {
                    if let Err(e) = sidecar.wait_for_health(30) {
                        eprintln!("Backend health check failed: {}", e);
                    }
                }
                Ok(())
            })
            .on_window_event(move |_window, event| {
                if let tauri::WindowEvent::Destroyed = event {
                    if let Err(e) = sidecar_for_exit.stop() {
                        eprintln!("Failed to stop backend: {}", e);
                    }
                }
            })
            .run(tauri::generate_context!())
            .expect("error while running tauri application");
    }
}
