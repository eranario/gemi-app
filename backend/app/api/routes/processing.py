"""
Processing action endpoints for PipelineRuns.

Routes
------
POST /pipeline-runs/{id}/execute-step    trigger a compute step
POST /pipeline-runs/{id}/stop            cancel running step
GET  /pipeline-runs/{id}/progress        SSE stream
GET  /pipeline-runs/{id}/outputs         list output files

Ground-specific:
POST /pipeline-runs/{id}/plot-marking        save image selections
GET  /pipeline-runs/{id}/images              list raw images for marking
POST /pipeline-runs/{id}/apply-boundaries    copy plot_borders to new run

Aerial-specific:
POST /pipeline-runs/{id}/gcp-selection       save GCP pixel coords
POST /pipeline-runs/{id}/plot-boundaries     save drawn GeoJSON polygons

Shared:
POST /pipeline-runs/{id}/inference           trigger Roboflow (both types)
POST /pipeline-runs/{id}/download-crops      serve cropped images as ZIP
"""

from __future__ import annotations

import io
import json
import logging
import shutil
import uuid
import zipfile
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlmodel import Session

from app.api.deps import CurrentUser, SessionDep
from app.core.paths import RunPaths
from app.crud.pipeline import get_pipeline_run, get_pipeline
from app.crud.pipeline import update_pipeline_run
from app.models.pipeline import Pipeline, PipelineRun, PipelineRunUpdate
from app.models.workspace import Workspace
from app.processing import runner

logger = logging.getLogger(__name__)
router = APIRouter(tags=["processing"])


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_run_or_404(session: Session, run_id: uuid.UUID) -> PipelineRun:
    run = get_pipeline_run(session=session, id=run_id)
    if not run:
        raise HTTPException(status_code=404, detail="PipelineRun not found")
    return run


def _get_paths(session: Session, run: PipelineRun) -> RunPaths:
    pipeline = session.get(Pipeline, run.pipeline_id)
    workspace = session.get(Workspace, pipeline.workspace_id)
    return RunPaths.from_db(session=session, run=run, workspace=workspace)


# ── Execute step ──────────────────────────────────────────────────────────────

GROUND_COMPUTE_STEPS = {"stitching", "georeferencing"}
AERIAL_COMPUTE_STEPS = {"orthomosaic", "trait_extraction"}
SHARED_COMPUTE_STEPS = {"inference"}


class ModelConfig(BaseModel):
    label: str
    roboflow_api_key: str
    roboflow_model_id: str
    task_type: str = "detection"


class ExecuteStepRequest(BaseModel):
    step: str
    # Multi-model inference config
    models: list[ModelConfig] = []
    # Stitching version override (optional)
    agrowstitch_version: int = 1


@router.post("/pipeline-runs/{id}/execute-step")
def execute_step(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    id: uuid.UUID,
    body: ExecuteStepRequest,
) -> dict[str, str]:
    run = _get_run_or_404(session, id)
    pipeline = session.get(Pipeline, run.pipeline_id)

    if run.status == "running":
        raise HTTPException(status_code=409, detail="A step is already running")

    step = body.step
    ptype = pipeline.type if pipeline else "ground"

    # Resolve step function
    if ptype == "ground":
        from app.processing import ground
        dispatch: dict[str, Any] = {
            "stitching": (
                ground.run_stitching,
                {"agrowstitch_version": body.agrowstitch_version},
            ),
            "georeferencing": (
                ground.run_georeferencing,
                {"agrowstitch_version": body.agrowstitch_version},
            ),
            "inference": (
                ground.run_inference,
                {
                    "models": [m.model_dump() for m in body.models],
                    "agrowstitch_version": body.agrowstitch_version,
                },
            ),
        }
    else:
        from app.processing import aerial
        dispatch = {
            "orthomosaic": (
                aerial.run_orthomosaic,
                {
                    "dem_resolution": float(
                        (pipeline.config or {}).get("dem_resolution", 0.25)
                    ),
                    "orthophoto_resolution": float(
                        (pipeline.config or {}).get("orthophoto_resolution", 0.25)
                    ),
                    "custom_odm_options": (pipeline.config or {}).get("custom_odm_options", ""),
                },
            ),
            "trait_extraction": (aerial.run_trait_extraction, {}),
            "inference": (
                aerial.run_inference,
                {
                    "models": [m.model_dump() for m in body.models],
                },
            ),
        }

    if step not in dispatch:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown or non-executable step '{step}' for {ptype} pipeline",
        )

    step_fn, kwargs = dispatch[step]
    runner.run_step_in_background(
        run_id=id,
        step=step,
        step_fn=step_fn,
        step_fn_kwargs=kwargs,
    )
    return {"status": "started", "step": step}


