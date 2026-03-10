use std::net::TcpListener;
use std::sync::Mutex;
use std::thread;
use std::time::Duration;
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

pub struct SidecarManager {
    process: Mutex<Option<CommandChild>>,
    port: Mutex<u16>,
}

impl SidecarManager {
    pub fn new() -> Self {
        SidecarManager {
            process: Mutex::new(None),
            port: Mutex::new(0),
        }
    }

    /// Find a free TCP port by asking the OS to bind on port 0.
    fn find_free_port() -> u16 {
        TcpListener::bind("127.0.0.1:0")
            .expect("Failed to bind to a free port")
            .local_addr()
            .expect("Failed to get local address")
            .port()
    }

    /// Return the port the backend was started on (0 if not started yet).
    pub fn port(&self) -> u16 {
        *self.port.lock().unwrap()
    }

    /// Start the backend sidecar on a free port.
    pub fn start(&self, app: &tauri::AppHandle) -> Result<u16, String> {
        let mut process_guard = self.process.lock().unwrap();

        if process_guard.is_some() {
            return Ok(*self.port.lock().unwrap());
        }

        let port = Self::find_free_port();
        *self.port.lock().unwrap() = port;

        println!("Starting backend sidecar on port {}...", port);

        let sidecar = app
            .shell()
            .sidecar("gemi-backend")
            .map_err(|e| format!("Failed to create sidecar command: {}", e))?
            .env("GEMI_BACKEND_PORT", port.to_string());

        let (mut rx, child) = sidecar
            .spawn()
            .map_err(|e| format!("Failed to spawn sidecar: {}", e))?;

        tauri::async_runtime::spawn(async move {
            use tauri_plugin_shell::process::CommandEvent;
            while let Some(event) = rx.recv().await {
                match event {
                    CommandEvent::Stdout(line) => {
                        println!("[backend] {}", String::from_utf8_lossy(&line));
                    }
                    CommandEvent::Stderr(line) => {
                        eprintln!("[backend] {}", String::from_utf8_lossy(&line));
                    }
                    CommandEvent::Error(err) => {
                        eprintln!("[backend error] {}", err);
                    }
                    CommandEvent::Terminated(status) => {
                        println!("[backend] Process terminated: {:?}", status);
                        break;
                    }
                    _ => {}
                }
            }
        });

        *process_guard = Some(child);
        println!("Backend sidecar started on port {}", port);
        Ok(port)
    }

    /// Wait for the backend to respond to health checks.
    pub fn wait_for_health(&self, max_retries: u32) -> Result<(), String> {
        let port = *self.port.lock().unwrap();
        let url = format!("http://127.0.0.1:{}/api/v1/utils/health-check/", port);

        println!("Waiting for backend on port {}...", port);

        for i in 0..max_retries {
            thread::sleep(Duration::from_secs(1));
            match reqwest::blocking::get(&url) {
                Ok(r) if r.status().is_success() => {
                    println!("Backend is healthy on port {}", port);
                    return Ok(());
                }
                _ => println!("Not ready yet ({}/{})", i + 1, max_retries),
            }
        }

        Err(format!("Backend on port {} failed to become healthy", port))
    }

    /// Stop the backend sidecar.
    pub fn stop(&self) -> Result<(), String> {
        let mut process_guard = self.process.lock().unwrap();
        if let Some(child) = process_guard.take() {
            println!("Stopping backend sidecar...");
            child.kill().map_err(|e| format!("Failed to kill sidecar: {}", e))?;
        }
        Ok(())
    }
}
