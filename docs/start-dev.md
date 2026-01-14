# Phase 1: Tauri Development Environment Setup

Complete guide to setting up Tauri desktop app development with your existing Docker-based FastAPI + React application.

---

## Overview

**What This Phase Achieves:**
- ✅ Tauri desktop app running on your laptop (via X11 forwarding)
- ✅ Backend still running in Docker on remote machine
- ✅ Hot-reload development workflow
- ✅ Native desktop window instead of browser

**Architecture:**
```
Remote Machine (Arch Linux - TTY)
├── Docker: PostgreSQL + FastAPI Backend
└── Tauri App (renders via X11 forwarding)
    └── Displays on ↓

Local Laptop (Arch Linux - Wayland)
└── Desktop Window showing GEMI app
```

---

## Prerequisites

### System Requirements

- **Remote Machine:** Arch Linux (headless/TTY is fine)
- **Local Machine:** Arch Linux with GUI (X11 or Wayland)
- **SSH Access:** Between local and remote machines
- **Docker:** Already installed on remote machine

---

## Part 1: Install Dependencies

### On Remote Machine (Arch Linux)

SSH into your remote machine and install all required dependencies:

```bash
# Connect to remote machine
ssh gemi-opti-eth

# Update system first
sudo pacman -Syu
```

#### 1. Install Node.js and npm

```bash
sudo pacman -S nodejs npm
```

Verify installation:
```bash
node --version  # Should show v20.x.x or higher
npm --version   # Should show 10.x.x or higher
```

#### 2. Install Rust

```bash
# Install Rust using rustup
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Follow prompts (choose default installation)

# Load Rust into current session
source $HOME/.cargo/env

# Add to shell for future sessions
echo 'source $HOME/.cargo/env' >> ~/.bashrc
```

Verify installation:
```bash
rustc --version  # Should show rustc 1.x.x
cargo --version  # Should show cargo 1.x.x
```

#### 3. Install Tauri System Dependencies

```bash
sudo pacman -S webkit2gtk base-devel curl wget file openssl \
  appmenu-gtk-module gtk3 libappindicator-gtk3 librsvg libvips \
  xorg-xauth xorg-xclock
```

**What these packages do:**
- `webkit2gtk` - Web rendering engine for Tauri
- `gtk3` - GUI toolkit
- `xorg-xauth` - X11 authentication for SSH forwarding
- `xorg-xclock` - Testing X11 forwarding

---

### On Local Machine (Arch Linux Laptop)

```bash
# Install X11 authentication support
sudo pacman -S xorg-xauth

# If using Wayland, XWayland should already be installed
# Verify with: 
echo $XDG_SESSION_TYPE  # Should show 'wayland' or 'x11'
```

---

## Part 2: Configure SSH for X11 Forwarding

### On Local Machine

Edit your SSH config file:

```bash
nano ~/.ssh/config
```

Add these two host configurations:

```ssh-config
# For regular development (port forwarding)
Host gemi-opti-eth
    HostName 10.42.0.135
    User earl
    LocalForward 5173 localhost:5173
    LocalForward 8000 localhost: 8000
    LocalForward 8080 localhost:8080
    LocalForward 1080 localhost:1080
    ServerAliveInterval 30
    ServerAliveCountMax 3

# For Tauri development (X11 forwarding)
Host gemi-opti-eth-x11
    HostName 10.42.0.135
    User earl
    ForwardX11 yes
    ForwardX11Trusted yes
    ServerAliveInterval 30
    ServerAliveCountMax 3
```

**Note:** Replace `10.42.0.135` with your remote machine's IP address and `earl` with your username.

---

### On Remote Machine

Enable X11 forwarding in SSH server config:

```bash
# Edit SSH daemon config
sudo nano /etc/ssh/sshd_config
```

Ensure these lines exist and are **not commented out**:

```
X11Forwarding yes
X11DisplayOffset 10
X11UseLocalhost yes
```

Restart SSH daemon: 

```bash
sudo systemctl restart sshd
```

Create `.Xauthority` file:

```bash
touch ~/.Xauthority
chmod 600 ~/.Xauthority
```

---

### Test X11 Forwarding

From your local machine: 

```bash
# Connect with X11 forwarding
ssh gemi-opti-eth-x11

# Verify DISPLAY is set
echo $DISPLAY  # Should show:  localhost:10.0

# Test with simple X11 app
xclock
```

**Expected result:** A clock window should appear on your laptop.  If it does, X11 forwarding works!  ✅

