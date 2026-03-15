# Processing Pipeline Implementation Plan

## Recent Changes (2026-03-10)

- **Field Design data type** — added to Files tab upload; directory `Raw/{Experiment}/{Location}/{Population}/FieldDesign/` (no date/platform/sensor). Editable in Manage Data.
- **Shared Plot Boundary Prep** — replaces separate `plot_marking` (ground) and `plot_boundaries` (aerial) steps. Both pipelines now: draw outer pop boundary → configure grid dimensions from field design → auto-generate `Plot-Boundary-WGS84.geojson`. Ground additionally runs `associate_boundaries` compute step (GPS containment matching of stitched plots → boundary polygons).
- **Data Sync auto-trigger** — aerial `data_sync` step runs automatically when RunDetail opens; shows "Preparing data…" inline banner with progress.
- **Full-page interactive tools** — clicking "Open Tool" navigates to `/run/$runId/tool?step=X` full-page view instead of inline expansion.
- **Manage Data field editing** — three-dot menu on each upload now has "Edit fields" option.
- **New Run dialog** — only shows processable data types: aerial → Image Data + Orthomosaic; ground → Farm-ng Binary File + Image Data.

---

## Overview

Implement Ground-based (Amiga) and Aerial (Drone) processing pipelines in the new app, reusing the existing workspace/pipeline layout. The goal is to keep things simple, avoid repetition, and enable workflow reuse across dates.

---

## Current State

**Frontend has:**

- Workspace dashboard → workspace detail → pipeline wizard (3-step)
- Pipeline types: `aerial` | `ground` (already distinguished via search param)
- ProcessPanel for background task tracking
- All hardcoded sample data, no backend integration

**Old Flask app has:**

- Ground pipeline: bin extraction → plot marking → AgRowStitch → georeferencing
- Drone pipeline: EXIF/GCP → ODM orthomosaic → plot boundary drawing → trait extraction
- Shared: Roboflow inference (works on both), crop download, traits GeoJSON output
- Plot boundaries reusable across dates via GPS matching

---

## Architecture Decisions

### 1. Pipeline = a saved configuration that can be re-run on different dates

A **Pipeline** belongs to a workspace and stores:

- Pipeline type (`ground` | `aerial`)
- Plot boundary definition (the reusable part)
  - Ground and aerial create plot boundaries differently and cannot share them
  - Ground: start/end image pairs in GPS sequence → `plot_borders.csv`
  - Aerial: drawn polygons on orthomosaic → `Plot-Boundary-WGS84.geojson`
- Roboflow config (API key, model ID, inference mode) — passed per-request for now, not stored
- Processing settings (stitch direction for ground, ODM options for aerial — each type uses its own tool exclusively)

A **PipelineRun** is a single execution of a pipeline against a specific date's data. This is what enables reuse — same plot boundaries, different dates.

### 2. Processing steps are sequential but resumable

Each run tracks which steps are complete, so users can:

- Stop after stitching and come back for inference later
- Re-run inference with a different model without re-stitching
- Fix plot boundaries and re-run from that step forward
- Create multiple versions of plot boundaries per pipeline (versioned boundary sets)

### 3. Single "Processed Data" table instead of repeated tables

One unified table component shows all pipeline run outputs (stitched plots, orthomosaics, crops, inference results) with filtering by run/date/step. This replaces the old app's separate tables for each processing stage.

### 4. File storage organized by workspace

All generated files live under the workspace directory:

```
{data_root}/
  Raw/                                                      # NEVER written to by processing
    {experiment}/{location}/{population}/{date}/{platform}/{sensor}/
      (images, .bin files, msgs_synced.csv, calibration, etc.)

  Intermediate/
    {workspace_name}/
      {experiment}/{location}/{population}/
        plot_borders.csv                                    # ground: PIPELINE-LEVEL, reused across runs
        plot_borders_v{N}.csv                               # ground: versioned refinements
        Plot-Boundary-WGS84.geojson                         # aerial: PIPELINE-LEVEL, reused across runs
        Plot-Boundary-WGS84_v{N}.geojson                    # aerial: versioned refinements
        stitch_mask.json                                    # ground: PIPELINE-LEVEL
        {date}/{platform}/{sensor}/                         # RUN-LEVEL below here
          msgs_synced.csv                                   # ground: updated with plot indices
          gcp_list.txt                                      # aerial: GCP pixel selections
          geo.txt                                           # aerial: image GPS for ODM
          temp/                                             # aerial: ODM working dir
          plot_images/                                      # aerial: split plot PNGs

  Processed/
    {workspace_name}/
      {experiment}/{location}/{population}/{date}/{platform}/{sensor}/
        AgRowStitch_v{N}/                                   # ground outputs
          full_res_mosaic_temp_plot_{id}.png
          georeferenced_plot_{id}_utm.tif
          combined_mosaic_utm.tif
          combined_mosaic.tif
          roboflow_predictions_{task}.csv
          Traits-WGS84.geojson
        {date}-RGB.tif                                      # aerial outputs
        {date}-DEM.tif
        {date}-RGB-Pyramid.tif
        cropped_images/
          plot_{id}_accession_{acc}.png
        Traits-WGS84.geojson
        roboflow_predictions_{task}.csv
```

