from fastapi import APIRouter

from app.api.routes import app_settings, files, items, login, pipelines, private, processing, users, utils, workspaces
from app.core.config import settings

api_router = APIRouter()
api_router.include_router(login.router)
api_router.include_router(users.router)
api_router.include_router(utils.router)
api_router.include_router(items.router)
api_router.include_router(files.router)
api_router.include_router(app_settings.router)
api_router.include_router(workspaces.router)
api_router.include_router(pipelines.router)
api_router.include_router(processing.router)


if settings.ENVIRONMENT == "local":
    api_router.include_router(private.router)
