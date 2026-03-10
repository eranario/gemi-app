"""
Roboflow inference utilities for plot images.

Handles overlapping crop-and-infer for large images, coordinate transformation
back to image level, and Non-Maximum Suppression (NMS) deduplication.

Public API
----------
run_inference_on_image(image_path, api_key, model_id, ...) -> list[dict]
apply_nms(predictions, iou_threshold) -> list[dict]
"""

from __future__ import annotations

import logging
import shutil
import tempfile
from pathlib import Path
from typing import Any

from PIL import Image

logger = logging.getLogger(__name__)


# ── Image cropping ─────────────────────────────────────────────────────────────

def crop_image_with_overlap(
    image_path: Path | str,
    crop_size: int = 640,
    overlap: int = 32,
) -> list[dict[str, Any]]:
    """
    Tile a large image into overlapping crop_size x crop_size patches.

    Returns a list of dicts:
        { crop_id, x_offset, y_offset, width, height, crop_path, temp_dir }

    The caller is responsible for deleting temp_dir after use.
    """
    image = Image.open(str(image_path))
    img_w, img_h = image.size

    stride = crop_size - overlap

    def _positions(length: int) -> list[int]:
        pos = list(range(0, length - crop_size + 1, stride))
        if pos and pos[-1] + crop_size < length:
            pos.append(length - crop_size)
        return pos or [0]

    x_positions = _positions(img_w)
    y_positions = _positions(img_h)

    temp_dir = tempfile.mkdtemp()
    crops: list[dict[str, Any]] = []
    crop_id = 0

    for y in y_positions:
        for x in x_positions:
            actual_x = min(x, img_w - crop_size) if img_w >= crop_size else 0
            actual_y = min(y, img_h - crop_size) if img_h >= crop_size else 0
            actual_w = min(crop_size, img_w - actual_x)
            actual_h = min(crop_size, img_h - actual_y)

            crop = image.crop((actual_x, actual_y, actual_x + actual_w, actual_y + actual_h))

            if actual_w < crop_size or actual_h < crop_size:
                padded = Image.new("RGB", (crop_size, crop_size), (255, 255, 255))
                padded.paste(crop, (0, 0))
                crop = padded

            crop_path = str(Path(temp_dir) / f"crop_{crop_id}.jpg")
            crop.save(crop_path, format="JPEG", quality=85)

            crops.append(
                {
                    "crop_id": crop_id,
                    "x_offset": actual_x,
                    "y_offset": actual_y,
                    "width": actual_w,
                    "height": actual_h,
                    "crop_path": crop_path,
                    "temp_dir": temp_dir,
                }
            )
            crop_id += 1

    return crops


def _transform_to_image_coords(predictions: list[dict], crop_info: dict) -> list[dict]:
    """Shift crop-level box centres to image-level coordinates."""
    return [
        {
            "class": p.get("class", ""),
            "confidence": p.get("confidence", 0.0),
            "x": p.get("x", 0) + crop_info["x_offset"],
            "y": p.get("y", 0) + crop_info["y_offset"],
            "width": p.get("width", 0),
            "height": p.get("height", 0),
            "crop_id": crop_info["crop_id"],
        }
        for p in predictions
    ]


# ── NMS ───────────────────────────────────────────────────────────────────────

def _iou(a: dict, b: dict) -> float:
    """IoU between two centre-format boxes (x, y, width, height)."""
    ax0, ay0 = a["x"] - a["width"] / 2, a["y"] - a["height"] / 2
    ax1, ay1 = a["x"] + a["width"] / 2, a["y"] + a["height"] / 2
    bx0, by0 = b["x"] - b["width"] / 2, b["y"] - b["height"] / 2
    bx1, by1 = b["x"] + b["width"] / 2, b["y"] + b["height"] / 2

    ix0, iy0 = max(ax0, bx0), max(ay0, by0)
    ix1, iy1 = min(ax1, bx1), min(ay1, by1)

    if ix1 <= ix0 or iy1 <= iy0:
        return 0.0

    inter = (ix1 - ix0) * (iy1 - iy0)
    union = a["width"] * a["height"] + b["width"] * b["height"] - inter
    return inter / union if union > 0 else 0.0


def apply_nms(predictions: list[dict], iou_threshold: float = 0.5) -> list[dict]:
    """Per-class greedy NMS."""
    if not predictions:
        return []

    by_class: dict[str, list[dict]] = {}
    for p in predictions:
        by_class.setdefault(p["class"], []).append(p)

    kept: list[dict] = []
    for preds in by_class.values():
        preds.sort(key=lambda x: x["confidence"], reverse=True)
        while preds:
            best = preds.pop(0)
            kept.append(best)
            preds = [p for p in preds if _iou(best, p) < iou_threshold]

    return kept


# ── Main inference entry point ─────────────────────────────────────────────────

def run_inference_on_image(
    image_path: Path | str,
    api_key: str,
    model_id: str,
    task_type: str = "detection",
    confidence_threshold: float = 0.5,
    iou_threshold: float = 0.5,
    crop_size: int = 640,
    overlap: int = 32,
) -> list[dict[str, Any]]:
    """
    Run Roboflow inference on one (potentially large) image.

    Crops the image into overlapping patches, runs inference on each,
    transforms coordinates back to image level, applies NMS.

    Returns a list of prediction dicts with image-level (x, y, width, height).
    """
    from inference_sdk import InferenceHTTPClient, InferenceConfiguration

    client = InferenceHTTPClient(
        api_url="https://detect.roboflow.com",
        api_key=api_key,
    )
    client.configure(InferenceConfiguration(confidence_threshold=confidence_threshold))

    crops = crop_image_with_overlap(image_path, crop_size=crop_size, overlap=overlap)
    if not crops:
        return []

    all_predictions: list[dict] = []
    temp_dir = crops[0]["temp_dir"]

    try:
        for crop_info in crops:
            try:
                result = client.infer(crop_info["crop_path"], model_id=model_id)
                raw = result.get("predictions", []) if isinstance(result, dict) else []
                all_predictions.extend(_transform_to_image_coords(raw, crop_info))
            except Exception as exc:
                logger.warning("Inference failed on crop %d of %s: %s", crop_info["crop_id"], image_path, exc)
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)

    return apply_nms(all_predictions, iou_threshold=iou_threshold)
