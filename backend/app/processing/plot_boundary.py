"""
Shared plot boundary preparation logic used by both ground and aerial pipelines.

Steps
-----
1. generate_plot_grid — port of PlotProposalSwitcher.fillPolygonWithRectangles:
   Takes a population boundary polygon + grid options + optional field design CSV
   and returns a Plot-Boundary-WGS84.geojson FeatureCollection.

2. run_associate_boundaries (ground only, compute step) — for each georeferenced
   plot TIF produced by AgRowStitch, compute its WGS84 centre point and find which
   plot polygon it falls inside.  Writes an association CSV and updates
   plot_borders.csv with Plot/Accession labels from the field design.
"""

from __future__ import annotations

import csv
import json
import logging
import math
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


# ── Geometry helpers (no external deps beyond shapely) ────────────────────────

def _deg_scale(lat_deg: float) -> float:
    """Degrees-per-metre scale factor at a given latitude."""
    return 1.0 / (111_320 * math.cos(math.radians(lat_deg)))


def _bbox_polygon(west: float, south: float, east: float, north: float) -> dict[str, Any]:
    """Return a GeoJSON Polygon for a bounding box."""
    coords = [
        [west, south],
        [east, south],
        [east, north],
        [west, north],
        [west, south],
    ]
    return {"type": "Polygon", "coordinates": [coords]}


def _rotate_point(px: float, py: float, cx: float, cy: float, angle_deg: float) -> tuple[float, float]:
    """Rotate point (px, py) around centre (cx, cy) by angle_deg degrees."""
    rad = math.radians(angle_deg)
    cos_a, sin_a = math.cos(rad), math.sin(rad)
    dx, dy = px - cx, py - cy
    return (cx + dx * cos_a - dy * sin_a, cy + dx * sin_a + dy * cos_a)


def _rotate_polygon(coords: list[list[float]], cx: float, cy: float, angle_deg: float) -> list[list[float]]:
    """Rotate a ring of [lon, lat] coords around centre."""
    return [list(_rotate_point(p[0], p[1], cx, cy, angle_deg)) for p in coords]


def _centroid(geojson_polygon: dict[str, Any]) -> tuple[float, float]:
    """Approximate centroid of a GeoJSON Polygon (average of exterior ring vertices)."""
    ring = geojson_polygon["coordinates"][0]
    lons = [p[0] for p in ring[:-1]]
    lats = [p[1] for p in ring[:-1]]
    return sum(lons) / len(lons), sum(lats) / len(lats)


# ── Field design CSV parser ───────────────────────────────────────────────────

