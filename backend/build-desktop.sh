#!/bin/bash
set -e

echo "Building GEMI Desktop Backend..."

# Install PyInstaller if not present
pip install pyinstaller

# Build the executable
pyinstaller --clean gemi-backend.spec

echo ""
echo "Build complete!"
echo "Executable: dist/gemi-backend"
echo ""
echo "To test: ./dist/gemi-backend"
