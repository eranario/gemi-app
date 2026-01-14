# SQLite Desktop Migration Plan

This document outlines the implementation plan for removing Docker dependency from the GEMI desktop application by switching to SQLite and bundling the Python backend as an executable.

## Overview

**Previous Architecture:**
```
Tauri App → Docker Compose → PostgreSQL Container + FastAPI Container
```

**New Architecture:**
```
Tauri App → Python Sidecar (PyInstaller executable) → SQLite (local file)
```

**Benefits:**
- No Docker dependency for end users
- Smaller bundle size (~50MB vs ~500MB+ with Docker images)
- Faster startup (no container orchestration)
- Simpler installation (single executable)
- Works offline without Docker daemon
- Single database for both dev and production (simpler maintenance)

---

## Phase 1: Backend SQLite Support ✅ COMPLETED

### 1.1 Dependencies Updated
- Added `aiosqlite>=0.19.0` to `backend/pyproject.toml`
- Removed `psycopg[binary]` (PostgreSQL driver)

### 1.2 Configuration Updated (`backend/app/core/config.py`)
- Removed PostgreSQL settings (`POSTGRES_*`)
- Added `SQLITE_DB_PATH` setting
- Added default values for required fields (for bundled app):
  - `PROJECT_NAME = "GEMI"`
  - `FIRST_SUPERUSER = "admin@example.com"`
  - `FIRST_SUPERUSER_PASSWORD = "adminpassword"`
- Platform-specific default database paths:
  - macOS: `~/Library/Application Support/GEMI/gemi.db`
  - Windows: `%APPDATA%/GEMI/gemi.db`
  - Linux: `~/.local/share/gemi/gemi.db`

### 1.3 Database Layer Updated (`backend/app/core/db.py`)
- Added `check_same_thread=False` for SQLite compatibility with FastAPI
- Added `create_db_and_tables()` function

### 1.4 Alembic Updated (`backend/app/alembic/env.py`)
- Added `render_as_batch=True` for SQLite ALTER TABLE support

### 1.5 FastAPI Startup Updated (`backend/app/main.py`)
- Added lifespan context manager
- Tables created automatically on startup
- Initial superuser created on startup

### 1.6 Environment Updated (`.env`)
- Removed PostgreSQL settings
- Added `SQLITE_DB_PATH` (optional)

---

## Phase 2: PyInstaller Configuration ✅ COMPLETED

### 2.1 Created PyInstaller spec file

**File:** `backend/gemi-backend.spec`

### 2.2 Entry point script

**File:** `backend/run_server.py`

> **Important:** The app must be imported directly, not as a string reference.
> PyInstaller cannot resolve string imports like `"app.main:app"` at runtime.

```python
#!/usr/bin/env python3
"""Entry point for the bundled GEMI backend server."""

import uvicorn

# Import app directly so PyInstaller can bundle it
from app.main import app


def main():
    uvicorn.run(
        app,
        host="127.0.0.1",
        port=8000,
        log_level="info",
    )


if __name__ == "__main__":
    main()
```

### 2.3 Build and test

```bash
cd backend

# Build the executable
pyinstaller --clean gemi-backend.spec

# Test it
./dist/gemi-backend

# Verify health check
curl http://localhost:8000/api/v1/utils/health-check/
```

The executable will be at `dist/gemi-backend` (or `dist/gemi-backend.exe` on Windows).

---

## Phase 3: Tauri Sidecar Integration ✅ COMPLETED

### 3.1 Updated tauri.conf.json

Replaced Docker resources with sidecar binary:

```json
{
  "bundle": {
    "externalBin": ["binaries/gemi-backend"],
    "linux": {
      "deb": {
        "depends": []
      }
    }
  }
}
```

### 3.2 Created sidecar_manager.rs

**File:** `frontend/src-tauri/src/sidecar_manager.rs`

Replaced `docker_manager.rs` with a simpler sidecar manager that:
- Spawns the Python executable using Tauri's shell plugin
- Waits for health check endpoint
- Logs backend stdout/stderr
- Gracefully shuts down on app close

### 3.3 Updated main.rs

- Removed Docker-related code
- Uses sidecar manager
- Registers `tauri_plugin_shell`

### 3.4 Updated Cargo.toml

Added dependencies:
- `tauri-plugin-shell = "2"`
- `reqwest = { version = "0.12", features = ["blocking"] }`

### 3.5 Updated capabilities

**File:** `frontend/src-tauri/capabilities/default.json`

Added shell permissions for sidecar execution:
```json
{
  "permissions": [
    "core:default",
    "shell:allow-spawn",
    "shell:allow-kill",
    {
      "identifier": "shell:allow-execute",
      "allow": [{ "name": "gemi-backend", "sidecar": true }]
    }
  ]
}
```

### 3.6 Binary naming convention

Sidecar binaries must be named with the target triple suffix:

