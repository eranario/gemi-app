"""
Aerial (drone) pipeline step implementations.

Steps
-----
1. gcp_selection    — user marks GCP pixel locations; save gcp_list.txt + geo.txt
2. orthomosaic      — run ODM via Docker to produce RGB.tif + DEM.tif
3. plot_boundaries  — save user-drawn GeoJSON polygons from Leaflet
4. trait_extraction — vegetation fraction, height, temperature per plot
5. inference        — Roboflow on split plot images (optional)
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Callable

import numpy as np
from sqlmodel import Session

from app.core.paths import RunPaths
from app.models.workspace import Workspace

logger = logging.getLogger(__name__)


def _get_paths(session: Session, run_id: uuid.UUID) -> RunPaths:
    from app.models.pipeline import Pipeline, PipelineRun

    run = session.get(PipelineRun, run_id)
    if not run:
        raise ValueError(f"Run {run_id} not found")
    pipeline = session.get(Pipeline, run.pipeline_id)
    if not pipeline:
        raise ValueError(f"Pipeline {run.pipeline_id} not found")
    workspace = session.get(Workspace, pipeline.workspace_id)
    if not workspace:
        raise ValueError(f"Workspace {pipeline.workspace_id} not found")
    return RunPaths.from_db(session=session, run=run, workspace=workspace)


# ── Step 1: GCP Selection (data persistence only) ─────────────────────────────

def save_gcp_selection(
    *,
    session: Session,
    run_id: uuid.UUID,
    gcp_selections: list[dict[str, Any]],
    image_gps: list[dict[str, Any]],
    gcp_locations_csv: str | None = None,
) -> dict[str, str]:
    """
    Save GCP pixel selections and image GPS list.

    gcp_selections: [
        {"label": "GCP1", "image": "DJI_0001.jpg",
         "pixel_x": 1024, "pixel_y": 768,
         "lat": 33.1, "lon": -111.9, "alt": 380.0},
        ...
    ]

    image_gps: [
        {"image": "DJI_0001.jpg", "lat": 33.1, "lon": -111.9, "alt": 380.0},
        ...
    ]

    gcp_locations_csv: optional raw CSV text if uploaded inline at GCP picker step.
                       Saved to Intermediate/{pipeline}/ and Raw/{pop}/ if absent.
    """
    paths = _get_paths(session, run_id)
    paths.intermediate_run.mkdir(parents=True, exist_ok=True)

    # Save gcp_list.txt (ODM format: lat lon alt pixel_x pixel_y image)
    with open(paths.gcp_list, "w") as f:
        f.write("WGS84\n")
        for sel in gcp_selections:
            f.write(
                f"{sel['lat']} {sel['lon']} {sel['alt']} "
                f"{sel['pixel_x']} {sel['pixel_y']} {sel['image']}\n"
            )

    # Save geo.txt (ODM format: image lat lon alt)
    with open(paths.geo_txt, "w") as f:
        for img in image_gps:
            f.write(f"{img['image']} {img['lat']} {img['lon']} {img['alt']}\n")

    # Save inline gcp_locations.csv if provided
    if gcp_locations_csv:
        gcp_csv_path = paths.gcp_locations_intermediate
        gcp_csv_path.parent.mkdir(parents=True, exist_ok=True)
        gcp_csv_path.write_text(gcp_locations_csv)
        logger.info("Saved inline gcp_locations.csv to %s", gcp_csv_path)

    logger.info("Saved GCP selection for run %s (%d GCPs)", run_id, len(gcp_selections))
    return {
        "gcp_selection": paths.rel(paths.gcp_list),
        "geo_txt": paths.rel(paths.geo_txt),
    }


# ── Step 2: Orthomosaic Generation (ODM via Docker) ───────────────────────────

_ODM_PROGRESS_STAGES = [
    "Running dataset stage",
    "Finished dataset stage",
    "Computing pair matching",
    "Merging features onto tracks",
    "Export reconstruction stats",
    "Finished opensfm stage",
    "Densifying point-cloud completed",
    "Finished openmvs stage",
    "Finished odm_filterpoints stage",
    "Finished mvs_texturing stage",
    "Finished odm_georeferencing stage",
    "Finished odm_dem stage",
    "Finished odm_orthophoto stage",
    "Finished odm_report stage",
    "Finished odm_postprocess stage",
    "ODM app finished",
]


def _check_docker() -> bool:
    return shutil.which("docker") is not None


def _check_gpu() -> bool:
    try:
        result = subprocess.run(["nvidia-smi"], capture_output=True, timeout=5)
        return result.returncode == 0
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False


def _find_image_dir(paths: RunPaths) -> Path:
    """Drone images are expected in Raw/.../Images/ or Raw/... directly."""
    for candidate in [paths.raw / "Images", paths.raw]:
        if candidate.exists() and any(candidate.glob("*.jpg")):
            return candidate
    return paths.raw / "Images"  # return expected path even if empty


def run_orthomosaic(
    *,
    session: Session,
    run_id: uuid.UUID,
    stop_event: threading.Event,
    emit: Callable[[dict], None],
    dem_resolution: float = 3.0,
    orthophoto_resolution: float = 3.0,
    pc_quality: str = "medium",
    feature_quality: str = "high",
    custom_odm_options: str = "",
) -> dict[str, Any]:
    """
    Run OpenDroneMap via Docker to produce orthomosaic + DEM.

    Reads:
      - Raw/{pop}/{run_seg}/Images/*.jpg  (drone images)
      - Intermediate/{workspace}/{pop}/{run_seg}/gcp_list.txt
      - Intermediate/{workspace}/{pop}/{run_seg}/geo.txt

    Writes:
      - Intermediate/{workspace}/{pop}/{run_seg}/temp/project/  (ODM working dir)
      - Processed/{workspace}/{pop}/{run_seg}/{date}-RGB.tif
      - Processed/{workspace}/{pop}/{run_seg}/{date}-DEM.tif
    """
    if not _check_docker():
        raise RuntimeError("Docker is not installed or not in PATH. ODM requires Docker.")

    paths = _get_paths(session, run_id)

    if not paths.gcp_list.exists():
        raise FileNotFoundError(
            f"gcp_list.txt not found at {paths.gcp_list}. "
            "Complete the GCP Selection step first."
        )

    image_dir = _find_image_dir(paths)

    # ODM project layout: odm_working_dir/project/code/
    odm_project = paths.odm_working_dir / "project"
    odm_code = odm_project / "code"
    odm_code.mkdir(parents=True, exist_ok=True)
    paths.processed_run.mkdir(parents=True, exist_ok=True)

    # Copy gcp_list.txt and geo.txt into the ODM project
    gcp_dest = odm_code / "gcp_list.txt"
    with open(paths.gcp_list) as f:
        lines = f.readlines()
    if len(lines) >= 2:
        shutil.copy2(paths.gcp_list, gcp_dest)
        logger.info("Copied gcp_list.txt to ODM project")

    geo_dest = odm_code / "geo.txt"
    if paths.geo_txt.exists():
        shutil.copy2(paths.geo_txt, geo_dest)

    # Log file inside project dir (ODM writes its own logs; we create one)
    log_file = odm_code / "logs.txt"
    log_file.write_text("")

    # Host-path translation for Docker-in-Docker (desktop: same path)
    host_data_root = os.environ.get("HOST_DATA_ROOT", str(paths.data_root))
    container_data_root = str(paths.data_root)
    host_project = str(odm_project).replace(container_data_root, host_data_root)
    host_images = str(image_dir).replace(container_data_root, host_data_root)

    # Build ODM options
    odm_options = "--dsm"
    if custom_odm_options:
        odm_options += f" {custom_odm_options}"
    else:
        odm_options += (
            f" --dem-resolution {dem_resolution}"
            f" --orthophoto-resolution {orthophoto_resolution}"
            f" --pc-quality {pc_quality}"
            f" --feature-quality {feature_quality}"
        )

    container_name = f"ODM-gemi-{run_id!s:.8}"

    docker_cmd: list[str] = [
        "docker", "run",
        "--name", container_name,
        "-i", "--rm",
        "--security-opt=no-new-privileges",
        "-v", f"{host_project}:/datasets:rw",
        "-v", f"{host_images}:/datasets/code/images:ro",
        "-v", "/etc/timezone:/etc/timezone:ro",
        "-v", "/etc/localtime:/etc/localtime:ro",
    ]
    if _check_gpu():
        docker_cmd += ["--gpus", "all", "opendronemap/odm:gpu"]
    else:
        docker_cmd.append("opendronemap/odm")

    docker_cmd += ["--project-path", "/datasets", "code"] + odm_options.split()

    logger.info("Starting ODM: %s", " ".join(docker_cmd))
    emit({"event": "progress", "message": "Starting ODM Docker container…", "progress": 0})

    with open(log_file, "w") as lf:
        proc = subprocess.Popen(docker_cmd, stdout=lf, stderr=subprocess.STDOUT)

    # Monitor log file for progress while ODM runs
    stage_count = len(_ODM_PROGRESS_STAGES)
    current_stage = -1

    try:
        while proc.poll() is None:
            if stop_event.is_set():
                proc.terminate()
                try:
                    subprocess.run(["docker", "stop", container_name], timeout=10, capture_output=True)
                except Exception:
                    pass
                return {}

            # Scan log for progress
            try:
                text = log_file.read_text()
                for idx, stage in enumerate(_ODM_PROGRESS_STAGES):
                    if stage in text and idx > current_stage:
                        current_stage = idx
                        pct = round((idx + 1) / stage_count * 80)  # cap at 80% during ODM
                        emit({"event": "progress", "message": stage, "progress": pct})
            except OSError:
                pass

            time.sleep(10)

        if proc.returncode != 0:
            raise RuntimeError(f"ODM exited with code {proc.returncode}. Check {log_file}.")

    except Exception:
        try:
            subprocess.run(["docker", "rm", "-f", container_name], timeout=5, capture_output=True)
        except Exception:
            pass
        raise

    emit({"event": "progress", "message": "Copying ODM outputs…", "progress": 82})

    # Copy outputs to Processed/
    ortho_src = odm_code / "odm_orthophoto" / "odm_orthophoto.tif"
    dem_src = odm_code / "odm_dem" / "dsm.tif"

    if not ortho_src.exists():
        raise FileNotFoundError(f"ODM orthomosaic not found at {ortho_src}")

    shutil.copy2(ortho_src, paths.aerial_rgb)
    logger.info("Copied orthomosaic → %s", paths.aerial_rgb.name)

    emit({"event": "progress", "message": "Generating pyramid (COG)…", "progress": 88})

    # Build pyramid using rasterio (overview levels)
    try:
        import rasterio
        from rasterio.enums import Resampling as _Resampling

        shutil.copy2(ortho_src, paths.aerial_rgb_pyramid)
        with rasterio.open(paths.aerial_rgb_pyramid, "r+") as dst:
            dst.build_overviews([2, 4, 8, 16], _Resampling.average)
            dst.update_tags(ns="rio_overview", resampling="average")
        logger.info("Built pyramid → %s", paths.aerial_rgb_pyramid.name)
    except Exception as exc:
        logger.warning("Pyramid generation failed (non-fatal): %s", exc)

    if dem_src.exists():
        shutil.copy2(dem_src, paths.aerial_dem)
        logger.info("Copied DEM → %s", paths.aerial_dem.name)

    emit({"event": "progress", "message": "Orthomosaic complete.", "progress": 100})

    return {
        "orthomosaic": paths.rel(paths.aerial_rgb),
        "dem": paths.rel(paths.aerial_dem) if paths.aerial_dem.exists() else None,
        "odm_log": paths.rel(log_file),
    }


# ── Step 3: Plot Boundaries (data persistence only) ───────────────────────────

def save_plot_boundaries(
    *,
    session: Session,
    run_id: uuid.UUID,
    geojson: dict[str, Any],
    version: int | None = None,
) -> dict[str, str]:
    """
    Save user-drawn plot boundary polygons (from Leaflet) as GeoJSON.

    If version is None, overwrites the canonical Plot-Boundary-WGS84.geojson.
    If version is given, saves as Plot-Boundary-WGS84_v{N}.geojson.
    """
    paths = _get_paths(session, run_id)
    paths.intermediate_pipeline.mkdir(parents=True, exist_ok=True)

    if version is not None:
        target = paths.plot_boundary_geojson_versioned(version)
    else:
        target = paths.plot_boundary_geojson

    with open(target, "w") as f:
        json.dump(geojson, f, indent=2)

    logger.info("Saved plot boundaries to %s", target)
    return {"plot_boundaries": paths.rel(target)}


# ── Step 4: Trait Extraction ──────────────────────────────────────────────────

def _compute_otsu_criteria(im: np.ndarray, th: int) -> float:
    """Otsu criterion for a given threshold on a uint8 array."""
    thresholded = im >= th
    nb = im.size
    nb1 = int(np.count_nonzero(thresholded))
    w1 = nb1 / nb
    w0 = 1.0 - w1
    if w1 == 0 or w0 == 0:
        return float("inf")
    val1 = im[thresholded]
    val0 = im[~thresholded]
    return w0 * float(np.var(val0)) + w1 * float(np.var(val1))


def _calculate_exg_mask(rgb_arr: np.ndarray) -> np.ndarray:
    """
    Compute Excess Green vegetation mask via Otsu thresholding.

    rgb_arr: (H, W, 3) uint8 RGB array.
    Returns uint8 mask (0 = background, 255 = vegetation).
    """
    import cv2

    arr = rgb_arr.astype(np.float32)
    total = arr[:, :, 0] + arr[:, :, 1] + arr[:, :, 2]
    total = np.where(total == 0, 1.0, total)
    ratio = arr / total[:, :, np.newaxis]
    exg = 2 * ratio[:, :, 1] - ratio[:, :, 0] - ratio[:, :, 2]
    exg_norm = cv2.normalize(exg, None, 0, 255, cv2.NORM_MINMAX, cv2.CV_8U)

    criterias = [_compute_otsu_criteria(exg_norm, th) for th in range(int(exg_norm.max()) + 1)]
    best_th = int(np.argmin(criterias))
    mask = (exg_norm > best_th).astype(np.uint8) * 255

    # Morphological closing to fill gaps
    kernel = np.ones((5, 5), np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)
    return mask


def _prop(row: Any, *keys: str) -> Any:
    """Get the first non-None property value from a GeoDataFrame row by trying multiple keys."""
    for k in keys:
        v = getattr(row, k, None)
        if v is not None and str(v) not in ("nan", "None", ""):
            return v
    return None


def run_trait_extraction(
    *,
    session: Session,
    run_id: uuid.UUID,
    stop_event: threading.Event,
    emit: Callable[[dict], None],
) -> dict[str, Any]:
    """
    Extract vegetation fraction, height, and temperature per plot.

    Uses rasterio (instead of GDAL/osgeo) to crop the orthomosaic and DEM
    by each plot polygon, then computes per-plot metrics.

    Reads:
      - Processed/{workspace}/{pop}/{run_seg}/{date}-RGB.tif
      - Processed/{workspace}/{pop}/{run_seg}/{date}-DEM.tif  (optional)
      - Intermediate/{workspace}/{pop}/Plot-Boundary-WGS84.geojson

    Writes:
      - Processed/{workspace}/{pop}/{run_seg}/Traits-WGS84.geojson
      - Processed/{workspace}/{pop}/{run_seg}/cropped_images/plot_*.png
    """
    import cv2
    import geopandas as gpd
    import pandas as pd
    import rasterio
    from rasterio.windows import from_bounds as _from_bounds

    paths = _get_paths(session, run_id)

    if not paths.aerial_rgb.exists():
        raise FileNotFoundError(
            f"Orthomosaic not found at {paths.aerial_rgb}. "
            "Complete the Orthomosaic step first."
        )
    if not paths.plot_boundary_geojson.exists():
        raise FileNotFoundError(
            f"Plot boundaries not found at {paths.plot_boundary_geojson}. "
            "Complete the Plot Boundaries step first."
        )

    paths.cropped_images_dir.mkdir(parents=True, exist_ok=True)

    # Load boundary GeoJSON
    gdf = gpd.read_file(paths.plot_boundary_geojson)
    n_plots = len(gdf)
    emit({"event": "progress", "message": f"Extracting traits for {n_plots} plots…",
          "total": n_plots})

    has_dem = paths.aerial_dem.exists()
    records: list[dict] = []

    with rasterio.open(paths.aerial_rgb) as rgb_src:
        # Reproject boundaries to raster CRS
        if gdf.crs is None:
            gdf = gdf.set_crs("EPSG:4326")
        if gdf.crs != rgb_src.crs:
            gdf_raster = gdf.to_crs(rgb_src.crs)
        else:
            gdf_raster = gdf

        dem_src = rasterio.open(paths.aerial_dem) if has_dem else None
        if dem_src is not None and dem_src.crs != rgb_src.crs:
            gdf_dem = gdf.to_crs(dem_src.crs)
        elif dem_src is not None:
            gdf_dem = gdf_raster
        else:
            gdf_dem = None

        try:
            for i, (_, row) in enumerate(gdf_raster.iterrows()):
                if stop_event.is_set():
                    break

                orig_row = gdf.iloc[i]
                geom = row.geometry
                if geom is None or geom.is_empty:
                    continue

                bounds = geom.bounds  # (minx, miny, maxx, maxy)
                window = _from_bounds(*bounds, rgb_src.transform)

                # Crop RGB
                rgb_data = rgb_src.read([1, 2, 3], window=window, boundless=True, fill_value=0)
                rgb_arr = np.transpose(rgb_data, (1, 2, 0))  # (H, W, 3) RGB

                if rgb_arr.size == 0 or rgb_arr.shape[0] == 0 or rgb_arr.shape[1] == 0:
                    continue

                # Vegetation fraction
                mask = _calculate_exg_mask(rgb_arr)
                vf = round(float(np.sum(mask > 0)) / mask.size, 4)

                # Canopy height from DEM
                height_m: float | None = None
                if dem_src is not None and gdf_dem is not None:
                    dem_row = gdf_dem.iloc[i]
                    dem_bounds = dem_row.geometry.bounds
                    dem_window = _from_bounds(*dem_bounds, dem_src.transform)
                    dem_data = dem_src.read(1, window=dem_window, boundless=True, fill_value=0)
                    if dem_data.size > 0:
                        # Resize mask to match DEM crop
                        dm = cv2.resize(mask, (dem_data.shape[1], dem_data.shape[0]))
                        dem_vals = dem_data[dm > 0]
                        if len(dem_vals) > 0:
                            height_m = round(
                                float(np.quantile(dem_vals, 0.95)) - float(np.quantile(dem_vals, 0.05)),
                                4,
                            )

                # Derive plot ID and labels from GeoJSON properties
                plot_id = (
                    _prop(orig_row, "Plot", "plot", "plot_id")
                    or _prop(orig_row, "id", "ID")
                    or str(i)
                )
                bed = _prop(orig_row, "Bed", "bed", "column", "col")
                tier = _prop(orig_row, "Tier", "tier", "row")
                label = _prop(orig_row, "Label", "label", "accession", "Accession")

                # Save cropped image
                bgr = cv2.cvtColor(rgb_arr, cv2.COLOR_RGB2BGR)
                crop_path = paths.cropped_images_dir / f"plot_{plot_id}.png"
                cv2.imwrite(str(crop_path), bgr)

                record: dict[str, Any] = {
                    "plot_id": plot_id,
                    "Bed": bed,
                    "Tier": tier,
                    "Label": label,
                    "Vegetation_Fraction": vf,
                }
                if height_m is not None:
                    record["Height_95p_meters"] = height_m

                records.append(record)

                emit({"event": "progress", "index": i, "total": n_plots,
                      "message": f"Plot {plot_id}: VF={vf:.3f}"
                                 + (f", H={height_m:.3f}m" if height_m is not None else "")})

        finally:
            if dem_src is not None:
                dem_src.close()

    if not records:
        raise RuntimeError("No plot traits could be extracted. Check plot boundaries and orthomosaic overlap.")

    # Merge traits back into GeoJSON features
    df_traits = pd.DataFrame(records)
    gdf_out = gdf.copy()

    for col in ["Vegetation_Fraction", "Height_95p_meters"]:
        if col in df_traits.columns:
            gdf_out[col] = df_traits[col].values

    gdf_out.to_file(str(paths.traits_geojson), driver="GeoJSON")
    logger.info("Wrote Traits-WGS84.geojson (%d plots)", len(records))

    return {
        "traits": paths.rel(paths.traits_geojson),
        "cropped_images": paths.rel(paths.cropped_images_dir),
    }


# ── Step 5: Inference (Roboflow) ─────────────────────────────────────────────

def run_inference(
    *,
    session: Session,
    run_id: uuid.UUID,
    stop_event: threading.Event,
    emit: Callable[[dict], None],
    models: list[dict],
) -> dict[str, Any]:
    """
    Run Roboflow inference on split plot images using one or more model configs.

    models: [
        {"label": "Wheat", "roboflow_api_key": "...", "roboflow_model_id": "...", "task_type": "detection"},
        ...
    ]

    Reads:
      - Processed/{workspace}/{pop}/{run_seg}/cropped_images/*.png

    Writes one CSV per model:
      - roboflow_predictions_{label}.csv
    """
    import csv as _csv
    from app.processing.inference_utils import run_inference_on_image

    if not models:
        raise ValueError("No inference models provided.")

    paths = _get_paths(session, run_id)

    plot_images = sorted(paths.cropped_images_dir.glob("*.png"))
    if not plot_images:
        raise FileNotFoundError(
            f"No cropped plot images found in {paths.cropped_images_dir}. "
            "Complete the Trait Extraction step first."
        )

    fieldnames = ["image", "class", "confidence", "x", "y", "width", "height"]
    inference_paths: dict[str, str] = {}

    for model in models:
        if stop_event.is_set():
            return {}
        label = model.get("label", "model")
        api_key = model.get("roboflow_api_key", "")
        model_id = model.get("roboflow_model_id", "")
        task_type = model.get("task_type", "detection")

        emit({"event": "progress", "message": f"[{label}] Running on {len(plot_images)} plots…",
              "total": len(plot_images)})

        safe_label = "".join(c if c.isalnum() or c in "-_" else "_" for c in label)
        predictions_path = paths.processed_run / f"roboflow_predictions_{safe_label}.csv"
        all_rows: list[dict] = []

        for i, img in enumerate(plot_images):
            if stop_event.is_set():
                return {}
            emit({"event": "progress", "index": i, "message": f"[{label}] {img.name}"})
            preds = run_inference_on_image(img, api_key=api_key, model_id=model_id, task_type=task_type)
            for p in preds:
                p["image"] = img.name
            all_rows.extend(preds)

        with open(predictions_path, "w", newline="") as f:
            writer = _csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
            writer.writeheader()
            writer.writerows(all_rows)

        inference_paths[label] = paths.rel(predictions_path)
        logger.info("[%s] Wrote %d predictions → %s", label, len(all_rows), predictions_path.name)

    return {
        "inference": inference_paths,
        "traits": paths.rel(paths.traits_geojson) if paths.traits_geojson.exists() else None,
    }
