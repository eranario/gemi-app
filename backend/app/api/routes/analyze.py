"""
Analyze endpoints — read-only views of pipeline run outputs.

GET /api/v1/analyze/runs                          list analyzable runs
GET /api/v1/analyze/runs/{run_id}/traits          GeoJSON + numeric metric columns
GET /api/v1/analyze/runs/{run_id}/ortho-info      mosaic path + WGS84 bounds
"""

from __future__ import annotations

import csv as _csv
import json
import logging
import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from sqlmodel import Session, select

from app.api.deps import CurrentUser, SessionDep
from app.core.paths import RunPaths
from app.crud.pipeline import get_pipeline_run
from app.models.pipeline import Pipeline, PipelineRun
from app.models.workspace import Workspace

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/analyze", tags=["analyze"])


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_paths(session: Session, run: PipelineRun) -> RunPaths:
    pipeline = session.get(Pipeline, run.pipeline_id)
    workspace = session.get(Workspace, pipeline.workspace_id)
    return RunPaths.from_db(session=session, run=run, workspace=workspace)


def _is_analyzable(run: PipelineRun, pipeline: Pipeline) -> bool:
    """True if the run has at least one output we can visualise."""
    outputs = run.outputs or {}
    if pipeline.type == "aerial":
        return bool(outputs.get("traits_geojson") or outputs.get("orthomosaic") or outputs.get("inference"))
    else:
        return bool(outputs.get("georeferencing") or outputs.get("plot_boundaries_geojson") or outputs.get("inference"))


def _read_tif_bounds(tif: Path) -> list[list[float]] | None:
    """Return [[south, west], [north, east]] from a GeoTIFF using rasterio."""
    try:
        import rasterio
        from rasterio.crs import CRS
        from rasterio.warp import transform_bounds

        with rasterio.open(tif) as src:
            l, b, r, t = transform_bounds(src.crs, CRS.from_epsg(4326), *src.bounds)
        return [[b, l], [t, r]]
    except Exception as exc:
        logger.warning("rasterio bounds failed for %s: %s", tif.name, exc)
        return None


def _numeric_columns(features: list[dict]) -> list[str]:
    """Return sorted list of numeric property keys found across all features."""
    cols: set[str] = set()
    skip = {"plot_id", "plot", "accession"}
    for f in features:
        props = f.get("properties") or {}
        for k, v in props.items():
            if k in skip:
                continue
            if isinstance(v, (int, float)) and v is not True and v is not False:
                cols.add(k)
    return sorted(cols)


# ── 1. List analyzable runs ───────────────────────────────────────────────────

@router.get("/runs")
def list_runs(
    session: SessionDep,
    current_user: CurrentUser,
) -> list[dict[str, Any]]:
    """
    Return all pipeline runs that have at least one analyzable output.
    Includes workspace name, pipeline name/type, run date, and a list of
    available output types (badges).
    """
    runs = session.exec(select(PipelineRun)).all()

    result = []
    for run in runs:
        pipeline = session.get(Pipeline, run.pipeline_id)
        if not pipeline:
            continue
        if not _is_analyzable(run, pipeline):
            continue

        workspace = session.get(Workspace, pipeline.workspace_id)
        outputs = run.outputs or {}

        available: list[str] = []
        if pipeline.type == "aerial":
            if outputs.get("traits_geojson"):
                available.append("traits")
            if outputs.get("orthomosaic"):
                available.append("orthomosaic")
        else:
            if outputs.get("plot_boundaries_geojson"):
                available.append("boundaries")
            if outputs.get("georeferencing"):
                available.append("mosaic")
        if outputs.get("inference"):
            available.append("inference")

        result.append({
            "run_id": str(run.id),
            "pipeline_id": str(pipeline.id),
            "pipeline_name": pipeline.name,
            "pipeline_type": pipeline.type,
            "workspace_name": workspace.name if workspace else "",
            "date": run.date,
            "experiment": run.experiment,
            "location": run.location,
            "population": run.population,
            "platform": run.platform,
            "sensor": run.sensor,
            "status": run.status,
            "available": available,
            "created_at": run.created_at,
        })

    result.sort(key=lambda r: r["created_at"], reverse=True)
    return result


# ── 2. Traits GeoJSON ─────────────────────────────────────────────────────────