def _parse_field_design(csv_path: Path) -> list[dict[str, str]]:
    """Parse field design CSV.  Returns list of row dicts with normalised keys."""
    rows: list[dict[str, str]] = []
    with open(csv_path, newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            # normalise key whitespace
            rows.append({k.strip(): v.strip() for k, v in row.items()})
    return rows


def _merge_field_design(features: list[dict[str, Any]], fd_rows: list[dict[str, str]]) -> None:
    """Merge field design data into GeoJSON feature properties by (row, col) match."""
    for feat in features:
        props = feat["properties"]
        row_idx = props.get("row")
        col_idx = props.get("column")
        match = next(
            (r for r in fd_rows if r.get("row") == str(row_idx) and r.get("col") == str(col_idx)),
            None,
        )
        if match:
            for k, v in match.items():
                if k not in ("row", "col"):
                    props[k] = v
        else:
            props.setdefault("plot", f"{row_idx}_{col_idx}")


# ── Grid generation ───────────────────────────────────────────────────────────

def generate_plot_grid(
    *,
    pop_boundary: dict[str, Any],  # GeoJSON Polygon feature or FeatureCollection
    options: dict[str, Any],       # width, length, rows, columns, verticalSpacing, horizontalSpacing, angle
    field_design_path: Path | None = None,
) -> dict[str, Any]:
    """
    Port of PlotProposalSwitcher.fillPolygonWithRectangles.

    Parameters
    ----------
    pop_boundary
        GeoJSON Feature (Polygon) or FeatureCollection (first feature used).
    options
        width, length (metres), rows, columns (int),
        verticalSpacing, horizontalSpacing (metres), angle (degrees).
    field_design_path
        Optional path to field_design.csv; if provided its (row,col) data is
        merged into the generated feature properties.

    Returns
    -------
    GeoJSON FeatureCollection of plot rectangles.
    """
    # Accept either a Feature or FeatureCollection
    if pop_boundary.get("type") == "FeatureCollection":
        main_geom = pop_boundary["features"][0]["geometry"]
    elif pop_boundary.get("type") == "Feature":
        main_geom = pop_boundary["geometry"]
    else:
        main_geom = pop_boundary  # bare geometry

    cx, cy = _centroid(main_geom)
    scale = _deg_scale(cy)

    width_deg  = options["width"] * scale
    length_deg = options["length"] * scale
    vspace_deg = options.get("verticalSpacing", 0) * scale
    hspace_deg = options.get("horizontalSpacing", 0) * scale
    rows       = int(options["rows"])
    cols       = int(options["columns"])
    angle      = float(options.get("angle", 0))

    total_w = cols * (width_deg + hspace_deg) - hspace_deg
    total_h = rows * (length_deg + vspace_deg) - vspace_deg

    features: list[dict[str, Any]] = []
    for i in range(rows):
        for j in range(cols):
            x = cx - total_w / 2 + j * (width_deg + hspace_deg)
            y = cy + total_h / 2 - i * (length_deg + vspace_deg) - length_deg

            ring = [
                [x,              y],
                [x + width_deg,  y],
                [x + width_deg,  y + length_deg],
                [x,              y + length_deg],
                [x,              y],
            ]

            if angle != 0:
                ring = _rotate_polygon(ring, cx, cy, angle)

            features.append({
                "type": "Feature",
                "geometry": {"type": "Polygon", "coordinates": [ring]},
                "properties": {"row": i + 1, "column": j + 1},
            })

    if field_design_path and field_design_path.exists():
        fd_rows = _parse_field_design(field_design_path)
        _merge_field_design(features, fd_rows)

    return {"type": "FeatureCollection", "features": features}


# ── Ground: associate stitched plots with boundary polygons ───────────────────

def run_associate_boundaries(
    *,
    session: Any,
    run_id: Any,
    stop_event: Any,
    emit: Any,
) -> None:
    """
    Compute step (ground only).

    For each georeferenced plot TIF produced by AgRowStitch, compute its
    WGS84 centre point and find which plot polygon in Plot-Boundary-WGS84.geojson
    it falls inside.  Writes:
      - Intermediate/.../association.csv  (plot_tif → plot_id, row, col, accession, …)
      - Updates plot_borders.csv with labels from matched polygon properties.
    """
    from app.crud.pipeline import get_pipeline_run, get_pipeline
    from app.core.paths import RunPaths
    from app.models.workspace import Workspace
    from app.models.pipeline import PipelineRunUpdate
    from app.crud.pipeline import update_pipeline_run

    run = get_pipeline_run(session=session, id=run_id)
    pipeline = get_pipeline(session=session, id=run.pipeline_id)
    workspace = session.get(Workspace, pipeline.workspace_id)
    paths = RunPaths.from_db(session=session, run=run, workspace=workspace)

    emit({"event": "progress", "message": "Loading plot boundaries…"})

    if not paths.plot_boundary_geojson.exists():
        raise FileNotFoundError(
            "Plot-Boundary-WGS84.geojson not found. "
            "Complete the Plot Boundary Prep step first."
        )

    with open(paths.plot_boundary_geojson) as f:
        boundary_fc = json.load(f)

    boundary_polys = []
    for feat in boundary_fc.get("features", []):
        try:
            from shapely.geometry import shape
            poly = shape(feat["geometry"])
            boundary_polys.append((poly, feat.get("properties", {})))
        except Exception as exc:
            logger.warning("Skipping invalid boundary feature: %s", exc)

    if not boundary_polys:
        raise ValueError("No valid boundary polygons found in Plot-Boundary-WGS84.geojson")

    # Find georeferenced plot TIFs from stitching output
    stitch_version = int((run.outputs or {}).get("stitching_version", 1))
    stitch_dir = paths.agrowstitch_dir(stitch_version)

    if not stitch_dir.exists():
        raise FileNotFoundError(f"AgRowStitch output not found: {stitch_dir}")

    emit({"event": "progress", "message": "Reading georeferenced plot TIFs…"})

    # Find UTM TIFs; fall back to looking for any TIF
    utm_tifs = sorted(stitch_dir.glob("georeferenced_plot_*_utm.tif"))
    if not utm_tifs:
        utm_tifs = sorted(stitch_dir.glob("*.tif"))

    if not utm_tifs:
        raise FileNotFoundError("No georeferenced TIF files found in AgRowStitch output")

    import rasterio
    from rasterio.crs import CRS
    from rasterio.warp import transform
    from shapely.geometry import Point

    wgs84 = CRS.from_epsg(4326)
    associations: list[dict[str, Any]] = []

    for idx, tif_path in enumerate(utm_tifs):
        if stop_event.is_set():
            emit({"event": "cancelled", "message": "Stopped by user"})
            return

        emit({"event": "progress", "message": f"Matching plot {idx + 1}/{len(utm_tifs)}…",
              "index": idx, "total": len(utm_tifs),
              "progress": round(100 * idx / len(utm_tifs))})

        try:
            with rasterio.open(tif_path) as src:
                b = src.bounds
                center_x = (b.left + b.right) / 2
                center_y = (b.top + b.bottom) / 2
                # Transform centre to WGS84
                xs, ys = transform(src.crs, wgs84, [center_x], [center_y])
                center_wgs84 = Point(xs[0], ys[0])
        except Exception as exc:
            logger.warning("Could not read %s: %s", tif_path.name, exc)
            associations.append({"plot_tif": tif_path.name, "matched": False})
            continue

        matched_props: dict[str, Any] = {}
        for poly, props in boundary_polys:
            if poly.contains(center_wgs84):
                matched_props = props
                break

        associations.append({
            "plot_tif": tif_path.name,
            "matched": bool(matched_props),
            **matched_props,
        })

    # Write association CSV
    assoc_path = paths.intermediate_run / "association.csv"
    if associations:
        fieldnames = list(dict.fromkeys(k for row in associations for k in row))
        with open(assoc_path, "w", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
            writer.writeheader()
            writer.writerows(associations)

    matched = sum(1 for a in associations if a.get("matched"))
    emit({
        "event": "complete",
        "message": f"Associated {matched}/{len(associations)} plots with boundary polygons",
        "outputs": {"association": paths.rel(assoc_path)},
    })
