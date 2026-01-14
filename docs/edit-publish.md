# GEMI Desktop App - Development & Release Guide

This guide explains how to make changes, build, and publish the GEMI desktop application.

---

## Table of Contents

1. [Making Frontend Changes](#making-frontend-changes)
2. [Making Backend Changes](#making-backend-changes)
3. [Building the Desktop App](#building-the-desktop-app)
4. [Publishing a Release](#publishing-a-release)
5. [Switching to Docker Images (Advanced)](#switching-to-docker-images-advanced)

---

## Making Frontend Changes

### Development Mode (Recommended for Active Development)

```bash
cd ~/projects/gemi/frontend

# Start Docker backend manually first
cd ~/. local/share/com. gemi.app
docker compose -f docker-compose.desktop.yml up -d

# Return to frontend and start dev mode
cd ~/projects/gemi/frontend
npm run tauri:dev
```

**Benefits:**
- ✅ Hot reload - changes appear instantly
- ✅ Faster iteration
- ✅ No full rebuild needed

### Production Build

```bash
cd ~/projects/gemi/frontend

# 1. Make your changes to src/

# 2. Build frontend
npm run build

# 3. Build Tauri app (bundles the built frontend)
npm run tauri:build
```

---

## Making Backend Changes

### Current Setup (Bundled Backend)

The backend source code is bundled with the app. When you make changes: 

```bash
cd ~/projects/gemi/backend

# 1. Make your changes to app/ files

# 2. Rebuild the Tauri app (includes updated backend)
cd ../frontend
npm run tauri:build
```

**How it works:**
- Backend source code is copied into the app bundle
- On first launch, Docker builds the backend image from source
- Changes require rebuilding the entire app

---

## Building the Desktop App

### Full Build Process

```bash
cd ~/projects/gemi/frontend

# Clean previous builds (optional but recommended)
rm -rf dist/
rm -rf src-tauri/target/release/bundle

# Build frontend
npm run build

# Build Tauri app for your platform
npm run tauri:build
```

### Testing the Build Locally

#### On Linux (Arch):

```bash
cd ~/projects/gemi/frontend/src-tauri/target/release/bundle/deb

# Extract the . deb
mkdir -p extracted
ar x GEMI_1.0.0_amd64.deb
tar -xf data.tar. gz -C extracted/

# Run the app
GDK_BACKEND=x11 ./extracted/usr/bin/app
```

#### Test the AppImage (if built):

```bash
cd ~/projects/gemi/frontend/src-tauri/target/release/bundle/appimage
chmod +x *.AppImage
GDK_BACKEND=x11 ./GEMI_*. AppImage
```

---

## Publishing a Release

### Step 1: Commit Your Changes

```bash
cd ~/projects/gemi

# Check what's changed
git status

# Add all changes
git add .

# Commit with a descriptive message
git commit -m "Description of changes"

# Push to main branch
git push origin main
```

### Step 2: Create a Release Tag

```bash
cd ~/projects/gemi

# Create a new version tag (increment version number)
git tag v1.0.2 -m "Release v1.0.2: Description of changes"

# Push the tag (this triggers GitHub Actions)
git push origin v1.0.2
```

### Step 3: Monitor GitHub Actions

1. Go to: `https://github.com/YOUR_USERNAME/YOUR_REPO/actions`
2. Watch the build workflow run
3. It will build for: 
   - Windows (`.msi` and `.exe`)
   - macOS (`.dmg` - Intel and Apple Silicon)
   - Linux (`.deb` and `.AppImage`)

**Build time:** ~10-20 minutes

### Step 4: Verify the Release

1. Go to: `https://github.com/YOUR_USERNAME/YOUR_REPO/releases`
2. Find your new release (e.g., `v1.0.2`)
3. Verify all artifacts are present:
   - `GEMI_X.X.X_amd64.AppImage`
   - `GEMI_X.X. X_amd64.deb`
   - `GEMI_X.X.X_x64-setup.exe`
   - `GEMI_X.X.X_x64_en-US.msi`
   - `GEMI_X.X.X_x64.dmg` (Intel Mac)
   - `GEMI_X.X.X_aarch64.dmg` (Apple Silicon)

### Step 5: Test the Release

```bash
cd ~/Downloads

# Download the AppImage
wget https://github.com/YOUR_USERNAME/YOUR_REPO/releases/download/v1.0.2/GEMI_1.0.2_amd64.AppImage

# Make executable and run
chmod +x GEMI_1.0.2_amd64.AppImage
GDK_BACKEND=x11 ./GEMI_1.0.2_amd64.AppImage
```

---

## Switching to Docker Images (Advanced)

Using published Docker images makes the app **smaller** and **faster**, but requires internet on first run.

### Benefits

- ✅ Smaller app bundle (30-50MB vs 100-300MB)
- ✅ Faster startup (no build, just pull image)
- ✅ Update backend independently of frontend
- ✅ More professional approach

### Step 1: Build and Publish Backend Image

```bash
cd ~/projects/gemi/backend

# Build the Docker image
docker build -t ghcr.io/YOUR_USERNAME/gemi-backend: latest .

# Test the image locally
docker run --rm ghcr.io/YOUR_USERNAME/gemi-backend: latest python -c "print('Backend works!')"

# Login to GitHub Container Registry
# First, create a Personal Access Token at: https://github.com/settings/tokens
# With permissions: write:packages, read:packages
echo "YOUR_GITHUB_TOKEN" | docker login ghcr.io -u YOUR_USERNAME --password-stdin

# Push the image
docker push ghcr.io/YOUR_USERNAME/gemi-backend:latest
```

### Step 2: Make the Image Public

1. Go to: `https://github.com/YOUR_USERNAME? tab=packages`
2. Click on **gemi-backend**
3. Click **Package settings**
4. Scroll to **Danger Zone**
5. Click **Change visibility** → **Public**

### Step 3: Update docker-compose.desktop.yml

Edit `~/projects/gemi/docker-compose.desktop.yml`:

**Before:**
```yaml
services:
  prestart:
    image: gemi-backend:latest
    build: 
      context: ./backend
      dockerfile: Dockerfile
    # ... rest of config

  backend:
    image: gemi-backend:latest
    build: 
      context: ./backend
      dockerfile: Dockerfile
    # ... rest of config
```

**After:**
```yaml
services:
  prestart:
    image: ghcr.io/YOUR_USERNAME/gemi-backend:latest
    # Remove the 'build:' section entirely
    # ... rest of config

  backend:
    image: ghcr.io/YOUR_USERNAME/gemi-backend:latest
    # Remove the 'build: ' section entirely
    # ... rest of config
```

### Step 4: Update tauri.conf.json

Edit `~/projects/gemi/frontend/src-tauri/tauri.conf.json`:

**Before:**
```json
{
  "bundle": {
    "resources": [
      "../../docker-compose.desktop.yml",
      "../../. env. desktop",
      "../../backend"
    ]
  }
}
```

**After:**
```json
{
  "bundle":  {
    "resources": [
      "../../docker-compose.desktop.yml",
      "../../. env.desktop"
    ]
  }
}
```

### Step 5: Update main.rs

Edit `~/projects/gemi/frontend/src-tauri/src/main.rs`:

**Find this section:**
```rust
// Copy backend directory
let backend_src = resource_dir. join("backend");
let backend_dest = data_dir.join("backend");

if backend_src.exists() {
    copy_dir_all(&backend_src, &backend_dest)?;
    println!("Copied backend to: {: ?}", backend_dest);
}
```

**Remove it or comment it out:**
```rust
// Backend is now pulled from Docker registry, no need to bundle
// let backend_src = resource_dir.join("backend");
// let backend_dest = data_dir.join("backend");
// if backend_src.exists() {
//     copy_dir_all(&backend_src, &backend_dest)?;
//     println!("Copied backend to: {:?}", backend_dest);
// }
```

### Step 6: Rebuild and Test

```bash
cd ~/projects/gemi/frontend

# Clean old builds
rm -rf dist/ src-tauri/target/

# Rebuild
npm run build
npm run tauri:build

# Test - it should pull the image from GitHub
cd src-tauri/target/release/bundle/deb
mkdir -p extracted
ar x GEMI_*. deb
tar -xf data.tar.gz -C extracted/
GDK_BACKEND=x11 ./extracted/usr/bin/app
```

**Expected behavior:**
- App is much smaller
- On first launch, Docker pulls `ghcr.io/YOUR_USERNAME/gemi-backend:latest`
- Subsequent launches are faster (image is cached)

### Step 7: Update Workflow for Backend Changes

**When you make backend changes:**

```bash
cd ~/projects/gemi/backend

# 1. Make your changes

# 2. Build and push new Docker image
docker build -t ghcr.io/YOUR_USERNAME/gemi-backend:latest . 
docker push ghcr.io/YOUR_USERNAME/gemi-backend:latest

# 3. Users will pull the new image automatically on next app launch
#    (or you can trigger a new frontend release to notify users)
```

**When you make frontend changes:**

```bash
cd ~/projects/gemi/frontend

# Just rebuild the frontend - backend is independent
npm run build
npm run tauri:build
```

---

## Quick Reference

### Development Workflow (Current Setup)

```bash
# Frontend changes
cd ~/projects/gemi/frontend
npm run tauri:dev  # Dev mode with hot reload

# Backend changes
cd ~/projects/gemi/backend
# Make changes
cd ../frontend
npm run tauri:build  # Full rebuild

# Release
git add .
git commit -m "Description"
git push origin main
git tag v1.0.X
git push origin v1.0.X
```

### Development Workflow (Docker Images)

```bash
# Frontend changes
cd ~/projects/gemi/frontend
npm run tauri: dev  # Dev mode

# Backend changes
cd ~/projects/gemi/backend
# Make changes
docker build -t ghcr.io/YOUR_USERNAME/gemi-backend:latest .
docker push ghcr.io/YOUR_USERNAME/gemi-backend:latest

# Release
git add .
git commit -m "Description"
git push origin main
git tag v1.0.X
git push origin v1.0.X
```

---

## Troubleshooting

### Build Fails

```bash
# Clean everything and rebuild
cd ~/projects/gemi/frontend
rm -rf dist/ src-tauri/target/ node_modules/
npm install
npm run build
npm run tauri:build
```

### Docker Issues on First Run

```bash
# Remove old volumes
docker volume ls | grep gemi
docker volume rm gemi-desktop-db-data gemi-desktop-logs

# Clean app data
rm -rf ~/.local/share/com.gemi.app/

# Restart app
```

### GitHub Actions Fails

1. Check the Actions tab for error logs
2. Common issues:
   - Missing files in `resources` (check `tauri.conf.json`)
   - Rust compilation errors (check `main.rs`)
   - Frontend build errors (check `package.json` scripts)

---

## Version Numbering

Follow semantic versioning:  `MAJOR.MINOR.PATCH`

- **MAJOR**: Breaking changes
- **MINOR**: New features (backward compatible)
- **PATCH**: Bug fixes

Examples:
- `v1.0.0` - Initial release
- `v1.0.1` - Bug fix
- `v1.1.0` - New feature
- `v2.0.0` - Breaking changes

---

## Additional Resources

- [Tauri Documentation](https://tauri.app/v1/guides/)
- [GitHub Container Registry](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)
- [Docker Compose Documentation](https://docs.docker.com/compose/)

