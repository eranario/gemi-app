import json
import logging
import mimetypes
import shutil
import uuid
from collections.abc import Generator
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel

from app.api.deps import CurrentUser, SessionDep
from app.core.config import settings
from app.crud.app_settings import get_setting
from app.crud.file_upload import (
    create_file_upload,
    delete_file_upload,
    get_distinct_field_values,
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

# Allowed extensions for the serve endpoint — prevents arbitrary file reads
_SERVEABLE_EXTENSIONS = {
    ".jpg", ".jpeg", ".png", ".tif", ".tiff", ".webp", ".gif", ".bmp",
    ".geojson", ".csv",
}


@router.get("/serve")
def serve_file(
    current_user: CurrentUser,
    path: str = Query(..., description="Absolute path to the file on disk"),
) -> FileResponse:
    """
    Serve a single file (image) directly from the local filesystem.

    Only files under the configured data_root and with image extensions are
    allowed.  This endpoint is used by the Plot Marker and GCP Picker tools
    to display raw images without copying them to the frontend.
    """
    src = Path(path)

    if src.suffix.lower() not in _SERVEABLE_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"File type '{src.suffix}' is not serveable. Allowed: {_SERVEABLE_EXTENSIONS}",
        )

    if not src.exists() or not src.is_file():
        raise HTTPException(status_code=404, detail=f"File not found: {path}")

    media_type = mimetypes.guess_type(str(src))[0] or "application/octet-stream"
    return FileResponse(path=str(src), media_type=media_type, filename=src.name)


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


