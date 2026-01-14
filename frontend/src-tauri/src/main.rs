// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod sidecar_manager;

use sidecar_manager::SidecarManager;
use std::sync::Mutex;
use tauri::Manager;

struct AppState {
    sidecar: Mutex<SidecarManager>,
}

#[tauri::command]
fn get_backend_status(state: tauri::State<AppState>) -> Result<String, String> {
    let manager = state.sidecar.lock().unwrap();
    manager.status()
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let sidecar = SidecarManager::new(8000);

            // Start the backend sidecar
            match sidecar.start(&app.handle()) {
                Ok(_) => {
                    println!("Backend starting...");

                    // Wait for it to be healthy
                    match sidecar.wait_for_health(30) {
                        Ok(_) => println!("Backend is ready!"),
                        Err(e) => eprintln!("Backend health check failed: {}", e),
                    }
                }
                Err(e) => {
                    eprintln!("Failed to start backend: {}", e);
                }
            }

            app.manage(AppState {
                sidecar: Mutex::new(sidecar),
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                let state = window.state::<AppState>();
                let manager = state.sidecar.lock().unwrap();

                println!("Shutting down backend...");
                if let Err(e) = manager.stop() {
                    eprintln!("Error stopping backend: {}", e);
                }
            }
        })
        .invoke_handler(tauri::generate_handler![get_backend_status])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
