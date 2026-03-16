import uuid
from pathlib import Path
from typing import Any
from urllib.parse import quote

from fastapi import APIRouter, HTTPException
from sqlmodel import col, select

from app.api.deps import CurrentUser, SessionDep
from app.core.config import settings
from app.crud.app_settings import get_setting
from app.crud.workspace import (
    create_workspace,
    delete_workspace,
    get_workspace,
    get_workspaces_by_owner,
    update_workspace,
)
from app.models.file_upload import FileUpload
from app.models.pipeline import Pipeline, PipelineRun
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


_IMAGE_EXTS = {".jpg", ".jpeg", ".png"}


@router.get("/{id}/card-images")
def workspace_card_images(
    session: SessionDep, current_user: CurrentUser, id: uuid.UUID
) -> list[dict]:
    """
    Return up to 4 sampled raw frame URLs for the workspace card background.

    Uses the FileUpload database to find "Image Data" uploads that match the
    experiment/location/population/date/platform/sensor of any run belonging
    to this workspace, then samples frames spread across the image sequence.
    Raw JPEGs served directly via /files/serve — no image processing.
    """
    workspace = get_workspace(session=session, id=id)
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")

    # Resolve data_root for storage_path lookups
    data_root = Path(get_setting(session=session, key="data_root") or settings.APP_DATA_ROOT)

    # Get all pipeline runs for this workspace
    pipelines = session.exec(
        select(Pipeline).where(Pipeline.workspace_id == id)
    ).all()

    all_runs: list[tuple[PipelineRun, str]] = []
    for pipeline in pipelines:
        runs = session.exec(
            select(PipelineRun).where(PipelineRun.pipeline_id == pipeline.id)
        ).all()
        for run in runs:
            all_runs.append((run, pipeline.type))

    all_runs.sort(key=lambda x: x[0].date or "")

    if not all_runs:
        return []

    # Image-bearing data types for each pipeline type
    _AERIAL_DATA_TYPES = {"Image Data", "Orthomosaic"}
    _GROUND_DATA_TYPES = {"Farm-ng Binary File", "Image Data"}

    def _frames_for_run(run: PipelineRun, pipeline_type: str) -> list[Path]:
        """
        Find image files for a run via the FileUpload DB record.
        Searches relevant data types for the pipeline type.
        """
        data_types = _GROUND_DATA_TYPES if pipeline_type == "ground" else _AERIAL_DATA_TYPES

        uploads = session.exec(
            select(FileUpload).where(
                col(FileUpload.data_type).in_(list(data_types)),
                FileUpload.experiment == run.experiment,
                FileUpload.location == run.location,
                FileUpload.population == run.population,
                FileUpload.date == run.date,
            )
        ).all()

        frames: list[Path] = []
        for upload in uploads:
            img_dir = data_root / upload.storage_path
            if img_dir.exists() and img_dir.is_dir():
                frames.extend(
                    p for p in img_dir.rglob("*")
                    if p.is_file() and p.suffix.lower() in _IMAGE_EXTS
                )
        return sorted(frames)

    def _pick_frame(runs_for_type: list[tuple[PipelineRun, str]], n: int) -> list[dict]:
        """Pick up to n frames spread across the runs list."""
        picked: list[dict] = []
        if not runs_for_type:
            return picked
        total = len(runs_for_type)
        step = max(1, total // n)
        for i in range(0, total, step):
            if len(picked) >= n:
                break
            run, ptype = runs_for_type[i]
            frames = _frames_for_run(run, ptype)
            if frames:
                mid = frames[len(frames) // 2]
                picked.append({
                    "url": f"/api/v1/files/serve?path={quote(str(mid))}",
                    "type": ptype,
                    "date": run.date or "",
                })
        return picked

    # Separate runs by pipeline type
    aerial_runs = [(r, t) for r, t in all_runs if t == "aerial"]
    ground_runs = [(r, t) for r, t in all_runs if t == "ground"]

    results: list[dict] = []

    both_types = bool(aerial_runs) and bool(ground_runs)

    if both_types:
        # 50/50 split: 2 from each type
        results = _pick_frame(aerial_runs, 2) + _pick_frame(ground_runs, 2)
    elif len(all_runs) == 1:
        # Single run — spread 4 frames across the sequence
        run, ptype = all_runs[0]
        frames = _frames_for_run(run, ptype)
        n = len(frames)
        if n:
            positions = sorted({0, n // 3, 2 * n // 3, n - 1})
            for pos in positions[:4]:
                results.append({
                    "url": f"/api/v1/files/serve?path={quote(str(frames[pos]))}",
                    "type": ptype,
                    "date": run.date or "",
                })
    else:
        # Multiple runs, single type — one frame per sampled run
        results = _pick_frame(all_runs, 4)

    return results