# GET /files/field-values (distinct values for autocomplete)
@router.get("/field-values")
def read_field_values(
    session: SessionDep,
    current_user: CurrentUser,
    data_type: str | None = None,
    experiment: str | None = None,
    location: str | None = None,
    population: str | None = None,
    platform: str | None = None,
    sensor: str | None = None,
) -> dict[str, list[str]]:
    return get_distinct_field_values(
        session=session,
        data_type=data_type,
        experiment=experiment,
        location=location,
        population=population,
        platform=platform,
        sensor=sensor,
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


# POST /files/extract-metadata (read EXIF from a local file)
@router.post("/extract-metadata")
def extract_metadata(body: dict[str, str]) -> Any:
    file_path = body.get("file_path", "")
    src = Path(file_path)
    if not src.exists() or not src.is_file():
        raise HTTPException(status_code=400, detail=f"File not found: {file_path}")

    result: dict[str, str | None] = {"date": None, "platform": None, "sensor": None}

    try:
        from PIL import Image
        from PIL.ExifTags import Base as ExifBase

        with Image.open(src) as img:
            exif = img.getexif()
            if not exif:
                return result

            # Date: DateTimeOriginal (36867) or DateTime (306)
            date_str = exif.get(ExifBase.DateTimeOriginal) or exif.get(ExifBase.DateTime)
            if date_str and isinstance(date_str, str):
                # EXIF format: "2024:06:15 14:30:00" → "2024-06-15"
                result["date"] = date_str.replace("\x00", "").split(" ")[0].replace(":", "-")

            # Platform / Sensor from Make and Model
            # EXIF strings can contain null bytes — strip them
            make = exif.get(ExifBase.Make)
            model = exif.get(ExifBase.Model)
            if make and isinstance(make, str):
                result["platform"] = make.replace("\x00", "").strip()
            if model and isinstance(model, str):
                result["sensor"] = model.replace("\x00", "").strip()

    except Exception as exc:
        logger.warning(f"Could not read EXIF from {file_path}: {exc}")

    return result


# ── GeoTIFF validation helpers ───────────────────────────────────────────────

@router.get("/check-geotiff")
def check_geotiff(
    current_user: CurrentUser,
    path: str = Query(..., description="Absolute path to the GeoTIFF"),
) -> dict[str, Any]:
    """
    Read the CRS of a GeoTIFF and return whether it is WGS84 (EPSG:4326).
    Used after orthomosaic upload to decide if conversion is needed.

    Response:
        {
          "crs_epsg": 32614,
          "crs_name": "WGS 84 / UTM zone 14N",
          "is_wgs84": false,
          "width": 1234,
          "height": 5678,
        }
    """
    src = Path(path)
    if not src.exists() or not src.is_file():
        raise HTTPException(status_code=404, detail=f"File not found: {path}")
    if src.suffix.lower() not in {".tif", ".tiff"}:
        raise HTTPException(status_code=400, detail="Not a GeoTIFF file")

    try:
        import rasterio

        with rasterio.open(src) as ds:
            crs = ds.crs
            epsg = crs.to_epsg() if crs else None
            return {
                "crs_epsg": epsg,
                "crs_name": crs.name if crs else None,
                "is_wgs84": epsg == 4326,
                "width": ds.width,
                "height": ds.height,
            }
    except ImportError:
        raise HTTPException(
            status_code=503,
            detail="rasterio is not installed — cannot check GeoTIFF CRS",
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not read GeoTIFF: {exc}")


class ConvertGeoTiffRequest(BaseModel):
    file_path: str


@router.post("/convert-geotiff")
def convert_geotiff(
    current_user: CurrentUser,
    body: ConvertGeoTiffRequest,
) -> dict[str, Any]:
    """
    Reproject a GeoTIFF to WGS84 (EPSG:4326) in-place.

    The original file is backed up with a `.original.tif` suffix before
    conversion begins.  If conversion fails the backup is restored.

    Requires rasterio.  Large files may take several seconds.
    """
    src_path = Path(body.file_path)
    if not src_path.exists() or not src_path.is_file():
        raise HTTPException(status_code=404, detail=f"File not found: {body.file_path}")
    if src_path.suffix.lower() not in {".tif", ".tiff"}:
        raise HTTPException(status_code=400, detail="Not a GeoTIFF file")

    backup_path = src_path.with_name(src_path.stem + ".original.tif")
    shutil.copy2(src_path, backup_path)

    tmp_path = src_path.with_name(src_path.stem + ".converting.tif")

    try:
        import rasterio
        from rasterio.crs import CRS
        from rasterio.warp import Resampling, calculate_default_transform, reproject

        dst_crs = CRS.from_epsg(4326)

        with rasterio.open(src_path) as src:
            transform, width, height = calculate_default_transform(
                src.crs, dst_crs, src.width, src.height, *src.bounds
            )
            kwargs = src.meta.copy()
            kwargs.update({"crs": dst_crs, "transform": transform, "width": width, "height": height})

            with rasterio.open(tmp_path, "w", **kwargs) as dst:
                for band in range(1, src.count + 1):
                    reproject(
                        source=rasterio.band(src, band),
                        destination=rasterio.band(dst, band),
                        src_transform=src.transform,
                        src_crs=src.crs,
                        dst_transform=transform,
                        dst_crs=dst_crs,
                        resampling=Resampling.lanczos,
                    )

        tmp_path.replace(src_path)
        logger.info("Converted %s to WGS84; backup at %s", src_path.name, backup_path.name)

        return {
            "success": True,
            "backup_path": str(backup_path),
            "message": (
                f"Converted to WGS84 (EPSG:4326). "
                f"Original backed up as {backup_path.name}."
            ),
        }

    except ImportError:
        backup_path.unlink(missing_ok=True)
        raise HTTPException(
            status_code=503,
            detail="rasterio is not installed — cannot convert GeoTIFF",
        )
    except Exception as exc:
        # Restore from backup on failure
        if backup_path.exists():
            shutil.copy2(backup_path, src_path)
        tmp_path.unlink(missing_ok=True)
        logger.error("GeoTIFF conversion failed for %s: %s", src_path, exc)
        raise HTTPException(status_code=500, detail=f"Conversion failed: {exc}")


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


def _trigger_bin_extraction(bin_path: Path, output_dir: Path) -> None:
    """
    Launch bin → images extraction in a daemon thread after a .bin file is copied.
    Progress is emitted to the runner store under a key derived from the file path.
    The frontend can poll /files/extraction-progress?path=... for SSE updates.
    """
    import threading
    import uuid as _uuid
    from app.processing import runner
    from app.processing.ground import extract_bin_file

    extraction_id = str(_uuid.uuid4())
    stop_event = threading.Event()

    def _emit(event: dict) -> None:
        runner.emit(extraction_id, event)

    def worker() -> None:
        try:
            extract_bin_file(
                bin_path=bin_path,
                output_dir=output_dir,
                stop_event=stop_event,
                emit=_emit,
            )
        finally:
            runner._mark_done(extraction_id)

    runner._init_run(extraction_id)
    thread = threading.Thread(target=worker, daemon=True)
    thread.start()
    logger.info("Started bin extraction thread for %s (id=%s)", bin_path.name, extraction_id)


def _copy_local_stream(
    data_root: str, body: LocalCopyRequest, file_upload_id: uuid.UUID, session: Any
) -> Generator[str, None, None]:
    dest_dir = Path(data_root) / body.target_root_dir.replace("\x00", "")
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
                    "dest_path": str(dest_path),
                }
            )

            # Amiga .bin files need extraction after copy
            if src.suffix.lower() == ".bin":
                yield _sse_event(
                    {"event": "extracting", "file": name,
                     "message": f"Extracting {name}…"}
                )
                _trigger_bin_extraction(dest_path, dest_dir)

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