# ── Stop running step ─────────────────────────────────────────────────────────

@router.post("/pipeline-runs/{id}/stop")
def stop_step(
    session: SessionDep,
    current_user: CurrentUser,
    id: uuid.UUID,
) -> dict[str, str]:
    was_running = runner.request_stop(str(id))
    if not was_running:
        raise HTTPException(status_code=404, detail="No running step found for this run")
    return {"status": "stop_requested"}


# ── SSE progress stream ───────────────────────────────────────────────────────

@router.get("/pipeline-runs/{id}/progress")
def progress_stream(
    session: SessionDep,
    current_user: CurrentUser,
    id: uuid.UUID,
    offset: int = 0,
) -> StreamingResponse:
    _get_run_or_404(session, id)
    return StreamingResponse(
        runner.sse_stream(str(id), offset=offset),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── Outputs listing ───────────────────────────────────────────────────────────

@router.get("/pipeline-runs/{id}/outputs")
def list_outputs(
    session: SessionDep,
    current_user: CurrentUser,
    id: uuid.UUID,
) -> dict[str, Any]:
    run = _get_run_or_404(session, id)
    paths = _get_paths(session, run)

    # Resolve stored relative paths back to absolute and verify they exist
    resolved: dict[str, Any] = {}
    for key, rel_val in (run.outputs or {}).items():
        if isinstance(rel_val, str):
            abs_path = paths.abs(rel_val)
            resolved[key] = {
                "path": rel_val,
                "exists": abs_path.exists(),
                "is_dir": abs_path.is_dir() if abs_path.exists() else False,
            }
            # For directories, list their contents
            if abs_path.is_dir():
                resolved[key]["files"] = [
                    f.name for f in sorted(abs_path.iterdir()) if f.is_file()
                ]

    return {"outputs": resolved, "run_id": str(id)}


# ── Ground: plot marking ──────────────────────────────────────────────────────

class PlotMarkingRequest(BaseModel):
    selections: list[dict[str, Any]]  # see ground.save_plot_marking for schema


@router.post("/pipeline-runs/{id}/plot-marking")
def save_plot_marking(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    id: uuid.UUID,
    body: PlotMarkingRequest,
) -> dict[str, Any]:
    run = _get_run_or_404(session, id)
    pipeline = session.get(Pipeline, run.pipeline_id)
    if not pipeline or pipeline.type != "ground":
        raise HTTPException(status_code=400, detail="Not a ground pipeline")

    from app.processing.ground import save_plot_marking as _save

    outputs = _save(session=session, run_id=id, selections=body.selections)

    # Persist to run.outputs + mark step complete
    existing_outputs = dict(run.outputs or {})
    existing_outputs.update(outputs)
    existing_steps = dict(run.steps_completed or {})
    existing_steps["plot_marking"] = True

    update_pipeline_run(
        session=session,
        db_run=run,
        run_in=PipelineRunUpdate(
            steps_completed=existing_steps,
            outputs=existing_outputs,
        ),
    )
    return {"status": "saved", "outputs": outputs}


# ── Ground: image listing (for plot marking UI) ───────────────────────────────

@router.get("/pipeline-runs/{id}/images")
def list_images(
    session: SessionDep,
    current_user: CurrentUser,
    id: uuid.UUID,
    extensions: str = "jpg,jpeg,png",
) -> dict[str, Any]:
    run = _get_run_or_404(session, id)
    paths = _get_paths(session, run)

    if not paths.raw.exists():
        raise HTTPException(
            status_code=404,
            detail=f"Raw data directory not found: {paths.raw}",
        )

    exts = {f".{e.strip().lower()}" for e in extensions.split(",")}
    images = sorted(
        p for p in paths.raw.iterdir()
        if p.is_file() and p.suffix.lower() in exts
    )

    # Also check if msgs_synced.csv exists for GPS data
    msgs_synced_path = paths.msgs_synced
    has_gps = msgs_synced_path.exists()

    return {
        "images": [img.name for img in images],
        "count": len(images),
        "raw_dir": str(paths.raw),
        "has_gps": has_gps,
        "msgs_synced": str(msgs_synced_path) if has_gps else None,
    }


# ── Apply existing boundaries to a new run (ground + aerial) ─────────────────

@router.post("/pipeline-runs/{id}/apply-boundaries")
def apply_boundaries(
    session: SessionDep,
    current_user: CurrentUser,
    id: uuid.UUID,
) -> dict[str, Any]:
    """
    Mark the boundary step as complete on a new run using pipeline-level files.

    Ground: copies plot_borders.csv  → marks plot_marking complete.
    Aerial: copies Plot-Boundary-WGS84.geojson → marks plot_boundaries complete.

    Returns 404 if no saved boundaries exist yet for this pipeline.
    """
    run = _get_run_or_404(session, id)
    paths = _get_paths(session, run)
    pipeline = get_pipeline(session=session, id=run.pipeline_id)

    existing_outputs = dict(run.outputs or {})
    existing_steps = dict(run.steps_completed or {})

    if pipeline and pipeline.type == "aerial":
        if not paths.plot_boundary_geojson.exists():
            raise HTTPException(
                status_code=404,
                detail=(
                    "No Plot-Boundary-WGS84.geojson found for this pipeline. "
                    "Draw plot boundaries on an earlier run first."
                ),
            )
        existing_outputs["plot_boundaries"] = paths.rel(paths.plot_boundary_geojson)
        existing_steps["plot_boundaries"] = True
        update_pipeline_run(
            session=session,
            db_run=run,
            run_in=PipelineRunUpdate(steps_completed=existing_steps, outputs=existing_outputs),
        )
        return {"status": "applied", "plot_boundaries": paths.rel(paths.plot_boundary_geojson)}
    else:
        if not paths.plot_borders.exists():
            raise HTTPException(
                status_code=404,
                detail=(
                    "No plot_borders.csv found for this pipeline. "
                    "Create plot markings on an earlier run first."
                ),
            )
        existing_outputs["plot_marking"] = paths.rel(paths.plot_borders)
        existing_steps["plot_marking"] = True
        update_pipeline_run(
            session=session,
            db_run=run,
            run_in=PipelineRunUpdate(steps_completed=existing_steps, outputs=existing_outputs),
        )
        return {"status": "applied", "plot_borders": paths.rel(paths.plot_borders)}


# ── Aerial: GCP selection ─────────────────────────────────────────────────────

class GcpSelectionRequest(BaseModel):
    gcp_selections: list[dict[str, Any]]
    image_gps: list[dict[str, Any]]
    gcp_locations_csv: str | None = None  # inline CSV if not uploaded via files tab


@router.post("/pipeline-runs/{id}/gcp-selection")
def save_gcp_selection(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    id: uuid.UUID,
    body: GcpSelectionRequest,
) -> dict[str, Any]:
    run = _get_run_or_404(session, id)
    pipeline = session.get(Pipeline, run.pipeline_id)
    if not pipeline or pipeline.type != "aerial":
        raise HTTPException(status_code=400, detail="Not an aerial pipeline")

    from app.processing.aerial import save_gcp_selection as _save

    outputs = _save(
        session=session,
        run_id=id,
        gcp_selections=body.gcp_selections,
        image_gps=body.image_gps,
        gcp_locations_csv=body.gcp_locations_csv,
    )

    existing_outputs = dict(run.outputs or {})
    existing_outputs.update(outputs)
    existing_steps = dict(run.steps_completed or {})
    existing_steps["gcp_selection"] = True

    update_pipeline_run(
        session=session,
        db_run=run,
        run_in=PipelineRunUpdate(
            steps_completed=existing_steps,
            outputs=existing_outputs,
        ),
    )
    return {"status": "saved", "outputs": outputs}


# ── Aerial: GCP candidates (images near GCP coordinates) ─────────────────────

def _parse_gcp_csv(csv_path: Path) -> list[dict[str, Any]]:
    """Parse gcp_locations.csv → list of {label, lat, lon, alt}."""
    import csv as _csv
    gcps = []
    with open(csv_path, newline="") as f:
        # Normalise header: strip spaces and lowercase
        reader = _csv.DictReader(f)
        if not reader.fieldnames:
            return gcps
        norm = {k: k.strip().lower() for k in reader.fieldnames}
        for row in reader:
            nrow = {norm[k]: v.strip() for k, v in row.items() if k in norm}
            try:
                gcps.append({
                    "label": nrow.get("label", ""),
                    "lat":   float(nrow.get("lat_dec") or nrow.get("lat", 0)),
                    "lon":   float(nrow.get("lon_dec") or nrow.get("lon", 0)),
                    "alt":   float(nrow.get("altitude") or nrow.get("alt", 0)),
                })
            except (ValueError, KeyError):
                continue
    return gcps


def _read_exif_gps(img_path: Path) -> dict[str, float | None]:
    """Extract GPS lat/lon/alt from image EXIF. Returns None values if absent."""
    try:
        from PIL import Image
        from PIL.ExifTags import Base as ExifBase, GPSTAGS

        with Image.open(img_path) as img:
            exif = img.getexif()
            gps_info_raw = exif.get_ifd(ExifBase.GPSInfo)
            if not gps_info_raw:
                return {"lat": None, "lon": None, "alt": None}

            gps = {GPSTAGS.get(k, k): v for k, v in gps_info_raw.items()}

            def dms_to_deg(dms: tuple, ref: str) -> float:
                d, m, s = (float(x) for x in dms)
                deg = d + m / 60 + s / 3600
                return -deg if ref in ("S", "W") else deg

            lat = dms_to_deg(gps["GPSLatitude"], gps.get("GPSLatitudeRef", "N"))
            lon = dms_to_deg(gps["GPSLongitude"], gps.get("GPSLongitudeRef", "E"))
            alt_raw = gps.get("GPSAltitude")
            alt = float(alt_raw) if alt_raw is not None else None
            return {"lat": lat, "lon": lon, "alt": alt}
    except Exception:
        return {"lat": None, "lon": None, "alt": None}


@router.get("/pipeline-runs/{id}/gcp-candidates")
def gcp_candidates(
    session: SessionDep,
    current_user: CurrentUser,
    id: uuid.UUID,
) -> dict[str, Any]:
    """
    Return:
    - gcps: parsed list from gcp_locations.csv (label, lat, lon, alt)
    - images: all drone images with their EXIF GPS coordinates
    - has_gcp_locations: whether the CSV is available
    - raw_dir: absolute path to the raw image directory (for /files/serve)

    The frontend uses image GPS to sort candidates by proximity to each GCP
    and to build geo.txt when saving.
    """
    run = _get_run_or_404(session, id)
    paths = _get_paths(session, run)

    gcp_csv = paths.gcp_locations()
    has_gcp_csv = gcp_csv.exists()

    gcps: list[dict[str, Any]] = _parse_gcp_csv(gcp_csv) if has_gcp_csv else []

    images: list[dict[str, Any]] = []
    if paths.raw.exists():
        for p in sorted(paths.raw.iterdir()):
            if p.suffix.lower() in {".jpg", ".jpeg", ".png"}:
                gps = _read_exif_gps(p)
                images.append({"name": p.name, **gps})

    return {
        "has_gcp_locations": has_gcp_csv,
        "gcps": gcps,
        "images": images,
        "count": len(images),
        "raw_dir": str(paths.raw),
    }


# ── Aerial: inline GCP locations CSV upload ──────────────────────────────────

class SaveGcpLocationsRequest(BaseModel):
    csv_text: str  # raw CSV content pasted/uploaded by user


@router.post("/pipeline-runs/{id}/save-gcp-locations")
def save_gcp_locations(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    id: uuid.UUID,
    body: SaveGcpLocationsRequest,
) -> dict[str, Any]:
    """
    Save gcp_locations.csv inline (without going to the Files tab).
    Stored in Intermediate/{workspace}/{pop}/ and returned as parsed GCPs
    so the frontend can immediately render the picker.
    """
    run = _get_run_or_404(session, id)
    pipeline = session.get(Pipeline, run.pipeline_id)
    if not pipeline or pipeline.type != "aerial":
        raise HTTPException(status_code=400, detail="Not an aerial pipeline")

    paths = _get_paths(session, run)
    paths.intermediate_pipeline.mkdir(parents=True, exist_ok=True)
    paths.gcp_locations_intermediate.write_text(body.csv_text)
    logger.info("Saved inline gcp_locations.csv for run %s", id)

    gcps = _parse_gcp_csv(paths.gcp_locations_intermediate)
    return {"status": "saved", "gcps": gcps, "count": len(gcps)}


# ── Aerial: plot boundaries ───────────────────────────────────────────────────

class PlotBoundariesRequest(BaseModel):
    geojson: dict[str, Any]
    version: int | None = None  # None = overwrite canonical; int = save versioned copy


@router.post("/pipeline-runs/{id}/plot-boundaries")
def save_plot_boundaries(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    id: uuid.UUID,
    body: PlotBoundariesRequest,
) -> dict[str, Any]:
    run = _get_run_or_404(session, id)
    pipeline = session.get(Pipeline, run.pipeline_id)
    if not pipeline or pipeline.type != "aerial":
        raise HTTPException(status_code=400, detail="Not an aerial pipeline")

    from app.processing.aerial import save_plot_boundaries as _save

    outputs = _save(
        session=session,
        run_id=id,
        geojson=body.geojson,
        version=body.version,
    )

    existing_outputs = dict(run.outputs or {})
    existing_outputs.update(outputs)
    existing_steps = dict(run.steps_completed or {})
    existing_steps["plot_boundaries"] = True

    update_pipeline_run(
        session=session,
        db_run=run,
        run_in=PipelineRunUpdate(
            steps_completed=existing_steps,
            outputs=existing_outputs,
        ),
    )
    return {"status": "saved", "outputs": outputs}


# ── GeoTIFF bounds reader (pure Python, no GDAL) ─────────────────────────────

def _read_geotiff_wgs84_bounds(
    tif_path: Path,
) -> list[list[float]] | None:
    """
    Read the WGS84 bounding box from a GeoTIFF using only the Python standard
    library (struct) — no rasterio/GDAL required, which keeps the PyInstaller
    bundle simple.

    Handles the common case where the TIF is already in WGS84 (EPSG:4326) and
    uses the ModelTiepointTag + ModelPixelScaleTag TIFF tags to compute bounds.
    Returns [[southLat, westLon], [northLat, eastLon]] for Leaflet, or None if
    the bounds cannot be determined.

    Limitations:
    - Only works for TIFs stored in geographic WGS84 (lat/lon degrees).
    - Projected CRS (UTM etc.) will return None — the frontend shows a "not
      available" message and the user cannot draw boundaries without the
      orthomosaic overlay.  In that case the ODM output should be re-exported
      to WGS84 before this step.
    """
    import struct

    with open(tif_path, "rb") as f:
        header = f.read(4)
        if header[:2] == b"II":
            endian = "<"  # little-endian
        elif header[:2] == b"MM":
            endian = ">"  # big-endian
        else:
            return None

        magic = struct.unpack(endian + "H", header[2:4])[0]
        bigtiff = magic == 43
        if magic not in (42, 43):
            return None

        if bigtiff:
            f.read(4)  # offset size, constant offset
            ifd_offset = struct.unpack(endian + "Q", f.read(8))[0]
        else:
            ifd_offset = struct.unpack(endian + "I", f.read(4))[0]

        f.seek(ifd_offset)
        if bigtiff:
            entry_count = struct.unpack(endian + "Q", f.read(8))[0]
            entry_fmt, entry_size = endian + "HHQ", 20
        else:
            entry_count = struct.unpack(endian + "H", f.read(2))[0]
            entry_fmt, entry_size = endian + "HHI", 12

        # GeoTIFF tags we care about
        TAG_MODEL_PIXEL_SCALE  = 33550  # (ScaleX, ScaleY, ScaleZ)
        TAG_MODEL_TIEPOINT     = 33922  # (I,J,K, X,Y,Z) × N
        TAG_GEO_KEY_DIRECTORY  = 34735  # confirms WGS84 geographic CRS

        tag_data: dict[int, bytes] = {}

        for _ in range(min(entry_count, 512)):
            raw = f.read(entry_size)
            if len(raw) < entry_size:
                break
            if bigtiff:
                tag, dtype, count, value_or_offset = struct.unpack(entry_fmt, raw)
            else:
                tag, dtype, count, value_or_offset = struct.unpack(entry_fmt, raw)

            if tag not in (TAG_MODEL_PIXEL_SCALE, TAG_MODEL_TIEPOINT, TAG_GEO_KEY_DIRECTORY):
                continue

            # Determine byte size of the value
            TYPE_SIZES = {1:1, 2:1, 3:2, 4:4, 5:8, 6:1, 7:1, 8:2, 9:4, 10:8, 11:4, 12:8, 16:8, 17:8, 18:8}
            item_size = TYPE_SIZES.get(dtype, 1)
            total = item_size * count

            pos = f.tell()
            if bigtiff:
                if total <= 8:
                    data = raw[-8:][:total]
                else:
                    f.seek(value_or_offset)
                    data = f.read(total)
            else:
                if total <= 4:
                    data = raw[-4:][:total]
                else:
                    f.seek(value_or_offset)
                    data = f.read(total)
            f.seek(pos)

            tag_data[tag] = (dtype, count, data)

        def read_doubles(dtype: int, count: int, data: bytes) -> list[float]:
            if dtype == 12:  # DOUBLE
                return list(struct.unpack(endian + "d" * count, data[:8 * count]))
            if dtype == 11:  # FLOAT
                return [float(x) for x in struct.unpack(endian + "f" * count, data[:4 * count])]
            return []

        if TAG_MODEL_PIXEL_SCALE not in tag_data or TAG_MODEL_TIEPOINT not in tag_data:
            return None

        ps_dtype, ps_count, ps_data = tag_data[TAG_MODEL_PIXEL_SCALE]
        tp_dtype, tp_count, tp_data = tag_data[TAG_MODEL_TIEPOINT]

        scales = read_doubles(ps_dtype, ps_count, ps_data)
        tiepoints = read_doubles(tp_dtype, tp_count, tp_data)

        if len(scales) < 2 or len(tiepoints) < 6:
            return None

        scale_x, scale_y = scales[0], scales[1]
        # Tiepoint: (pixel_i, pixel_j, pixel_k, world_x, world_y, world_z)
        tp_i, tp_j, _, tp_x, tp_y, _ = tiepoints[:6]

        # Image dimensions from standard TIFF tags (256=ImageWidth, 257=ImageLength)
        # We need a second pass — simplest approach: re-read width/height
        f.seek(ifd_offset)
        if bigtiff:
            ec2 = struct.unpack(endian + "Q", f.read(8))[0]
        else:
            ec2 = struct.unpack(endian + "H", f.read(2))[0]

        width = height = None
        for _ in range(min(ec2, 512)):
            raw = f.read(entry_size)
            if len(raw) < entry_size:
                break
            if bigtiff:
                tag2, dtype2, count2, val2 = struct.unpack(entry_fmt, raw)
            else:
                tag2, dtype2, count2, val2 = struct.unpack(entry_fmt, raw)
            if tag2 == 256:  # ImageWidth
                width = val2
            elif tag2 == 257:  # ImageLength
                height = val2
            if width and height:
                break

        if not width or not height:
            return None

        # Top-left corner in geographic coords
        west = tp_x - tp_i * scale_x
        north = tp_y + tp_j * scale_y  # scale_y is negative for north-up, stored positive

        east = west + width * scale_x
        south = north - height * scale_y

        # Sanity check: must be valid lat/lon ranges
        if not (-180 <= west <= 180 and -180 <= east <= 180):
            return None
        if not (-90 <= south <= 90 and -90 <= north <= 90):
            return None

        return [[south, west], [north, east]]


# ── Aerial: orthomosaic info (for BoundaryDrawer) ────────────────────────────

@router.get("/pipeline-runs/{id}/orthomosaic-info")
def orthomosaic_info(
    session: SessionDep,
    current_user: CurrentUser,
    id: uuid.UUID,
) -> dict[str, Any]:
    """
    Return the orthomosaic path and WGS84 bounding box so the frontend can
    render it as a Leaflet ImageOverlay and let the user draw plot polygons.

    Returns:
        {
          "available": bool,
          "path": str | None,        # absolute path for /files/serve
          "bounds": [[s, w], [n, e]] | None,  # Leaflet LatLngBounds format
          "existing_geojson": {...} | None,   # if Plot-Boundary-WGS84.geojson exists
        }
    """
    run = _get_run_or_404(session, id)
    pipeline = session.get(Pipeline, run.pipeline_id)
    if not pipeline or pipeline.type != "aerial":
        raise HTTPException(status_code=400, detail="Not an aerial pipeline")

    paths = _get_paths(session, run)

    # Prefer the Pyramid/COG if it exists, fall back to full RGB
    tif = paths.aerial_rgb_pyramid if paths.aerial_rgb_pyramid.exists() else paths.aerial_rgb

    if not tif.exists():
        return {
            "available": False,
            "path": None,
            "bounds": None,
            "existing_geojson": None,
        }

    # Read WGS84 bounds — prefer rasterio (handles UTM + any CRS), fall back to
    # pure-Python parser for WGS84-only TIFs when rasterio is unavailable.
    bounds = None
    try:
        import rasterio
        from rasterio.crs import CRS
        from rasterio.warp import transform_bounds

        with rasterio.open(tif) as src:
            left, bottom, right, top = transform_bounds(
                src.crs,
                CRS.from_epsg(4326),
                src.bounds.left,
                src.bounds.bottom,
                src.bounds.right,
                src.bounds.top,
            )
        bounds = [[bottom, left], [top, right]]
    except Exception as exc:
        logger.warning("rasterio bounds failed (%s), trying pure-Python parser", exc)
        try:
            bounds = _read_geotiff_wgs84_bounds(tif)
        except Exception as exc2:
            logger.warning("Could not read orthomosaic bounds: %s", exc2)

    # Load existing boundary GeoJSON if present
    existing_geojson = None
    if paths.plot_boundary_geojson.exists():
        try:
            existing_geojson = json.loads(paths.plot_boundary_geojson.read_text())
        except Exception:
            pass

    return {
        "available": True,
        "path": str(tif),
        "bounds": bounds,
        "existing_geojson": existing_geojson,
    }


# ── Shared: inference results ────────────────────────────────────────────────

@router.get("/pipeline-runs/{id}/inference-results")
def inference_results(
    session: SessionDep,
    current_user: CurrentUser,
    id: uuid.UUID,
    model: str | None = None,
) -> dict[str, Any]:
    """
    Return parsed predictions CSV + image list for the inference viewer.

    `model` query param selects which model's results to return (defaults to first).

    Response:
        {
          "available": bool,
          "models": ["ModelA", "ModelB"],   # all available model labels
          "active_model": "ModelA",
          "predictions": [...],
          "images": [{"name": str, "path": str}, ...]
        }
    """
    import csv as _csv

    run = _get_run_or_404(session, id)
    paths = _get_paths(session, run)
    pipeline = session.get(Pipeline, run.pipeline_id)
    outputs = run.outputs or {}

    inference_out = outputs.get("inference")
    if not inference_out:
        return {"available": False, "models": [], "active_model": None, "predictions": [], "images": []}

    # Support both old format (single path string) and new format (dict keyed by label)
    if isinstance(inference_out, str):
        model_paths: dict[str, str] = {"Results": inference_out}
    else:
        model_paths = dict(inference_out)

    available_models = list(model_paths.keys())
    active_model = model if model in model_paths else available_models[0]
    csv_path = paths.abs(model_paths[active_model])

    if not csv_path.exists():
        return {"available": False, "models": available_models, "active_model": active_model, "predictions": [], "images": []}

    rows: list[dict] = []
    with open(csv_path, newline="") as f:
        for row in _csv.DictReader(f):
            try:
                rows.append({
                    "image": row.get("image", ""),
                    "class": row.get("class", ""),
                    "confidence": round(float(row.get("confidence", 0)), 4),
                    "x": float(row.get("x", 0)),
                    "y": float(row.get("y", 0)),
                    "width": float(row.get("width", 0)),
                    "height": float(row.get("height", 0)),
                })
            except (ValueError, TypeError):
                continue

    # Image list (absolute paths for /files/serve)
    if pipeline and pipeline.type == "aerial":
        img_dir = paths.cropped_images_dir
    else:
        version = int(outputs.get("stitching_version", 1))
        img_dir = paths.agrowstitch_dir(int(version))

    images: list[dict] = []
    if img_dir.exists():
        for f in sorted(img_dir.glob("*.png")):
            images.append({"name": f.name, "path": str(f)})

    return {
        "available": True,
        "models": available_models,
        "active_model": active_model,
        "predictions": rows,
        "images": images,
    }


# ── Shared: download crops as ZIP ────────────────────────────────────────────

@router.post("/pipeline-runs/{id}/download-crops")
def download_crops(
    session: SessionDep,
    current_user: CurrentUser,
    id: uuid.UUID,
) -> StreamingResponse:
    run = _get_run_or_404(session, id)
    paths = _get_paths(session, run)
    pipeline = session.get(Pipeline, run.pipeline_id)

    # Ground uses AgRowStitch output dir; aerial uses cropped_images/
    if pipeline and pipeline.type == "aerial":
        crop_dir = paths.cropped_images_dir
    else:
        version = int((run.outputs or {}).get("stitching_version", 1))
        crop_dir = paths.agrowstitch_dir(version)

    if not crop_dir.exists():
        raise HTTPException(status_code=404, detail="No crop images found for this run")

    images = sorted(p for p in crop_dir.iterdir()
                    if p.suffix.lower() in {".jpg", ".jpeg", ".png", ".tif"})
    if not images:
        raise HTTPException(status_code=404, detail="No image files found in crop directory")

    def zip_stream() -> Any:
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            for img in images:
                zf.write(img, img.name)
                buf.seek(0)
                yield buf.read()
                buf.seek(0)
                buf.truncate()

    filename = f"crops_{run.date}_{run.population}.zip"
    return StreamingResponse(
        zip_stream(),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
