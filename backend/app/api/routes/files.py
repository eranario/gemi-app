import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, UploadFile

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


# upload files to dir /files/upload
@router.post("/upload")
def upload_files(
    session: SessionDep,
    files: list[UploadFile],
    data_type: str,
    target_root_dir: str,
    reupload: bool = False,
):
    # NOTE: make sure the target_root_dir is "sanitized" at the frontend
    data_root = get_setting(session=session, key="data_root") or settings.APP_DATA_ROOT
    print(f"Using data root: {data_root}")

    dest_dir = Path(data_root) / target_root_dir
    print(f"Destination directory: {dest_dir}")
    # dest_dir.mkdir(parents=True, exist_ok=True)

    # saved = []
    # for f in files:
    #     dest_path = dest_dir / f.filename
    #     if dest_path.exists() and not reupload:
    #         continue
    #     with open(dest_path, "wb") as out:
    #         out.write(f.file.read())
    #     saved.append(str(dest_path))

    print("file upload endpoint reached")
    saved = [None]
    return {"uploaded": saved, "count": len(saved)}