If it doesn't work, troubleshoot:
- Check `$DISPLAY` is not empty
- Verify `xorg-xauth` is installed on both machines
- Check `/etc/ssh/sshd_config` on remote machine

---

## Part 3: Initialize Tauri in Your Project

### Install Frontend Dependencies

```bash
# SSH to remote (regular connection)
ssh gemi-opti-eth

# Navigate to frontend directory
cd ~/gemi/frontend

# Install existing dependencies
npm install
```

### Add Tauri to Project

```bash
# Install Tauri CLI
npm install --save-dev @tauri-apps/cli

# Initialize Tauri
npx tauri init
```

**Answer prompts as follows:**

| Prompt | Answer |
|--------|--------|
| App name | `GEMI` |
| Window title | `GEMI` |
| Web assets location | `../dist` |
| Dev server URL | `http://localhost:5173` |
| Dev server command | `npm run dev` |
| Build command | `npm run build` |

This creates a `src-tauri/` directory with Tauri configuration. 

---

### Update package.json

Edit `frontend/package.json` and update the `scripts` section:

```json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "generate-client": "openapi-ts",
    "tauri": "tauri",
    "tauri:dev":  "GDK_BACKEND=x11 tauri dev"
  }
}
```

**Note:** The `GDK_BACKEND=x11` forces GTK to use X11 backend for proper X11 forwarding.

---

## Part 4: Create Development Startup Script

Create a helper script to start backend services: 

```bash
# On remote machine
nano ~/gemi/start-dev. sh
```

Add this content:

```bash
#!/bin/bash
cd ~/gemi

echo "🚀 Starting GEMI Development Environment..."

# Start backend services
echo "📦 Starting Docker services..."
docker compose up -d backend db mailcatcher

# Wait for services to be healthy
echo "⏳ Waiting for services to be ready..."
sleep 5

# Check if services are running
docker compose ps

echo ""
echo "✅ Backend ready at http://localhost:8000"
echo "📧 Mailcatcher at http://localhost:1080"
echo "📊 API Docs at http://localhost:8000/docs"
echo ""
echo "Now run in X11 SSH session:"
echo "  cd ~/gemi/frontend && npm run tauri:dev"
```

Make it executable:

```bash
chmod +x ~/gemi/start-dev.sh
```

---

## Part 5: Development Workflow

### Starting Your Development Environment

You'll need **2 terminal windows/tabs**:

#### Terminal 1: Start Backend (Regular SSH)

```bash
# From your laptop
ssh gemi-opti-eth

# Run startup script
~/gemi/start-dev.sh
```

**What this does:**
- Starts PostgreSQL database
- Starts FastAPI backend
- Starts Mailcatcher (email testing)

**Verify services are running:**
```bash
docker compose ps
```

All services should show "Up" and "healthy". 

---

#### Terminal 2: Start Tauri App (X11 SSH)

```bash
# From your laptop (new terminal)
ssh gemi-opti-eth-x11

# Navigate to frontend
cd ~/gemi/frontend

# Start Tauri development mode
npm run tauri:dev
```

**What happens:**
1. Vite dev server starts on port 5173
2. Tauri compiles Rust code (first time:  5-10 minutes ☕)
3. Desktop window appears on your laptop showing the app

**First compilation is slow! ** Subsequent runs are much faster (< 30 seconds).

---

### During Development

#### Frontend Changes (React/TypeScript)

1. Edit files in `frontend/src/`
2. Save the file
3. **Auto hot-reload** - changes appear in Tauri window within 1-2 seconds

No restart needed!  ✨

#### Backend Changes (Python/FastAPI)

1. Edit files in `backend/app/`
2.  Restart backend container: 
   ```bash
   # In Terminal 1
   docker compose restart backend
   ```
3. Changes take effect in ~5 seconds

---

### Accessing Your App

**Desktop App:**
- Runs in native window on your laptop
- Title:  "GEMI"
- Default size: 800x600 (resizable)

**Login Credentials:**
- Email: `admin@example.com`
- Password: `password`

**Backend API Docs:**
- Open browser on laptop:  http://localhost:8000/docs
- Interactive Swagger UI for testing API endpoints

**Email Testing:**
- Open browser on laptop: http://localhost:1080
- See all emails sent by the app

---

### Stopping Development Environment

```bash
# In Terminal 1 (regular SSH)
cd ~/gemi
docker compose down
```

**In Terminal 2:** Press `Ctrl+C` to stop Tauri

---

## Part 6: Troubleshooting

### Tauri Window Doesn't Appear

