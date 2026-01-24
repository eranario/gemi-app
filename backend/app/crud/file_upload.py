import uuid

from sqlmodel import Session, select
from app.models import FileUploadCreate, FileUpload, FileUploadUpdate


def create_file_upload(
    *, session: Session, file_in: FileUploadCreate, owner_id: uuid.UUID
) -> FileUpload:
    db_item = FileUpload.model_validate(file_in, update={"owner_id": owner_id})
    session.add(db_item)
    session.commit()
    session.refresh(db_item)

    return db_item


def get_file_upload(*, session: Session, id: uuid.UUID) -> FileUpload | None:
    statement = select(FileUpload).where(FileUpload.id == id)
    selected_file = session.exec(statement).first()

    return selected_file


def get_file_uploads_by_owner(
    *, session: Session, owner_id: uuid.UUID, skip: int = 0, limit: int = 100
) -> list[FileUpload]:
    statement = (
        select(FileUpload)
        .where(FileUpload.owner_id == owner_id)
        .offset(skip)
        .limit(limit)
    )
    selected_files_owner = session.exec(statement).all()

    return selected_files_owner


def update_file_upload(
    *, session: Session, db_file: FileUpload, file_in: FileUploadUpdate
) -> FileUpload:
    file_data = file_in.model_dump(
        exclude_unset=True
    )  # only includes fields that were sent
    db_file.sqlmodel_update(file_data)
    session.add(db_file)
    session.commit()
    session.refresh(db_file)

    return db_file


def delete_file_upload(*, session: Session, id: uuid.UUID) -> None:
    file_upload = session.get(FileUpload, id)
    if not file_upload:
        raise ValueError("FileUpload not found")
    session.delete(file_upload)
    session.commit()