@router.get("/runs/{run_id}/traits")
def get_traits(
    session: SessionDep,
    current_user: CurrentUser,
    run_id: uuid.UUID,
) -> dict[str, Any]:
    """
    Return a GeoJSON FeatureCollection with plot polygons + numeric properties.

    Aerial: reads traits_geojson directly.
    Ground: joins plot_boundaries.geojson with inference CSVs — aggregates
            per-class detection counts per plot so both pipeline types share
            the same response shape.

    Response also includes `metric_columns` — sorted list of numeric property
    keys for the MetricSelector dropdown.
    """
    run = session.get(PipelineRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    pipeline = session.get(Pipeline, run.pipeline_id)
    paths = _get_paths(session, run)
    outputs = run.outputs or {}

    if pipeline and pipeline.type == "aerial":
        traits_rel = outputs.get("traits_geojson")
        if not traits_rel:
            raise HTTPException(status_code=404, detail="No traits GeoJSON for this run")
        traits_path = paths.abs(traits_rel)
        if not traits_path.exists():
            raise HTTPException(status_code=404, detail=f"Traits file not found: {traits_rel}")
        geojson = json.loads(traits_path.read_text())

    else:
        # Ground: build from plot_boundaries.geojson + inference CSVs
        geo_rel = outputs.get("plot_boundaries_geojson")
        if not geo_rel:
            raise HTTPException(status_code=404, detail="No plot boundaries for this run. Complete georeferencing first.")
        geo_path = paths.abs(geo_rel)
        if not geo_path.exists():
            raise HTTPException(status_code=404, detail="plot_boundaries.geojson not found on disk")

        geojson = json.loads(geo_path.read_text())

        # Aggregate inference counts per plot image → join on plot_id
        inference_out = outputs.get("inference")
        if inference_out:
            if isinstance(inference_out, str):
                model_paths: dict[str, str] = {"Results": inference_out}
            else:
                model_paths = dict(inference_out)

            # Build {plot_id: {class_label: count}} mapping
            plot_counts: dict[str, dict[str, int]] = {}
            for label, rel_path in model_paths.items():
                csv_path = paths.abs(rel_path)
                if not csv_path.exists():
                    continue
                with open(csv_path, newline="") as f:
                    for row in _csv.DictReader(f):
                        img_name = row.get("image", "")
                        # Image names match stitched plot filenames which encode plot_id
                        # e.g. full_res_mosaic_temp_plot_3.png → plot_id "3"
                        plot_id = _extract_plot_id(img_name)
                        if plot_id is None:
                            continue
                        cls = row.get("class", label)
                        col_key = f"{label}_{cls}_count" if len(model_paths) > 1 else f"{cls}_count"
                        plot_counts.setdefault(plot_id, {})[col_key] = (
                            plot_counts.get(plot_id, {}).get(col_key, 0) + 1
                        )

            # Add detection count columns to each feature's properties
            for feature in geojson.get("features", []):
                pid = str(feature.get("properties", {}).get("plot_id", ""))
                counts = plot_counts.get(pid, {})
                feature.setdefault("properties", {}).update(counts)
                if counts:
                    feature["properties"]["total_detections"] = sum(counts.values())

    features = geojson.get("features", [])
    metric_columns = _numeric_columns(features)

    return {
        "geojson": geojson,
        "metric_columns": metric_columns,
        "feature_count": len(features),
    }


def _extract_plot_id(filename: str) -> str | None:
    """Extract numeric plot_id from stitched image filename."""
    import re
    # full_res_mosaic_temp_plot_3.png  or  AgRowStitch_plot-id-3.png
    m = re.search(r"plot[_\-](?:id[_\-])?(\d+)", filename)
    return m.group(1) if m else None


# ── 3. Ortho info (mosaic path + bounds for map overlay) ─────────────────────

@router.get("/runs/{run_id}/ortho-info")
def get_ortho_info(
    session: SessionDep,
    current_user: CurrentUser,
    run_id: uuid.UUID,
) -> dict[str, Any]:
    """
    Return the path and WGS84 bounds of the mosaic image for map display.

    Aerial: {date}-RGB.tif (or Pyramid.tif)
    Ground: combined_mosaic.tif from georeferencing output dir

    Response:
        { available, path, bounds: [[s,w],[n,e]] }
    """
    run = session.get(PipelineRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    pipeline = session.get(Pipeline, run.pipeline_id)
    paths = _get_paths(session, run)
    outputs = run.outputs or {}

    not_available = {"available": False, "path": None, "bounds": None}

    if pipeline and pipeline.type == "ground":
        geo_rel = outputs.get("georeferencing")
        if not geo_rel:
            return not_available
        tif = paths.abs(geo_rel) / "combined_mosaic.tif"
    else:
        tif = paths.aerial_rgb_pyramid if paths.aerial_rgb_pyramid.exists() else paths.aerial_rgb

    if not tif.exists():
        return not_available

    bounds = _read_tif_bounds(tif)
    return {"available": True, "path": str(tif), "bounds": bounds}