**Check DISPLAY variable:**
```bash
# In X11 SSH session
echo $DISPLAY  # Should show localhost:10.0
```

**Force X11 backend:**
```bash
GDK_BACKEND=x11 npm run tauri:dev
```

**Test with simple app:**
```bash
xclock  # Should show clock on laptop
```

### "vite:  command not found"

You didn't install dependencies: 
```bash
cd ~/gemi/frontend
npm install
```

### Backend Connection Fails

**Check services are running:**
```bash
docker compose ps
```

**Check backend health:**
```bash
curl http://localhost:8000/api/v1/utils/health-check
```

### Port Already in Use

You have another SSH session running:
```bash
# Kill all SSH connections
pkill -f ssh

# Reconnect
ssh gemi-opti-eth-x11
```

### GTK/WebKit Errors

Reinstall dependencies:
```bash
sudo pacman -S webkit2gtk gtk3 libappindicator-gtk3
```

### First Tauri Compilation Takes Forever

This is normal!  First compilation: 
- Downloads and compiles Rust dependencies
- Takes 5-10 minutes
- Subsequent runs: < 30 seconds

**Be patient on first run!** ☕

---

## Part 7: Verification Checklist

After setup, verify everything works:

### ✅ Backend Services

```bash
# Check all services healthy
docker compose ps

# Test API
curl http://localhost:8000/api/v1/utils/health-check
```

### ✅ Frontend Dev Server

```bash
# Should see in Terminal 2: 
# ➜  Local:    http://localhost:5173/
```

### ✅ Tauri Desktop Window

- [ ] Window appears on laptop
- [ ] Shows GEMI login page
- [ ] Can login with admin credentials
- [ ] Navigation works

### ✅ Hot Reload

- [ ] Edit `frontend/src/App.tsx`
- [ ] Save file
- [ ] Window updates automatically

### ✅ X11 Forwarding

```bash
# In X11 SSH session
xclock  # Clock appears on laptop
```

---

## Daily Development Workflow

### Morning Startup

```bash
# Terminal 1: Backend
ssh gemi-opti-eth
~/gemi/start-dev. sh

# Terminal 2: Frontend
ssh gemi-opti-eth-x11
cd ~/gemi/frontend
npm run tauri:dev
```

### During the Day

- Code in your favorite editor (VSCode, vim, etc.)
- Frontend changes auto-reload
- Backend changes:  `docker compose restart backend`

### End of Day

```bash
# Stop services
cd ~/gemi
docker compose down
```

---

## Project Structure

After Tauri initialization:

```
gemi/
├── backend/
│   ├── app/                    # FastAPI application
│   └── Dockerfile
├── frontend/
│   ├── src/                    # React application
│   │   ├── components/
│   │   ├── pages/
│   │   └── App.tsx
│   ├── src-tauri/              # ← NEW: Tauri backend
│   │   ├── src/
│   │   │   └── main.rs         # Rust entry point
│   │   ├── Cargo.toml          # Rust dependencies
│   │   └── tauri.conf.json     # Tauri configuration
│   ├── dist/                   # Vite build output
│   ├── package.json
│   └── vite.config.ts
└── docker-compose.yml
```

---

## Tauri Configuration

Your `frontend/src-tauri/tauri.conf. json`:

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "GEMI",
  "version": "0.1.0",
  "identifier": "com.tauri.dev",
  "build": {
    "frontendDist": "../dist",
    "devUrl": "http://localhost:5173",
    "beforeDevCommand": "npm run dev",
    "beforeBuildCommand": "npm run build"
  },
  "app": {
    "windows": [
      {
        "title": "GEMI",
        "width": 800,
        "height": 600,
        "resizable": true,
        "fullscreen": false
      }
    ],
    "security": {
      "csp": null
    }
  }
}
```

**Key settings:**
- `devUrl`: Points to Vite dev server
- `frontendDist`: Where production build outputs
- `beforeDevCommand`: Starts Vite before Tauri
- Window size: 800x600 (adjustable in code)

---

## Understanding the Architecture

### Development Mode (Phase 1 - Current)

```
┌─────────────────────────────────────────┐
│ Remote Machine (10.42.0.135)           │
│                                         │
│  ┌──────────────┐  ┌─────────────────┐ │
│  │   Docker     │  │  Tauri App      │ │
│  │              │  │                 │ │
│  │ PostgreSQL   │  │  ┌───────────┐  │ │
│  │ FastAPI      │◄─┼──┤ WebView   │  │ │
│  │ Mailcatcher  │  │  │ (Vite)    │  │ │
│  └──────────────┘  │  └───────────┘  │ │
│                    │  Rust Backend   │ │
│                    └─────────────────┘ │
│                           │ X11         │
└───────────────────────────┼─────────────┘
                            │
                    SSH X11 Forwarding
                            │
                            ▼
                ┌───────────────────────┐
                │  Local Laptop         │
                │                       │
                │  ┌─────────────────┐  │
                │  │ GEMI Window     │  │
                │  │ (Desktop App)   │  │
                │  └─────────────────┘  │
                └───────────────────────┘