**Key principles:**

- **Raw/** is read-only — processing never writes here
- **Intermediate/** stores artifacts needed to produce final outputs (GCPs, plot boundaries, working dirs)
- **Processed/** stores final outputs (orthomosaics, stitched mosaics, crops, traits, inference results)
- **Plot boundaries live at the pipeline level**, not per-run — this is what makes reuse across dates possible:
  - Ground: `plot_borders.csv` stores GPS start/end per plot, applied to new dates via nearest-neighbor GPS matching
  - Aerial: `Plot-Boundary-WGS84.geojson` polygon file reused directly for all runs
  - Versioned copies (`_v2`, `_v3`) are saved when the user refines boundaries; each run records which version it used

---

## Data Model (Backend)

### New Models

```
Pipeline
  id: UUID
  workspace_id: UUID (FK → workspace)
  name: str
  type: "ground" | "aerial"
  config: JSON           # processing settings (stitch direction, ODM options, etc.)
  created_at: str
  updated_at: str

PipelineRun
  id: UUID
  pipeline_id: UUID (FK → pipeline)
  date: str              # the data date being processed
  status: "pending" | "running" | "completed" | "failed"
  current_step: str      # which step is active
  steps_completed: JSON  # { "plot_marking": true, "stitching": true, ... }
  outputs: JSON          # paths to generated files per step
  error: str | None
  created_at: str
  completed_at: str | None
```

### Updated Workspace Model

Add a relationship to pipelines (no schema change needed beyond the FK in Pipeline).

---

## Processing Steps by Pipeline Type

### Ground-based Pipeline Steps

| Step | Name                       | Description                                                  | Inputs                                     | Outputs (Intermediate)                             | Outputs (Processed)                             |
| ---- | -------------------------- | ------------------------------------------------------------ | ------------------------------------------ | -------------------------------------------------- | ----------------------------------------------- |
| 0    | **Binary Extraction**      | Extract images + GPS from Amiga .bin files (during upload)   | .bin files                                 | Extracted JPEGs, msgs_synced.csv, calibration JSON | —                                               |
| 1    | **Plot Marking**           | User selects start/end images for each plot                  | msgs_synced.csv, raw images                | plot_borders.csv, updated msgs_synced.csv          | —                                               |
| 2    | **Stitching**              | AgRowStitch stitches images per plot into panoramic mosaics  | Marked images, calibration, config         | —                                                  | Stitched plot PNGs                              |
| 3    | **Georeferencing**         | GPS-based georeferencing of stitched plots + combined mosaic | Stitched PNGs, GPS data                    | —                                                  | GeoTIFFs (UTM + WGS84), plot_boundaries.geojson |
| 4    | **Plot Boundaries** _(interactive)_ | User views georeferenced plot footprints overlaid on combined_mosaic.tif via BoundaryDrawer (reused from aerial pipeline). User can adjust polygon positions and save. Replaces the old BoundaryMap + AgRowStitchPlotLabeler flow. Future: spatial join assigns Plot+Accession labels from drawn field layout polygons to plot_borders.csv. | combined_mosaic.tif, existing plot_boundaries.geojson | — | plot_boundaries.geojson (updated) |
| 5    | **Inference** _(optional)_ | Roboflow detection/segmentation on plot images               | Plot images, Roboflow config (per-request) | —                                                  | Predictions CSV, Traits GeoJSON                 |

### Aerial Pipeline Steps

| Step | Name                       | Description                                               | Inputs                                         | Outputs (Intermediate)      | Outputs (Processed)             |
| ---- | -------------------------- | --------------------------------------------------------- | ---------------------------------------------- | --------------------------- | ------------------------------- |
| 1    | **GCP Selection**          | Match drone images to GCPs, user marks pixel locations    | Drone images, gcp_locations.csv (see note)     | gcp_list.txt, geo.txt       | —                               |
| 2    | **Orthomosaic Generation** | Run ODM to create orthomosaic + DEM                       | Images, GCP data                               | ODM working dir (temp/)     | RGB.tif, DEM.tif, pyramids      |
| 3    | **Plot Boundaries**        | User draws plot polygons on orthomosaic (Leaflet map)     | Orthomosaic                                    | Plot-Boundary-WGS84.geojson | —                               |
| 4    | **Trait Extraction**       | Extract vegetation fraction, height, temperature per plot | Orthomosaic, DEM, boundaries                   | —                           | Traits GeoJSON                  |
| 5    | **Inference** _(optional)_ | Roboflow on split plot images                             | Split plot PNGs, Roboflow config (per-request) | plot_images/                | Predictions CSV, Traits GeoJSON |

#### Note: GCP Locations CSV (`gcp_locations.csv`)

Format: `Label, Lat_dec, Lon_dec, Altitude` — one row per ground control point.

This file is needed before GCP Selection can run. There are two ways to provide it:

1. **Upload tab → Platform Logs** — user uploads `gcp_locations.csv` alongside mavlink logs during data upload. Stored in `Raw/{experiment}/{location}/{population}/`. Available to all future runs for that population.
2. **Inline at GCP Selection step** — if the file isn't already present, the GCP picker UI shows a file upload prompt before showing candidate images. Same file is saved to the same Raw location.

Old app behavior: accepted it as a standalone upload at the population level. The GCP picker loaded it from there; no inline fallback existed. We will add the inline fallback so users aren't forced to go back to the upload tab.

---

### Reuse Model

When a user creates a new PipelineRun for a different date:

- **Ground:** `plot_borders.csv` from pipeline is auto-applied via GPS matching (filter_plot_borders logic). User can review/adjust.
- **Aerial:** `Plot-Boundary-WGS84.geojson` from pipeline is reused directly (same field layout). User can adjust if needed.
- Steps 1-3 may need to re-run (new images need stitching/orthomosaic), but plot boundaries carry over.
- Inference step can reuse same Roboflow model config.

---

## Uploaded Orthomosaic Support

Users may already have a pre-processed orthomosaic (e.g. generated outside of GEMI, or from a previous run). The app supports uploading this TIF directly and using it in the aerial pipeline, skipping the ODM generation step entirely.

### Upload

Upload via **Files → Orthomosaic** data type.  Files are stored at:
```
Raw/{year}/{exp}/{loc}/{pop}/{date}/{platform}/{sensor}/Orthomosaic/
```
The same experiment/location/population/date/platform/sensor values must match those of the pipeline run.

### Validation on Upload

After the upload completes, the app automatically checks the CRS of each uploaded TIF (`GET /api/v1/files/check-geotiff`).

- **WGS84 (EPSG:4326)**: Ready to use — no action needed.
- **Other CRS (e.g. UTM)**: A dialog prompts the user to convert in-place (`POST /api/v1/files/convert-geotiff`).  The original file is backed up as `*.original.tif` before conversion.  The user is warned that reprojection (Lanczos resampling) may slightly alter pixel values.  Conversion requires `rasterio`.

### Using in a Pipeline Run

In the **Run Detail** view for an aerial pipeline, before the Orthomosaic step is complete, a dashed-border panel appears:

> **Skip ODM — Use Uploaded Orthomosaic**
> Clicking registers the uploaded TIF as the orthomosaic output for this run (`POST /api/v1/pipeline-runs/{id}/use-uploaded-ortho`), hard-links it to `Processed/{workspace}/.../{date}-RGB.tif`, and marks the `orthomosaic` step complete. The run can then proceed directly to Plot Boundaries and Trait Extraction.

---

## ODM Integration

ODM runs via **Docker** — this is a hard requirement for aerial orthomosaic generation. Users must have Docker installed.

The backend calls `docker run opendronemap/odm` directly via subprocess. GPU acceleration is auto-detected via `nvidia-smi`; if absent, the CPU image is used instead.

**Setup required by user (one-time):**
```bash
docker pull opendronemap/odm       # CPU
docker pull opendronemap/odm:gpu   # optional GPU variant
```

---

## AgRowStitch + bin_to_images Packaging

### bin_to_images (Amiga .bin extraction)

Vendored directly into the backend at `backend/bin_to_images/bin_to_images.py`. Copied from the old GEMINI app. Requires `farm-ng-amiga` pip package (installed by `build.sh`).

### AgRowStitch + LightGlue (ground stitching)

Not on PyPI. Managed as **git submodules** bundled under `backend/vendor/`.

#### TODO: Add git submodules

Run the following from the repo root (one-time setup):

```bash
# AgRowStitch — GEMINI image stitching (opencv branch)
git submodule add -b opencv https://github.com/GEMINI-Breeding/AgRowStitch.git backend/vendor/AgRowStitch

# LightGlue — feature matching dependency of AgRowStitch
git submodule add https://github.com/cvg/LightGlue.git backend/vendor/LightGlue
```

After cloning the repo, initialise submodules with:

```bash
git submodule update --init --recursive
```

`build.sh` installs both into the venv automatically before running PyInstaller.

---

## Binary Extraction (Amiga .bin files)

Integrated into the upload flow:

- When user uploads `.bin` files, the backend detects the file type
- Runs `bin_to_images.py` extraction as a background task (tracked via ProcessPanel)
- Extracted images + `msgs_synced.csv` + calibration JSON saved to Raw/
- Upload is not "complete" until extraction finishes
- Progress tracked via SSE (number of frames extracted)

---

## Backend API Endpoints

### Pipeline CRUD

```
POST   /api/v1/pipelines/                    # create pipeline
GET    /api/v1/pipelines/?workspace_id=...    # list pipelines for workspace
GET    /api/v1/pipelines/{id}                 # get pipeline
PUT    /api/v1/pipelines/{id}                 # update pipeline config
DELETE /api/v1/pipelines/{id}                 # delete pipeline
```

### Pipeline Runs

```
POST   /api/v1/pipelines/{id}/runs            # create a new run (for a date)
GET    /api/v1/pipelines/{id}/runs             # list runs for pipeline
GET    /api/v1/pipeline-runs/{run_id}          # get run status/outputs
PUT    /api/v1/pipeline-runs/{run_id}          # update run (resume, config)
DELETE /api/v1/pipeline-runs/{run_id}          # delete run + outputs
```

### Processing Actions (trigger actual work)

```
POST /api/v1/pipeline-runs/{run_id}/execute-step  # body: { step: "stitching" }
POST /api/v1/pipeline-runs/{run_id}/stop           # stop current step
GET  /api/v1/pipeline-runs/{run_id}/progress        # SSE stream for progress
```

### Ground-specific

```
POST /api/v1/pipeline-runs/{run_id}/plot-marking      # save plot boundary selections
GET  /api/v1/pipeline-runs/{run_id}/images            # get image list for marking
POST /api/v1/pipeline-runs/{run_id}/apply-boundaries  # apply existing boundaries to new date
POST /api/v1/pipeline-runs/{run_id}/plot-boundaries   # save adjusted plot boundary polygons
                                                      #   (ground: updates plot_boundaries.geojson in processed dir)
                                                      #   (aerial: writes Plot-Boundary-WGS84.geojson to intermediate)
GET  /api/v1/pipeline-runs/{run_id}/orthomosaic-info  # combined_mosaic.tif path + WGS84 bounds (ground)
                                                      #   or RGB.tif path + bounds (aerial)
                                                      #   shared by BoundaryDrawer for both pipeline types
```

### Aerial-specific

```
POST /api/v1/pipeline-runs/{run_id}/gcp-candidates   # get GCP candidate images
POST /api/v1/pipeline-runs/{run_id}/gcp-save          # save GCP pixel selections
POST /api/v1/pipeline-runs/{run_id}/plot-boundaries    # save drawn plot polygons
```

### Shared

```
GET  /api/v1/pipeline-runs/{run_id}/outputs           # list all output files
GET  /api/v1/pipeline-runs/{run_id}/outputs/{file}     # download/serve a specific output
POST /api/v1/pipeline-runs/{run_id}/inference           # trigger Roboflow inference
GET  /api/v1/pipeline-runs/{run_id}/inference-results   # get inference results
POST /api/v1/pipeline-runs/{run_id}/download-crops      # download plot crops as ZIP
```

---

## Frontend Structure

### Route Changes (Minimal)

Keep the existing routes. The pipeline wizard at `/process/$workspaceId/pipeline?type=ground|aerial` becomes the real entry point.

```
/process                          → WorkspaceDashboard (connect to backend)
/process/$workspaceId             → WorkspaceDetail (show pipelines + runs)
/process/$workspaceId/pipeline    → Pipeline wizard (create/edit pipeline)
/process/$workspaceId/run/$runId  → NEW: Run detail view (step-by-step execution)
```

### Key Frontend Components

**WorkspaceDashboard** — wire up to workspace API (already done on backend)

**WorkspaceDetail** — show real pipelines with their runs. Each pipeline card shows:

- Pipeline name, type badge
- List of runs (by date) with status
- "New Run" button to process a new date

**Pipeline Wizard** — simplified from current 3-step to focus on:

- Step 1: Name + type selection (keep current)
- Step 2: Processing settings (stitch config for ground, ODM options for aerial)
- Step 3: Roboflow config (optional — API key, model ID, passed per-request)
- Saves pipeline to backend on completion

**Run Detail View** (new) — the main workhorse:

- Shows the step sequence as a vertical stepper
- Each step has: status indicator, action button, output preview
- For interactive steps (plot marking, GCP selection, boundary drawing): opens inline tool
- For compute steps (stitching, ODM, inference): shows progress via SSE
- Output files shown in a unified table at the bottom

**Unified Outputs Table** — single table for all run outputs:

- Columns: Name, Type (mosaic/crop/inference), Step, Date, Actions (view/download)
- Filterable by step and type
- Replaces the old app's repeated per-step tables

### Interactive Tools (reuse old logic, new UI)

1. **Plot Marker** (ground) — image viewer with prev/next, click to mark start/end
2. **GCP Picker** (aerial) — image viewer showing GCP candidates, click to mark pixel location
3. **Boundary Drawer** (aerial) — Leaflet map with orthomosaic tiles, polygon draw tools
4. **Inference Viewer** — shows plot images with bounding box/segmentation overlays

---

## Implementation Order

### Phase 1: Data Model + CRUD (Backend)

1. Create Pipeline and PipelineRun models
2. Create CRUD functions
3. Create API routes
4. Table creation (auto via create_all at startup)

### Phase 2: Frontend Wiring

1. Connect WorkspaceDashboard to workspace API
2. Connect Pipeline wizard to pipeline API
3. Build RunDetail page with step stepper
4. Build unified outputs table component

### Phase 3: Ground-based Processing (Backend)

1. Integrate binary extraction into upload flow (.bin → images)
2. Port plot marking logic (plot_marking.py → new endpoint)
3. Port AgRowStitch integration (stitch_utils.py → new endpoint, git submodule)
4. Port georeferencing logic
5. SSE progress streaming for long operations

### Phase 4: Aerial Processing (Backend)

1. Port GCP selection (gcp_picker.py → new endpoint)
2. Port ODM integration via PyODM + NodeODM (orthomosaic_generation.py → new endpoint)
3. Port plot boundary saving + orthomosaic splitting
4. Port drone trait extraction

### Phase 5: Shared Features

1. Roboflow inference endpoint (works for both pipeline types, config per-request)
2. Crop download (ZIP generation)
3. Inference results viewer
4. Boundary reuse across runs/dates (versioned boundary sets)

### Phase 6: Interactive Frontend Tools

1. Plot Marker component (image viewer with marking)
2. GCP Picker component
3. Leaflet-based boundary drawer
4. Inference result overlay viewer

---

## Resolved Questions

1. **Binary extraction**: Yes, needed. Vendored `bin_to_images.py` at `backend/bin_to_images/`. Requires `farm-ng-amiga` pip package.
2. **ODM**: Docker is required. Users must have Docker installed and pull the ODM image. No alternative without a remote WebODM instance.
3. **Roboflow key storage**: Per-request for now, not stored server-side.
4. **Map library**: Leaflet (matches old app).
5. **AgRowStitch**: Git submodules at `backend/vendor/AgRowStitch` + `backend/vendor/LightGlue`. `build.sh` installs them into the venv before PyInstaller runs.
6. **Scope**: All steps in first pass, iterate as needed.
