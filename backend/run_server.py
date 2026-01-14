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
