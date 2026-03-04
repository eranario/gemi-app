import json
import logging
import shutil
import uuid
from collections.abc import Generator
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.api.deps import CurrentUser, SessionDep
from app.core.config import settings
from app.crud.app_settings import get_setting
from app.crud.file_upload import (
    create_file_upload,
    delete_file_upload,
    get_file_upload,
    get_file_uploads_by_owner,
    sync_file_uploads,
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

    # Remove files from disk
    data_root = get_setting(session=session, key="data_root") or settings.APP_DATA_ROOT
    dir_path = Path(data_root) / file.storage_path
    if dir_path.exists() and dir_path.is_dir():
        shutil.rmtree(dir_path)
        logger.info(f"Deleted directory: {dir_path}")

    delete_file_upload(session=session, id=id)
    return Message(message="File deleted successfully")


# POST /files/sync (reconcile DB with disk)
@router.post("/sync")
def sync_files(session: SessionDep, current_user: CurrentUser) -> Any:
    data_root = get_setting(session=session, key="data_root") or settings.APP_DATA_ROOT
    result = sync_file_uploads(session=session, data_root=data_root)
    return result


class LocalCopyRequest(BaseModel):
    file_paths: list[str]
    data_type: str
    target_root_dir: str
    reupload: bool = False
    # Metadata fields for DB record
    experiment: str | None = None
    location: str | None = None
    population: str | None = None
    date: str | None = None
    platform: str | None = None
    sensor: str | None = None


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


def _sse_event(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


def _copy_local_stream(
    data_root: str, body: LocalCopyRequest, file_upload_id: uuid.UUID, session: Any
) -> Generator[str, None, None]:
    dest_dir = Path(data_root) / body.target_root_dir
    dest_dir.mkdir(parents=True, exist_ok=True)
    logger.info(f"SSE stream – destination: {dest_dir}")

    file_names = [Path(p).name for p in body.file_paths]
    yield _sse_event(
        {"event": "start", "total": len(body.file_paths), "files": file_names}
    )

    uploaded: list[str] = []
    skipped: list[str] = []

    for idx, file_path in enumerate(body.file_paths):
        src = Path(file_path)
        name = src.name

        if not src.exists():
            yield _sse_event(
                {
                    "event": "error",
                    "file": name,
                    "message": f"Source file not found: {file_path}",
                    "index": idx,
                }
            )
            continue

        dest_path = dest_dir / name

        if dest_path.exists() and not body.reupload:
            skipped.append(name)
            yield _sse_event(
                {"event": "progress", "file": name, "status": "skipped", "index": idx}
            )
            continue

        try:
            shutil.copy2(src, dest_path)
            uploaded.append(str(dest_path))
            yield _sse_event(
                {
                    "event": "progress",
                    "file": name,
                    "status": "completed",
                    "index": idx,
                }
            )
        except Exception as exc:
            yield _sse_event(
                {"event": "error", "file": name, "message": str(exc), "index": idx}
            )

    # Update the FileUpload record with final status
    db_file = get_file_upload(session=session, id=file_upload_id)
    if db_file:
        update_file_upload(
            session=session,
            db_file=db_file,
            file_in=FileUploadUpdate(
                status="completed", file_count=len(uploaded)
            ),
        )

    yield _sse_event(
        {
            "event": "complete",
            "uploaded": uploaded,
            "skipped": skipped,
            "count": len(uploaded),
        }
    )


@router.post("/copy-local-stream")
def copy_local_files_stream(
    session: SessionDep,
    current_user: CurrentUser,
    body: LocalCopyRequest,
) -> StreamingResponse:
    data_root = get_setting(session=session, key="data_root") or settings.APP_DATA_ROOT

    # Create a FileUpload record with status="processing"
    file_upload = create_file_upload(
        session=session,
        file_in=FileUploadCreate(
            data_type=body.data_type,
            experiment=body.experiment or "",
            location=body.location or "",
            population=body.population or "",
            date=body.date or "",
            platform=body.platform,
            sensor=body.sensor,
            storage_path=body.target_root_dir,
        ),
        owner_id=current_user.id,
    )
    update_file_upload(
        session=session,
        db_file=file_upload,
        file_in=FileUploadUpdate(status="processing", file_count=len(body.file_paths)),
    )

    return StreamingResponse(
        _copy_local_stream(data_root, body, file_upload.id, session),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
