import uuid

from sqlmodel import Session, col, select

from app.models import Workspace, WorkspaceCreate, WorkspaceUpdate


def create_workspace(
    *, session: Session, file_in: WorkspaceCreate, owner_id: uuid.UUID
) -> Workspace:
    db_item = Workspace.model_validate(file_in, update={"owner_id": owner_id})
    session.add(db_item)
    session.commit()
    session.refresh(db_item)

    return db_item


def get_file_upload(*, session: Session, id: uuid.UUID) -> Workspace | None:
    statement = select(Workspace).where(Workspace.id == id)
    selected_file = session.exec(statement).first()

    return selected_file


def get_file_uploads_by_owner(
    *, session: Session, owner_id: uuid.UUID, skip: int = 0, limit: int = 100
) -> list[Workspace]:
    statement = (
        select(Workspace)
        .where(Workspace.owner_id == owner_id)
        .offset(skip)
        .limit(limit)
    )
    selected_files_owner = list(session.exec(statement).all())

    return selected_files_owner


def update_file_upload(
    *, session: Session, db_file: Workspace, file_in: WorkspaceUpdate
) -> Workspace:
    file_data = file_in.model_dump(
        exclude_unset=True
    )  # only includes fields that were sent
    db_file.sqlmodel_update(file_data)
    session.add(db_file)
    session.commit()
    session.refresh(db_file)

    return db_file


def delete_file_upload(*, session: Session, id: uuid.UUID) -> None:
    file_upload = session.get(Workspace, id)
    if not file_upload:
        raise ValueError("Workspace not found")
    session.delete(file_upload)
    session.commit()


SUGGESTABLE_FIELDS = ["experiment", "location", "population", "platform", "sensor"]

# Fields ordered for cascading: each field is filtered by all preceding fields.
_CASCADE_ORDER = [
    "data_type",
    "experiment",
    "location",
    "population",
    "platform",
    "sensor",
]


def get_distinct_field_values(
    *,
    session: Session,
    data_type: str | None = None,
    experiment: str | None = None,
    location: str | None = None,
    population: str | None = None,
    platform: str | None = None,
    sensor: str | None = None,
) -> dict[str, list[str]]:
    """Return distinct non-empty values for each suggestable field.

    Cascading: for each target field, apply filters from all fields that
    precede it in _CASCADE_ORDER.
    """
    filter_values: dict[str, str | None] = {
        "data_type": data_type,
        "experiment": experiment,
        "location": location,
        "population": population,
        "platform": platform,
        "sensor": sensor,
    }

    result: dict[str, list[str]] = {}

    for field in SUGGESTABLE_FIELDS:
        column = getattr(Workspace, field)
        stmt = select(column).distinct()

        # Apply filters from all fields that come before this one in cascade order
        for prev_field in _CASCADE_ORDER:
            if prev_field == field:
                break
            prev_value = filter_values.get(prev_field)
            if prev_value:
                prev_column = getattr(Workspace, prev_field)
                stmt = stmt.where(prev_column == prev_value)

        # Exclude empty / null values
        stmt = stmt.where(col(column).is_not(None), column != "")

        values = list(session.exec(stmt).all())
        values.sort()
        result[field] = values

    return result


