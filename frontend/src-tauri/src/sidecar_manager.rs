use std::process::Command;
use std::sync::Mutex;
use std::thread;
use std::time::Duration;
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

pub struct SidecarManager {
    process: Mutex<Option<CommandChild>>,
    port: u16,
}

impl SidecarManager {
    pub fn new(port: u16) -> Self {
        SidecarManager {
            process: Mutex::new(None),
            port,
        }
    }

    /// Kill any existing process using the port
    fn kill_existing_process(&self) {
        println!("Checking for existing process on port {}...", self.port);

        #[cfg(unix)]
        {
            // Use fuser to kill process on the port (Linux/macOS)
            let _ = Command::new("fuser")
                .args(["-k", &format!("{}/tcp", self.port)])
                .output();
        }

        #[cfg(windows)]
        {
            // Windows: find and kill process using netstat and taskkill
            if let Ok(output) = Command::new("netstat")
                .args(["-ano", "-p", "TCP"])
                .output()
            {
                let output_str = String::from_utf8_lossy(&output.stdout);
                for line in output_str.lines() {
                    if line.contains(&format!(":{}", self.port)) && line.contains("LISTENING") {
                        if let Some(pid) = line.split_whitespace().last() {
                            let _ = Command::new("taskkill")
                                .args(["/F", "/PID", pid])
                                .output();
                        }
                    }
                }
            }
        }

        // Give it a moment to release the port
        thread::sleep(Duration::from_millis(500));
    }

    /// Start the backend sidecar using Tauri's shell plugin
    pub fn start(&self, app: &tauri::AppHandle) -> Result<(), String> {
        let mut process_guard = self.process.lock().unwrap();

        if process_guard.is_some() {
            return Ok(()); // Already running
        }

        // Kill any existing process on the port
        self.kill_existing_process();

        println!("Starting backend sidecar...");

        let sidecar = app
            .shell()
            .sidecar("gemi-backend")
            .map_err(|e| format!("Failed to create sidecar command: {}", e))?;

        let (mut rx, child) = sidecar
            .spawn()
            .map_err(|e| format!("Failed to spawn sidecar: {}", e))?;

        // Spawn a thread to handle sidecar output
        tauri::async_runtime::spawn(async move {
            use tauri_plugin_shell::process::CommandEvent;
            while let Some(event) = rx.recv().await {
                match event {
                    CommandEvent::Stdout(line) => {
                        let line_str = String::from_utf8_lossy(&line);
                        println!("[backend] {}", line_str);
                    }
                    CommandEvent::Stderr(line) => {
                        let line_str = String::from_utf8_lossy(&line);
                        eprintln!("[backend] {}", line_str);
                    }
                    CommandEvent::Error(err) => {
                        eprintln!("[backend error] {}", err);
                    }
                    CommandEvent::Terminated(status) => {
                        println!("[backend] Process terminated with status: {:?}", status);
                        break;
                    }
                    _ => {}
                }
            }
        });

        *process_guard = Some(child);
        println!("Backend sidecar started");

        Ok(())
    }

    /// Wait for the backend to be healthy
    pub fn wait_for_health(&self, max_retries: u32) -> Result<(), String> {
        let url = format!("http://127.0.0.1:{}/api/v1/utils/health-check/", self.port);

        println!("Waiting for backend to be healthy...");

        for i in 0..max_retries {
            thread::sleep(Duration::from_secs(1));

            match reqwest::blocking::get(&url) {
                Ok(response) if response.status().is_success() => {
                    println!("Backend is healthy!");
                    return Ok(());
                }
                Ok(response) => {
                    println!(
                        "Backend returned {}, retrying... ({}/{})",
                        response.status(),
                        i + 1,
                        max_retries
                    );
                }
                Err(_) => {
                    println!("Backend not ready, retrying... ({}/{})", i + 1, max_retries);
                }
            }
        }

        Err("Backend failed to become healthy".to_string())
    }

    /// Stop the backend sidecar
    pub fn stop(&self) -> Result<(), String> {
        let mut process_guard = self.process.lock().unwrap();

        if let Some(child) = process_guard.take() {
            println!("Stopping backend sidecar...");

            child
                .kill()
                .map_err(|e| format!("Failed to kill sidecar: {}", e))?;

            println!("Backend sidecar stopped");
        }

        Ok(())
    }

    /// Get backend status
    pub fn status(&self) -> Result<String, String> {
        let url = format!("http://127.0.0.1:{}/api/v1/utils/health-check/", self.port);

        match reqwest::blocking::get(&url) {
            Ok(response) if response.status().is_success() => Ok("healthy".to_string()),
            Ok(response) => Ok(format!("unhealthy: {}", response.status())),
            Err(e) => Ok(format!("unreachable: {}", e)),
        }
    }
}