```
frontend/src-tauri/binaries/
├── gemi-backend-x86_64-unknown-linux-gnu      # Linux
├── gemi-backend-x86_64-apple-darwin           # macOS Intel
├── gemi-backend-aarch64-apple-darwin          # macOS Apple Silicon
└── gemi-backend-x86_64-pc-windows-msvc.exe    # Windows
```

Copy command for Linux:
```bash
cp backend/dist/gemi-backend frontend/src-tauri/binaries/gemi-backend-x86_64-unknown-linux-gnu
```

### 3.7 Updated Frontend

- Created `BackendStatus.tsx` (replaces `DockerStatus.tsx`)
- Removed Docker-specific UI and messaging
- Simplified to just wait for backend health check

---

## Phase 4: Cleanup ✅ COMPLETED

### Files Removed
- `frontend/src-tauri/src/docker_manager.rs`
- `frontend/src/components/System/DockerStatus.tsx`

### Files to Remove (optional)
- `docker-compose.desktop.yml` - no longer needed
- `.env.desktop` - no longer needed

---

## Build Instructions

### Development

```bash
# Terminal 1: Run backend directly
cd backend
uv run fastapi dev app/main.py

# Terminal 2: Run frontend
cd frontend
npm run dev
```

### Production Build

```bash
# 1. Build backend executable
cd backend
pyinstaller --clean gemi-backend.spec

# 2. Copy to Tauri binaries (adjust target triple for your platform)
cp dist/gemi-backend ../frontend/src-tauri/binaries/gemi-backend-x86_64-unknown-linux-gnu

# 3. Build Tauri app
cd ../frontend
npm run tauri:build
```

Output locations:
- **Linux AppImage:** `frontend/src-tauri/target/release/bundle/appimage/`
- **Linux .deb:** `frontend/src-tauri/target/release/bundle/deb/`
- **macOS .app:** `frontend/src-tauri/target/release/bundle/macos/`
- **Windows .exe:** `frontend/src-tauri/target/release/bundle/nsis/`

---

## Testing Checklist

### Backend Tests
- [x] Backend starts with SQLite
- [x] Database file created in correct location
- [x] Tables created automatically
- [x] Health check endpoint works
- [x] CRUD operations work
- [x] Data persists between restarts

### Integration Tests
- [x] Tauri starts backend sidecar
- [x] Health check passes
- [x] Frontend connects to backend
- [x] Login/logout works
- [x] Graceful shutdown

### Platform Tests
- [x] Linux build works
- [ ] macOS build works
- [ ] Windows build works

---

## File Changes Summary

| File | Action | Status |
|------|--------|--------|
| `backend/pyproject.toml` | Modified | ✅ |
| `backend/app/core/config.py` | Modified | ✅ |
| `backend/app/core/db.py` | Modified | ✅ |
| `backend/app/alembic/env.py` | Modified | ✅ |
| `backend/app/main.py` | Modified | ✅ |
| `.env` | Modified | ✅ |
| `backend/gemi-backend.spec` | Created | ✅ |
| `backend/run_server.py` | Created | ✅ |
| `backend/build-desktop.sh` | Created | ✅ |
| `frontend/src-tauri/tauri.conf.json` | Modified | ✅ |
| `frontend/src-tauri/Cargo.toml` | Modified | ✅ |
| `frontend/src-tauri/src/main.rs` | Modified | ✅ |
| `frontend/src-tauri/src/sidecar_manager.rs` | Created | ✅ |
| `frontend/src-tauri/capabilities/default.json` | Modified | ✅ |
| `frontend/src/components/System/BackendStatus.tsx` | Created | ✅ |
| `frontend/src/components/System/index.ts` | Modified | ✅ |
| `frontend/src/routes/__root.tsx` | Modified | ✅ |
| `frontend/src-tauri/src/docker_manager.rs` | Deleted | ✅ |
| `frontend/src/components/System/DockerStatus.tsx` | Deleted | ✅ |

---

## Default Credentials

For the bundled desktop app:
- **Email:** `admin@example.com`
- **Password:** `adminpassword`

These can be overridden via environment variables if needed.

---

## Troubleshooting

### "Address already in use" error

If you see `error while attempting to bind on address ('127.0.0.1', 8000): address already in use`:

```bash
# Kill the existing process on port 8000
fuser -k 8000/tcp
```

The sidecar manager now automatically kills existing processes on startup, but this may be needed if a previous run crashed.

### "Incorrect email or password" error

If login fails with correct credentials, the database may have been created with old/different credentials. Reset it:

```bash
# Delete the database (Linux)
rm ~/.local/share/gemi/gemi.db

# macOS
rm ~/Library/Application\ Support/GEMI/gemi.db

# Windows
del %APPDATA%\GEMI\gemi.db
```

Then restart the app - it will recreate the database with the default credentials.

### bcrypt version warning

The warning `error reading bcrypt version` from passlib is harmless and can be ignored. It's a compatibility notice between passlib and newer bcrypt versions - password hashing still works correctly.
