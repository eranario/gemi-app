"""
Ground-based (Amiga) pipeline step implementations.

Each function follows the runner contract:
    fn(session, run_id, stop_event, emit, **kwargs) -> dict[str, Any]

The returned dict is merged into PipelineRun.outputs using relative paths
(relative to data_root) via RunPaths.rel().

Steps
-----
1. plot_marking   — save user's start/end image selections → plot_borders.csv
2. stitching      — run AgRowStitch on marked images
3. georeferencing — GPS-based georeferencing of stitched plots
4. inference      — Roboflow detection/segmentation (optional)

Binary extraction (step 0) is triggered at upload time, not here.
"""

from __future__ import annotations

import csv
import logging
import os
import shutil
import sys
import tempfile
import threading
import uuid
from pathlib import Path
from typing import TYPE_CHECKING, Any, Callable

from sqlmodel import Session

from app.core.paths import RunPaths
from app.crud.pipeline import get_pipeline_run
from app.models.workspace import Workspace

if TYPE_CHECKING:
    pass

logger = logging.getLogger(__name__)


def _get_paths(session: Session, run_id: uuid.UUID) -> RunPaths:
    """Resolve RunPaths from DB for a given run."""
    from app.models.pipeline import Pipeline

    run = session.get(__import__("app.models.pipeline", fromlist=["PipelineRun"]).PipelineRun, run_id)
    if not run:
        raise ValueError(f"Run {run_id} not found")
    pipeline = session.get(Pipeline, run.pipeline_id)
    if not pipeline:
        raise ValueError(f"Pipeline {run.pipeline_id} not found")
    workspace = session.get(Workspace, pipeline.workspace_id)
    if not workspace:
        raise ValueError(f"Workspace {pipeline.workspace_id} not found")
    return RunPaths.from_db(session=session, run=run, workspace=workspace)


def _find_msgs_synced(paths: RunPaths) -> Path | None:
    """
    Find msgs_synced.csv — bin extraction writes it into the Raw tree;
    the intermediate copy (if made) lives in intermediate_run.
    """
    candidates = [
        paths.msgs_synced,
        paths.raw / "Metadata" / "msgs_synced.csv",
        paths.raw / "RGB" / "Metadata" / "msgs_synced.csv",
        paths.raw / "msgs_synced.csv",
    ]
    return next((p for p in candidates if p.exists()), None)


def _find_images_dir(paths: RunPaths) -> Path:
    """
    Return the directory that holds extracted frame images.
    bin_to_images writes to Raw/RGB/Images/{camera}/; fall back to Raw/.
    """
    for candidate in [
        paths.raw / "RGB" / "Images",
        paths.raw / "Images",
        paths.raw,
    ]:
        if candidate.exists():
            return candidate
    return paths.raw


def _import_agrowstitch():
    """
    Try to import the run() function from AgRowStitch.py.

    AgRowStitch is a single-file module (AgRowStitch.py) with no package structure.
    We add its directory to sys.path then import directly.

    Looks in (priority order):
      1. vendor/AgRowStitch relative to the backend root (git submodule)
      2. AGROWSTITCH_PATH environment variable (dev override)
      3. Sibling AgRowStitch directory next to the repo root
    """
    fallback_paths = [
        str(Path(__file__).parent.parent.parent / "vendor" / "AgRowStitch"),
        os.environ.get("AGROWSTITCH_PATH"),
        str(Path(__file__).parent.parent.parent.parent / "AgRowStitch"),
    ]
    for p in fallback_paths:
        if not p:
            continue
        p_path = Path(p)
        if (p_path / "AgRowStitch.py").exists():
            if str(p_path) not in sys.path:
                sys.path.insert(0, str(p_path))
            try:
                from AgRowStitch import run as run_agrowstitch  # type: ignore
                return run_agrowstitch
            except ImportError:
                continue

    return None


# ── Step 1: Plot Marking (data persistence only) ──────────────────────────────
# The interactive part (image viewer) lives in the frontend.
# This function is called by the POST /plot-marking endpoint to save the
# selections as plot_borders.csv in Intermediate/.

