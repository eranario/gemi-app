import uuid
from typing import Any

from fastapi import APIRouter, HTTPException

from app.api.deps import CurrentUser, SessionDep
from app.crud.workspace import (
    create_workspace,
    delete_workspace,
    get_workspace,
    get_workspaces_by_owner,
    update_workspace,
)
from app.models import Message
from app.models.workspace import (
    WorkspaceCreate,
    WorkspacePublic,
    WorkspacesPublic,
    WorkspaceUpdate,
)

router = APIRouter(prefix="/workspaces", tags=["workspaces"])


@router.post("/", response_model=WorkspacePublic)
def create(
    *, session: SessionDep, current_user: CurrentUser, workspace_in: WorkspaceCreate
) -> Any:
    workspace = create_workspace(
        session=session, workspace_in=workspace_in, owner_id=current_user.id
    )
    return workspace


@router.get("/", response_model=WorkspacesPublic)
def read_all(
    session: SessionDep, current_user: CurrentUser, skip: int = 0, limit: int = 100
) -> Any:
    workspaces = get_workspaces_by_owner(
        session=session, owner_id=current_user.id, skip=skip, limit=limit
    )
    return WorkspacesPublic(
        data=[WorkspacePublic.model_validate(w) for w in workspaces],
        count=len(workspaces),
    )


@router.get("/{id}", response_model=WorkspacePublic)
def read_one(session: SessionDep, current_user: CurrentUser, id: uuid.UUID) -> Any:
    workspace = get_workspace(session=session, id=id)
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")
    if not current_user.is_superuser and workspace.owner_id != current_user.id:
        raise HTTPException(status_code=400, detail="Not enough permissions")
    return workspace


@router.put("/{id}", response_model=WorkspacePublic)
def update(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    id: uuid.UUID,
    workspace_in: WorkspaceUpdate,
) -> Any:
    workspace = get_workspace(session=session, id=id)
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")
    if not current_user.is_superuser and workspace.owner_id != current_user.id:
        raise HTTPException(status_code=400, detail="Not enough permissions")
    workspace = update_workspace(
        session=session, db_workspace=workspace, workspace_in=workspace_in
    )
    return workspace


@router.delete("/{id}")
def delete(session: SessionDep, current_user: CurrentUser, id: uuid.UUID) -> Message:
    workspace = get_workspace(session=session, id=id)
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")
    if not current_user.is_superuser and workspace.owner_id != current_user.id:
        raise HTTPException(status_code=400, detail="Not enough permissions")
    delete_workspace(session=session, id=id)
    return Message(message="Workspace deleted successfully")