```

### Future Phases

- **Phase 2:** Embed FastAPI into Tauri, use SQLite instead of PostgreSQL
- **Phase 3:** Build installers for distribution

---

## Common Commands Reference

### Backend Management

```bash
# Start all services
docker compose up -d

# Start specific service
docker compose up -d backend

# Stop all services
docker compose down

# Restart backend after code changes
docker compose restart backend

# View logs
docker compose logs -f backend

# Check service status
docker compose ps
```

### Frontend Development

```bash
# Install dependencies
npm install

# Start Vite dev server only
npm run dev

# Start Tauri desktop app
npm run tauri:dev

# Build for production
npm run build

# Build Tauri app
npm run tauri build
```

### Debugging

```bash
# Check X11 forwarding
echo $DISPLAY
xclock

# Check Node/npm versions
node --version
npm --version

# Check Rust/Cargo versions
rustc --version
cargo --version

# View Tauri logs with debug info
RUST_LOG=debug npm run tauri:dev

# Check backend health
curl http://localhost:8000/api/v1/utils/health-check
```

---

## Tips & Best Practices

### 1. Use Two SSH Sessions

Always keep: 
- **Session 1:** Regular SSH for backend/Docker
- **Session 2:** X11 SSH for Tauri (don't mix them!)

### 2. Keep Backend Running

No need to restart Docker constantly.  Only restart when:
- You change Python backend code
- You modify database schema
- You update environment variables

### 3. Git Ignore Tauri Files

Add to `.gitignore`:

```gitignore
# Tauri
frontend/src-tauri/target/
frontend/src-tauri/Cargo.lock
```

The `src-tauri/` folder itself should be committed! 

### 4. First Tauri Compile

Expect 5-10 minutes on first `npm run tauri:dev`. Get coffee! ☕

### 5. Use tmux/screen (Optional)

Keep sessions alive on remote machine:

```bash
# Install tmux
sudo pacman -S tmux

# Start session
tmux new -s gemi

# Detach:  Ctrl+B then D
# Reattach: tmux attach -t gemi
```

---

## Next Steps

### After Phase 1 is Working

You can now: 

1. **Develop features** - Full React/FastAPI development
2. **Test desktop features** - Native menus, notifications
3. **Build UI** - Desktop-optimized interface
4. **Test on your laptop** - Build and run standalone

### When Ready for Phase 2

Phase 2 will:
- Remove Docker dependency
- Embed Python backend into Tauri
- Switch from PostgreSQL to SQLite
- Create fully standalone desktop app
- Add system tray, native notifications

---

## Getting Help

### Check Logs

**Backend logs:**
```bash
docker compose logs -f backend
```

**Frontend logs:**
- Terminal 2 shows Vite and Tauri output
- Browser console (F12) for React errors

**Tauri debug:**
```bash
RUST_LOG=debug npm run tauri: dev
```

### Common Issues

1. **Can't connect to backend** → Check Docker is running
2. **Window doesn't appear** → Check `$DISPLAY` and X11 forwarding
3. **Hot reload doesn't work** → Check Vite dev server is running
4. **Build errors** → Run `npm install` again

---

## Success Criteria

Phase 1 is complete when you can: 

- ✅ Start backend with one command
- ✅ Start Tauri app with one command
- ✅ See desktop window on your laptop
- ✅ Login to the application
- ✅ Edit frontend code and see live updates
- ✅ Edit backend code and restart to see changes
- ✅ Access API docs at http://localhost:8000/docs

---

## Resources

- [Tauri Documentation](https://tauri.app/v1/guides/)
- [Vite Documentation](https://vitejs.dev/)
- [FastAPI Documentation](https://fastapi.tiangolo.com/)
- [Arch Linux Wiki - SSH](https://wiki.archlinux.org/title/OpenSSH)
- [X11 Forwarding Guide](https://wiki.archlinux.org/title/OpenSSH#X11_forwarding)

---

**🎉 Congratulations on completing Phase 1!**

You now have a fully functional Tauri development environment.  Happy coding! 🚀