def save_plot_marking(
    *,
    session: Session,
    run_id: uuid.UUID,
    selections: list[dict[str, Any]],
) -> dict[str, str]:
    """
    Persist plot boundary selections to plot_borders.csv.

    selections: [
        {"plot_id": 1, "start_image": "frame_0010.jpg", "end_image": "frame_0045.jpg",
         "start_lat": 33.1, "start_lon": -111.9, "end_lat": 33.2, "end_lon": -111.8,
         "direction": "north_to_south"},
        ...
    ]

    Returns relative paths for storage in run.outputs.
    """
    paths = _get_paths(session, run_id)
    paths.intermediate_pipeline.mkdir(parents=True, exist_ok=True)

    fieldnames = ["plot_id", "start_image", "end_image",
                  "start_lat", "start_lon", "end_lat", "end_lon", "direction"]
    with open(paths.plot_borders, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(selections)

    logger.info("Saved plot_borders.csv with %d plots to %s", len(selections), paths.plot_borders)
    return {"plot_marking": paths.rel(paths.plot_borders)}


# ── Step 2: Stitching (AgRowStitch) ──────────────────────────────────────────

def run_stitching(
    *,
    session: Session,
    run_id: uuid.UUID,
    stop_event: threading.Event,
    emit: Callable[[dict], None],
    agrowstitch_version: int = 1,
) -> dict[str, Any]:
    """
    Run AgRowStitch on each plot defined in plot_borders.csv.

    Reads:
      - Intermediate/{workspace}/{pop}/plot_borders.csv
      - Raw/…/RGB/Images/{camera}/*.jpg  (extracted images)
      - Intermediate/{workspace}/{pop}/agrowstitch_config.yaml  (optional base config)

    Writes:
      - Processed/{workspace}/{pop}/{run_seg}/AgRowStitch_v{N}/
          full_res_mosaic_temp_plot_{id}.png
    """
    import pandas as pd
    try:
        import torch
        _has_cuda = torch.cuda.is_available()
    except ImportError:
        _has_cuda = False

    try:
        import yaml
    except ImportError:
        raise RuntimeError("PyYAML is required for stitching. Install it with: uv add pyyaml")

    run_agrowstitch = _import_agrowstitch()
    if run_agrowstitch is None:
        raise RuntimeError(
            "AgRowStitch is not available. Clone the AgRowStitch git submodule and set "
            "AGROWSTITCH_PATH to its root directory."
        )

    paths = _get_paths(session, run_id)

    if not paths.plot_borders.exists():
        raise FileNotFoundError(
            f"plot_borders.csv not found at {paths.plot_borders}. "
            "Complete the Plot Marking step first."
        )

    out_dir = paths.agrowstitch_dir(agrowstitch_version)
    out_dir.mkdir(parents=True, exist_ok=True)

    images_dir = _find_images_dir(paths)
    msgs_path = _find_msgs_synced(paths)

    with open(paths.plot_borders) as f:
        plots = list(csv.DictReader(f))

    emit({"event": "progress", "message": f"Stitching {len(plots)} plots…", "total": len(plots)})

    # Load base AgRowStitch config (optional)
    base_config_path = paths.intermediate_pipeline / "agrowstitch_config.yaml"
    base_config: dict = {}
    if base_config_path.exists():
        with open(base_config_path) as f:
            base_config = yaml.safe_load(f) or {}

    # Load msgs_synced for image filtering
    msgs_df = None
    if msgs_path and msgs_path.exists():
        msgs_df = pd.read_csv(msgs_path)

    DIRECTION_MAP = {
        "north_to_south": "DOWN",
        "south_to_north": "UP",
        "east_to_west": "LEFT",
        "west_to_east": "RIGHT",
    }

    for i, plot in enumerate(plots):
        if stop_event.is_set():
            return {}

        plot_id = plot.get("plot_id", i + 1)
        start_img = plot.get("start_image", "")
        end_img = plot.get("end_image", "")
        ui_direction = plot.get("direction", "north_to_south")
        stitch_dir = DIRECTION_MAP.get(ui_direction, "DOWN")

        emit({"event": "progress", "index": i, "plot_id": plot_id,
              "message": f"Stitching plot {plot_id} ({stitch_dir})"})

        # Gather images for this plot
        plot_temp_dir = tempfile.mkdtemp(prefix=f"agrows_plot{plot_id}_")
        try:
            copied = 0
            if msgs_df is not None:
                rgb_col = "/top/rgb_file" if "/top/rgb_file" in msgs_df.columns else None
                if rgb_col:
                    plot_rows = msgs_df[
                        (msgs_df[rgb_col] >= start_img) & (msgs_df[rgb_col] <= end_img)
                    ]
                    for _, row in plot_rows.iterrows():
                        rel = str(row[rgb_col]).lstrip("/")
                        src = images_dir / rel
                        if src.exists():
                            shutil.copy2(src, Path(plot_temp_dir) / src.name)
                            copied += 1
            logger.info("[Plot %s] Copied %d images for stitching", plot_id, copied)

            # Build config
            config = dict(base_config)
            config["image_directory"] = plot_temp_dir
            config["device"] = "cuda" if _has_cuda else "cpu"
            config["stitching_direction"] = stitch_dir

            with tempfile.NamedTemporaryFile(
                delete=False, mode="w", suffix=f"_plot_{plot_id}.yaml"
            ) as tmpf:
                yaml.safe_dump(config, tmpf)
                tmp_config = tmpf.name

            cpu_count = os.cpu_count() or 1

            try:
                result = run_agrowstitch(tmp_config, cpu_count)
                # AgRowStitch may return a generator; exhaust it
                if result is not None and hasattr(result, "__iter__") and not isinstance(result, (str, bytes)):
                    for step in result:
                        if stop_event.is_set():
                            return {}
                        logger.debug("[Plot %s] step: %s", plot_id, step)
            finally:
                try:
                    os.unlink(tmp_config)
                except OSError:
                    pass

            # Find output file — AgRowStitch writes to plot_temp_dir or a subdirectory
            output_png = None
            for search_dir in [Path(plot_temp_dir), Path(plot_temp_dir).parent / "final_mosaics"]:
                if not search_dir.exists():
                    continue
                patterns = [
                    f"full_res_mosaic_temp_plot_{plot_id}",
                    f"plot_{plot_id}",
                    "full_res_mosaic",
                ]
                for pat in patterns:
                    matches = list(search_dir.glob(f"{pat}*.png")) + list(search_dir.glob(f"{pat}*.tif"))
                    if matches:
                        output_png = matches[0]
                        break
                if output_png:
                    break

            if output_png and output_png.exists():
                dest = out_dir / f"full_res_mosaic_temp_plot_{plot_id}{output_png.suffix}"
                shutil.copy2(output_png, dest)
                logger.info("[Plot %s] Stitched → %s", plot_id, dest.name)
            else:
                logger.warning("[Plot %s] No stitched output found in %s", plot_id, plot_temp_dir)

        finally:
            shutil.rmtree(plot_temp_dir, ignore_errors=True)

    return {
        "stitching": paths.rel(out_dir),
        "stitching_version": agrowstitch_version,
    }


# ── Step 3: Georeferencing ────────────────────────────────────────────────────

def run_georeferencing(
    *,
    session: Session,
    run_id: uuid.UUID,
    stop_event: threading.Event,
    emit: Callable[[dict], None],
    agrowstitch_version: int = 1,
) -> dict[str, Any]:
    """
    Georeference stitched plot PNGs using GPS data from msgs_synced.csv.

    Reads:
      - Processed/{workspace}/{pop}/{run_seg}/AgRowStitch_v{N}/*.png
      - msgs_synced.csv (searched in Raw/ and Intermediate/)
      - Intermediate/{workspace}/{pop}/plot_borders.csv

    Writes:
      - Processed/{workspace}/{pop}/{run_seg}/AgRowStitch_v{N}/
          georeferenced_plot_{id}_utm.tif
          combined_mosaic_utm.tif
          combined_mosaic.tif
    """
    import pandas as pd
    from app.processing.geo_utils import georeference_plot, combine_utm_tiffs_to_mosaic

    paths = _get_paths(session, run_id)
    out_dir = paths.agrowstitch_dir(agrowstitch_version)

    if not out_dir.exists():
        raise FileNotFoundError(
            f"Stitching output not found at {out_dir}. "
            "Complete the Stitching step first."
        )

    # Load msgs_synced.csv
    msgs_path = _find_msgs_synced(paths)
    if msgs_path is None:
        raise FileNotFoundError(
            "msgs_synced.csv not found. Ensure binary extraction completed "
            "or place the file in the run's Intermediate directory."
        )
    msgs_df = pd.read_csv(msgs_path)
    logger.info("Loaded msgs_synced.csv: %d rows from %s", len(msgs_df), msgs_path)

    # Determine the image filename column
    rgb_col = "/top/rgb_file" if "/top/rgb_file" in msgs_df.columns else None
    if rgb_col is None and "rgb_file" in msgs_df.columns:
        rgb_col = "rgb_file"

    # Load plot borders for direction info
    plot_directions: dict[str, str] = {}
    if paths.plot_borders.exists():
        with open(paths.plot_borders) as f:
            for row in csv.DictReader(f):
                plot_directions[str(row["plot_id"])] = row.get("direction", "north_to_south")

    # Find stitched plot images
    plot_pngs = sorted(out_dir.glob("full_res_mosaic_temp_plot_*.png"))
    if not plot_pngs:
        plot_pngs = sorted(out_dir.glob("AgRowStitch_plot-id-*.png"))
    if not plot_pngs:
        raise FileNotFoundError(f"No stitched plot images found in {out_dir}")

    emit({"event": "progress", "message": f"Georeferencing {len(plot_pngs)} plots…",
          "total": len(plot_pngs)})

    plot_ids = []
    for i, png in enumerate(plot_pngs):
        if stop_event.is_set():
            return {}

        # Extract plot_id from filename
        stem = png.stem  # e.g. full_res_mosaic_temp_plot_3
        plot_id_str = stem.split("_")[-1]
        emit({"event": "progress", "index": i, "message": f"Georeferencing plot {plot_id_str}"})

        # Filter msgs_df to the rows for this plot
        if rgb_col and paths.plot_borders.exists():
            with open(paths.plot_borders) as f:
                borders = {str(r["plot_id"]): r for r in csv.DictReader(f)}
            border = borders.get(plot_id_str, {})
            start_img = border.get("start_image", "")
            end_img = border.get("end_image", "")
            if start_img and end_img and rgb_col:
                plot_df = msgs_df[
                    (msgs_df[rgb_col] >= start_img) & (msgs_df[rgb_col] <= end_img)
                ].copy()
            else:
                plot_df = msgs_df.copy()
        else:
            plot_df = msgs_df.copy()

        if len(plot_df) < 2:
            logger.warning("[Plot %s] Only %d GPS rows — skipping georeferencing", plot_id_str, len(plot_df))
            continue

        ui_direction = plot_directions.get(plot_id_str, "north_to_south")
        success = georeference_plot(plot_id_str, plot_df, out_dir, ui_direction=ui_direction)
        if success:
            plot_ids.append(plot_id_str)
        else:
            logger.warning("[Plot %s] Georeferencing failed", plot_id_str)

    if not plot_ids:
        raise RuntimeError("No plots were successfully georeferenced.")

    emit({"event": "progress", "message": "Combining plot mosaics…"})
    combine_utm_tiffs_to_mosaic(out_dir, plot_ids)

    return {"georeferencing": paths.rel(out_dir)}


# ── Step 4: Inference (Roboflow) ─────────────────────────────────────────────

def run_inference(
    *,
    session: Session,
    run_id: uuid.UUID,
    stop_event: threading.Event,
    emit: Callable[[dict], None],
    models: list[dict],
    agrowstitch_version: int = 1,
) -> dict[str, Any]:
    """
    Run Roboflow inference on stitched plot images using one or more model configs.

    models: [
        {"label": "Wheat", "roboflow_api_key": "...", "roboflow_model_id": "...", "task_type": "detection"},
        ...
    ]

    Reads:
      - Processed/{workspace}/{pop}/{run_seg}/AgRowStitch_v{N}/*.png

    Writes one CSV per model:
      - roboflow_predictions_{label}.csv
    """
    from app.processing.inference_utils import run_inference_on_image

    if not models:
        raise ValueError("No inference models provided.")

    paths = _get_paths(session, run_id)
    out_dir = paths.agrowstitch_dir(agrowstitch_version)

    if not out_dir.exists():
        raise FileNotFoundError(
            f"Stitching output not found at {out_dir}. Complete Stitching first."
        )

    plot_images = sorted(out_dir.glob("full_res_mosaic_temp_plot_*.png"))
    if not plot_images:
        plot_images = sorted(out_dir.glob("AgRowStitch_plot-id-*.png"))
    if not plot_images:
        raise FileNotFoundError(f"No plot images found in {out_dir}.")

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
        predictions_path = out_dir / f"roboflow_predictions_{safe_label}.csv"
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
            writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
            writer.writeheader()
            writer.writerows(all_rows)

        inference_paths[label] = paths.rel(predictions_path)
        logger.info("[%s] Wrote %d predictions → %s", label, len(all_rows), predictions_path.name)

    return {"inference": inference_paths}


# ── Binary extraction (.bin → images) ────────────────────────────────────────
# Called from the upload endpoint when .bin files are detected.
# Runs as a background task; progress tracked via the same SSE mechanism.

def _import_extract_binary():
    """
    Try to import extract_binary from the bin_to_images package (farm-ng-amiga SDK).

    Looks in (priority order):
      1. Installed package (pip install -e vendor/bin_to_images in build.sh)
      2. BIN_TO_IMAGES_PATH environment variable (dev override)
      3. vendor/bin_to_images relative to the backend root
    """
    try:
        from bin_to_images.bin_to_images import extract_binary  # type: ignore
        return extract_binary
    except ImportError:
        pass
    try:
        from bin_to_images import extract_binary  # type: ignore
        return extract_binary
    except ImportError:
        pass

    # Fallback: path-based lookup for development environments
    fallback_paths = [
        os.environ.get("BIN_TO_IMAGES_PATH"),
        str(Path(__file__).parent.parent.parent / "vendor" / "bin_to_images"),
        str(Path(__file__).parent.parent.parent.parent / "bin_to_images"),
    ]
    for p in fallback_paths:
        if p and Path(p).exists() and p not in sys.path:
            sys.path.insert(0, p)
            try:
                from bin_to_images.bin_to_images import extract_binary  # type: ignore
                return extract_binary
            except ImportError:
                continue

    return None


def extract_bin_file(
    *,
    bin_path: Path,
    output_dir: Path,
    stop_event: threading.Event,
    emit: Callable[[dict], None],
) -> dict[str, Any]:
    """
    Extract images, msgs_synced.csv, and calibration JSON from an Amiga .bin file.

    Output lives in Raw/ (not Intermediate/Processed) — extraction is not a
    processing step, it's making the raw data available.

    Requires the farm_ng SDK (bin_to_images package).
    Set BIN_TO_IMAGES_PATH to the path containing bin_to_images/bin_to_images.py.
    """
    output_dir.mkdir(parents=True, exist_ok=True)

    emit({"event": "start", "message": f"Extracting {bin_path.name}…"})

    extract_binary = _import_extract_binary()
    if extract_binary is None:
        msg = (
            "farm_ng SDK / bin_to_images not available. "
            "Clone the bin_to_images module and set BIN_TO_IMAGES_PATH."
        )
        logger.error(msg)
        emit({"event": "error", "message": msg})
        raise RuntimeError(msg)

    try:
        extract_binary([bin_path], output_dir, granular_progress=True)
    except Exception as exc:
        logger.error("Binary extraction failed for %s: %s", bin_path, exc)
        emit({"event": "error", "message": str(exc)})
        raise

    # msgs_synced.csv lands at output_dir/RGB/Metadata/msgs_synced.csv
    msgs_synced = output_dir / "RGB" / "Metadata" / "msgs_synced.csv"
    calibration = output_dir / "RGB" / "Metadata" / "top_calibration.json"

    logger.info("Extraction complete: %s → %s", bin_path.name, output_dir)
    emit({"event": "complete", "message": f"Extraction complete: {bin_path.name}"})

    return {
        "msgs_synced": str(msgs_synced) if msgs_synced.exists() else None,
        "calibration": str(calibration) if calibration.exists() else None,
    }
