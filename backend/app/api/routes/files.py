import logging
import shutil
import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.api.deps import CurrentUser, SessionDep
from app.core.config import settings
from app.crud.app_settings import get_setting
from app.crud.file_upload import (
    create_file_upload,
    delete_file_upload,
    get_file_upload,
    get_file_uploads_by_owner,
    update_file_upload,
)
from app.models import (
    FileUploadCreate,
    FileUploadPublic,
    FileUploadsPublic,
    FileUploadUpdate,
    Message,
)

router = APIRouter(prefix="/files", tags=["files"])
logger = logging.getLogger(__name__)


# POST /files/ (create new upload record)
@router.post("/", response_model=FileUploadPublic)
def create_file(
    *, session: SessionDep, current_user: CurrentUser, file_in: FileUploadCreate
) -> Any:
    file = create_file_upload(
        session=session, file_in=file_in, owner_id=current_user.id
    )
    return file


# GET /files/ (list user's uploads)
@router.get("/", response_model=FileUploadsPublic)
def read_files(
    session: SessionDep, current_user: CurrentUser, skip: int = 0, limit: int = 100
) -> Any:
    files = get_file_uploads_by_owner(
        session=session, owner_id=current_user.id, skip=skip, limit=limit
    )
    return FileUploadsPublic(
        data=[FileUploadPublic.model_validate(f) for f in files], count=len(files)
    )


# GET /files/{id} (get single upload)
@router.get("/{id}", response_model=FileUploadPublic)
def read_file(session: SessionDep, current_user: CurrentUser, id: uuid.UUID) -> Any:
    file = get_file_upload(session=session, id=id)
    if not file:
        raise HTTPException(status_code=404, detail="File not found")
    if not current_user.is_superuser and file.owner_id != current_user.id:
        raise HTTPException(status_code=400, detail="Not enough permissions")
    return file


# PUT /files/{id} (update upload)
@router.put("/{id}", response_model=FileUploadPublic)
def update_file(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    id: uuid.UUID,
    file_in: FileUploadUpdate,
) -> Any:
    file = get_file_upload(session=session, id=id)
    if not file:
        raise HTTPException(status_code=404, detail="File not found")
    if not current_user.is_superuser and file.owner_id != current_user.id:
        raise HTTPException(status_code=400, detail="Not enough permissions")
    file = update_file_upload(session=session, db_file=file, file_in=file_in)
    return file


# DELETE /files/{id} (delete upload)
@router.delete("/{id}")
def delete_file(
    session: SessionDep, current_user: CurrentUser, id: uuid.UUID
) -> Message:
    file = get_file_upload(session=session, id=id)
    if not file:
        raise HTTPException(status_code=404, detail="File not found")
    if not current_user.is_superuser and file.owner_id != current_user.id:
        raise HTTPException(status_code=400, detail="Not enough permissions")
    delete_file_upload(session=session, id=id)
    return Message(message="File deleted successfully")


class LocalCopyRequest(BaseModel):
    file_paths: list[str]
    data_type: str
    target_root_dir: str
    reupload: bool = False


# copy local files directly on disk (faster for desktop/Tauri)
@router.post("/copy-local")
def copy_local_files(
    session: SessionDep,
    body: LocalCopyRequest,
):
    data_root = get_setting(session=session, key="data_root") or settings.APP_DATA_ROOT
    dest_dir = Path(data_root) / body.target_root_dir
    dest_dir.mkdir(parents=True, exist_ok=True)
    logger.info(f"Destination directory for current upload: {dest_dir}")

    saved = []
    skipped = []
    for file_path in body.file_paths:
        src = Path(file_path)
        if not src.exists():
            raise HTTPException(
                status_code=400, detail=f"Source file not found: {file_path}"
            )
        dest_path = dest_dir / src.name
        if dest_path.exists() and not body.reupload:
            skipped.append(src.name)
            continue
        shutil.copy2(src, dest_path)
        saved.append(str(dest_path))

    return {"uploaded": saved, "skipped": skipped, "count": len(saved)}
