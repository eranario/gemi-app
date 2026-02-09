# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_submodules

block_cipher = None

hiddenimports = [
    # Uvicorn internals
    'uvicorn.logging',
    'uvicorn.loops',
    'uvicorn.loops.auto',
    'uvicorn.protocols',
    'uvicorn.protocols.http',
    'uvicorn.protocols.http.auto',
    'uvicorn.protocols.http.h11_impl',
    'uvicorn.protocols.websockets',
    'uvicorn.protocols.websockets.auto',
    'uvicorn.lifespan',
    'uvicorn.lifespan.on',
    # App modules
    'app.api.main',
    'app.api.deps',
    'app.api.routes.login',
    'app.api.routes.users',
    'app.api.routes.items',
    'app.api.routes.utils',
    'app.api.routes.private',
    'app.api.routes.files',
    'app.api.routes.app_settings',
    'app.core.config',
    'app.core.db',
    'app.core.security',
    'app.models',
    'app.models.user',
    'app.models.item',
    'app.models.file_upload',
    'app.models.app_settings',
    'app.models.common',
    'app.crud',
    'app.crud.user',
    'app.crud.item',
    'app.crud.file_upload',
    'app.crud.app_settings',
    # Dependencies
    'email_validator',
    'passlib.handlers.bcrypt',
    'bcrypt',
    'sqlmodel',
    'pydantic',
    'pydantic_settings',
    'aiosqlite',
    'sqlite3',
    'jwt',
    'jwt.exceptions',
    'sentry_sdk',
]

# Collect all submodules for complex packages
hiddenimports += collect_submodules('pydantic')
hiddenimports += collect_submodules('pydantic_core')
hiddenimports += collect_submodules('sqlmodel')
hiddenimports += collect_submodules('fastapi')
hiddenimports += collect_submodules('starlette')
hiddenimports += collect_submodules('uvicorn')
hiddenimports += collect_submodules('sentry_sdk')

a = Analysis(
    ['run_server.py'],
    pathex=[],
    binaries=[],
    datas=[],
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='gemi-backend',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
