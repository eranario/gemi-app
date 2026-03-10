# Analyze Tab — Implementation Plan

## Overview

The Analyze tab is where users explore the outputs of their processing runs. It has two main views:

1. **Map View** — orthomosaic tiles + trait polygons overlaid on a satellite/base map, color-coded by a selected metric with a hover tooltip and legend.
2. **Stats View** — tabular and chart-based exploration of trait data (per-plot statistics, histograms by accession).

The old GEMINI app had both of these but tied to a flat filesystem hierarchy (`year/experiment/location/population/date/platform/sensor`). The new app derives everything from the `PipelineRun` and its `outputs` dict.

---

## What the Old App Had

### Map View (`MapView.js`)
- **Deck.gl** (`@deck.gl/react`) + **react-map-gl** (Mapbox satellite base map)
- `TileLayer` (BitmapLayer per tile) — renders COG orthomosaic tiles via a tile server
- `GeoJsonLayer` — renders plot polygons from a traits GeoJSON file, filled by a color scale
- **Color mapping** — d3-scale linear, 2nd–98th percentile clipping, red→blue (or blue→red for temperature)
- **Hover tooltip** — shows plot #, accession, and selected metric value on mouse hover
- **ColorMapLegend** — fixed position overlay showing the color gradient and min/max values
- **Metric selector** — dropdown in the sidebar to choose which trait column to color by
- **Genotype filter** — dropdown to filter to specific accessions
- **Download CSV** — split button: download filtered or all plots as CSV

### Stats View (`StatsMenuMain` + `TableTab` + `GraphTab`)
- **Data discovery** — iterates processed dates/platforms/sensors to find traits GeoJSON files
- **Accordion table** — expandable rows grouped by Platform → Sensor → Date, each row has a "Load" button
- **Load modal** — opens a full-screen dialog with a `DataGrid` showing all columns from the GeoJSON properties, sortable and filterable, plus a "Download CSV" button
- **Graph tab** (partially implemented) — histogram charts for `Height_95p_meters` and `Vegetation_Fraction`, grouped by accession, using Chart.js

---

## New App Architecture

### Data Source

The new app doesn't use a filesystem hierarchy — it uses `PipelineRun.outputs`. The relevant output keys are:

| Pipeline Type | Step | Output Key | File Type | Notes |
|---|---|---|---|---|
| Aerial | `trait_extraction` | `traits_geojson` | GeoJSON with per-plot polygon + trait columns | Primary analysis target |
| Aerial | `orthomosaic` | `ortho_dir` | ODM output dir (RGB.tif inside) | COG GeoTIFF |
| Ground | `georeferencing` | `georeferencing` | Directory path | Contains `combined_mosaic.tif` (WGS84) + per-plot UTM TIFs |
| Ground | `georeferencing` | `plot_boundaries_geojson` | GeoJSON path | One polygon per plot (rotated footprint), with `plot_id`, `plot` label, `accession` |
| Ground | `inference` | `inference` | Dict `{label: rel_csv_path}` | Per-model detection CSVs |

**Ground georeferencing output**: `run_georeferencing()` calls `combine_utm_tiffs_to_mosaic()` then `build_plot_boundaries_geojson()` which writes:
- `combined_mosaic.tif` — all plots merged into one WGS84 GeoTIFF (shown as map image overlay)
- `combined_mosaic_utm.tif` — UTM projection version
- `georeferenced_plot_{id}_utm.tif` — individual plot GeoTIFFs
- `plot_boundaries.geojson` — WGS84 FeatureCollection, one polygon per plot, properties: `plot_id`, `plot` (label), `accession`

The plot boundary polygons are the actual rotated footprints of each georeferenced TIF (4 corner coordinates transformed from UTM → WGS84), so they correctly represent rotated row plots. Plot labels and accessions come from `plot_borders.csv` columns `Plot` and `Accession` (populated when the user associates plots with a field layout, same flow as the old app)..

### Serving Files

All files are served via:
```
GET /api/v1/files/serve?path={abs_path}
```

The `data_root` setting + relative path from `run.outputs` gives the absolute path.

For the orthomosaic tile layer, we need a **tile server** endpoint that reads a COG GeoTIFF and returns map tiles. Options:

- **Option A (Recommended):** Add a `/api/v1/files/tiles/{z}/{x}/{y}?path=...` endpoint using `rio-cogeo` + `rasterio` to serve XYZ tiles directly from the FastAPI backend. This avoids any external dependency.
- **Option B:** Use `titiler` as a separate service (more powerful, more complex to deploy).
- **Option C:** For the Leaflet/deck.gl map, render the orthomosaic as a simple image overlay (like BoundaryDrawer does) — no tile server needed, but won't scale well for large files.

**Recommendation: Start with Option C (image overlay) for v1, upgrade to Option A (COG tiles) when needed.**

### Map Library

**Decision: deck.gl + MapLibre GL** (not Leaflet).

Plot counts can reach ~1000. Leaflet's SVG renderer puts every polygon into the DOM — at 1000 polygons, pan/zoom becomes noticeably sluggish. Leaflet's canvas renderer helps, but it is still CPU-bound and does not handle rapid metric recoloring well.

deck.gl uses **WebGL GPU rendering** and handles 100 k+ features smoothly. It is also what the old GEMINI app used (minus the Mapbox dependency). We replace Mapbox with **MapLibre GL** (open-source fork, no token required), using `react-map-gl` v8+ which supports MapLibre as a drop-in backend.

```
npm install deck.gl @deck.gl/react @deck.gl/layers @deck.gl/geo-layers react-map-gl maplibre-gl
```

Free base map style (no token):
```
https://basemaps.cartocdn.com/gl/positron-gl-style/style.json
```

> **Note:** Leaflet (Geoman) is still used for **BoundaryDrawer** in the process tab — polygon editing tools depend on it. The Analyze map is a separate component with no editing, so switching to deck.gl there has no impact on BoundaryDrawer.

---

## Routes

Add a new top-level section to the app:

```
/analyze                        → AnalyzeDashboard (browse runs with outputs)
/analyze/$runId                 → AnalyzeRun (map + stats for a specific run)
```

Or alternatively, integrate into the existing process routes:

```
/process/$workspaceId/run/$runId/analyze  → run-specific analyze view
```

**Recommendation: Standalone `/analyze` section** — it's conceptually separate from processing and users may want to compare runs across workspaces.

---

## Backend Endpoints Needed

### 1. Analyze run list
```
GET /api/v1/analyze/runs
```
Returns all pipeline runs that have at least one of: `traits_geojson`, `ortho_cog`, `mosaic_cog`, or any inference CSV. Includes workspace name, pipeline name, date, platform, sensor.

### 2. Traits GeoJSON
```
GET /api/v1/analyze/runs/{run_id}/traits
```
Returns the traits GeoJSON (fetches from `run.outputs.traits_geojson`, reads file, returns JSON). Includes available metric columns in the response.

### 3. Orthomosaic info
```
GET /api/v1/analyze/runs/{run_id}/ortho-info
```
Returns the orthomosaic path + WGS84 bounding box (needed to position the image overlay on the map).

### 4. Inference CSV
```
GET /api/v1/analyze/runs/{run_id}/inference-csv?model={label}
```
Returns inference predictions as JSON rows (reads the per-model CSV).

### 5. Plot image + predictions (for hover popup)
```
GET /api/v1/analyze/runs/{run_id}/plot-image?plot_id={id}&model={label}
```
Returns the image URL (via `/files/serve`) and matching predictions from the inference CSV for a single plot. Used by the hover popup.

### 6. (Future) COG tiles
```
GET /api/v1/analyze/runs/{run_id}/tiles/{z}/{x}/{y}
```
Serves XYZ tiles from the COG orthomosaic.

---

## Frontend Structure

```
frontend/src/features/analyze/
  pages/
    AnalyzeDashboard.tsx     # run browser: table of runs with outputs
    AnalyzeRun.tsx           # map + stats for a single run (tab switcher: Map | Stats)
  components/
    TraitMap.tsx             # deck.gl + MapLibre: ortho BitmapLayer + GeoJsonLayer colored by metric
    ColorLegend.tsx          # fixed-position gradient bar overlay (min/max labels, metric name)
    PlotImagePopup.tsx       # hover popup: plot thumbnail + bounding box canvas overlay
    TraitsTable.tsx          # sortable/filterable table of all plot properties
    TraitHistogram.tsx       # Recharts BarChart — histogram (10 bins) by accession + metric
    MetricSelector.tsx       # dropdown of all numeric columns (dynamically from GeoJSON)
    RunSidebar.tsx           # collapsible right panel: run info, metric selector, filter, download
```

---

## Map View — Detailed Design

### What each pipeline type shows

Both pipeline types show a **mosaic layer + colored plot polygon layer**. The difference is in the data source.

| Pipeline | Mosaic layer | Plot polygon layer | Metrics available |
|---|---|---|---|
| Aerial | ODM orthomosaic (`RGB.tif`) image overlay | `Traits-WGS84.geojson` — all numeric columns (Vegetation_Fraction, Height_95p_meters, Avg_Temp_C, etc.) | All numeric columns from traits GeoJSON, dynamically detected |
| Ground | `combined_mosaic.tif` image overlay | `plot_boundaries.geojson` (georeferenced plot footprints) joined with inference results | Detection count per class from inference CSV; grey polygons if no inference ran |

For ground runs, the backend `/analyze/runs/{id}/traits` endpoint constructs a synthetic GeoJSON by joining `plot_boundaries.geojson` with the inference CSV — aggregating detection counts per plot — so the same color-by-metric UI works for both pipeline types.

### Layout
- Full-width map (takes most of the screen)
- Right sidebar (collapsible) with:
  - Run info (name, date, pipeline type)
  - Metric selector dropdown — **all numeric columns, dynamically detected from the data** (works for both aerial traits and ground detection counts)
  - Accession/genotype filter — multi-select (aerial: from `accession` field; ground: from `plot_borders.csv`)
  - Download CSV button — filtered + all
- Bottom-left: `ColorLegend` overlay — gradient bar with 2nd/98th percentile min/max labels
- Hover tooltip on all plot polygons

### Map Layers (deck.gl + MapLibre)
1. **Base tile layer** — CartoDB Positron via MapLibre (`TileLayer` from deck.gl or MapLibre's built-in raster layer)
2. **Orthomosaic overlay** — `BitmapLayer` (deck.gl) with the WGS84 bounding box from `/analyze/runs/{id}/ortho-info`. Works for both aerial (`RGB.tif`) and ground (`combined_mosaic.tif`).
3. **Plot polygon layer** — `GeoJsonLayer` (deck.gl):
   - `getFillColor`: maps selected metric → color via d3-scale (2nd–98th percentile clipping, red→blue gradient; blue→red for temperature)
   - `getLineColor`: white at low opacity
   - `onHover`: show tooltip + optional `PlotImagePopup`
   - Polygons with null metric value rendered gray (`[128, 128, 128, 180]`)
4. **Tooltip**: React `<div>` absolutely positioned at cursor, not a deck.gl popup, to avoid z-index issues

### Color Mapping
- Metric selector shows **all numeric columns from the GeoJSON properties**, detected dynamically — no hardcoded list
- Compute 2nd–98th percentile of the selected column across all features
- d3-scale linear interpolation: red → blue (reverse for columns containing "temp" or "temperature")
- `ColorLegend` shows the gradient bar + min/max values + current metric name
- Color scale recomputes whenever the selected metric changes

### Tooltip (on hover)
- Plot number / plot_id
- Accession name (if available)
- Selected metric value (2 dp)
- All other numeric values in a scrollable list

### Plot Image Preview (on hover) — Nice to Have
When the user hovers over a plot polygon, a richer popup appears showing:

**Aerial runs:**
- Thumbnail of the cropped plot image (split from the orthomosaic during trait extraction)
- If inference was run: the same thumbnail with bounding boxes drawn on top (canvas overlay, same colour-per-class logic as InferenceTool)
- Trait values below the image

**Ground runs:**
- Thumbnail of the stitched plot PNG (`full_res_mosaic_temp_plot_{id}.png`) served via `/files/serve`
- If inference was run: bounding boxes drawn on the thumbnail for all predictions matching that plot image
- No trait values (ground has no traits GeoJSON in v1), but detection count shown (e.g. "14 detections")

**Implementation approach:**

Backend — add one endpoint:
```
GET /api/v1/analyze/runs/{run_id}/plot-image?plot_id={id}&model={label}
```
Returns:
```json
{
  "image_path": "rel/path/to/plot_3.png",
  "image_url": "/api/v1/files/serve?path=...",
  "predictions": [
    {"class": "wheat_head", "confidence": 0.91, "x": 120, "y": 80, "width": 40, "height": 35},
    ...
  ]
}
```
- `plot_id` maps to the plot number from the GeoJSON `feature.properties.plot` field (aerial) or the plot border CSV ID (ground)
- Looks up the correct image in `run.outputs.stitching` dir (ground) or cropped plot dir (aerial)
- Reads matching rows from the inference CSV for that plot's image filename

Frontend — `PlotImagePopup` component:
- Triggered on Leaflet polygon `mouseover`, dismissed on `mouseout`
- Positioned near the cursor (absolute div, not a Leaflet popup, to avoid z-index issues)
- Shows a `<canvas>` element sized to the image dimensions
- Draws the image first, then loops over predictions and draws coloured bounding boxes + labels (same `classColour()` helper as InferenceTool)
- Shows a small loading spinner while fetching
- Debounced: only fires request if mouse stays over a polygon for 300ms (avoids hammering the API while panning)
- Falls back gracefully: if no image found, shows only the trait text tooltip

### Download
- "Download CSV" → converts GeoJSON properties to CSV client-side, downloads
- If genotype filter active: "Download Filtered CSV" + "Download All CSV"

---

## Stats View — Detailed Design

### Layout
Two sub-tabs within the Stats view:
1. **Table** — full trait table for the selected run
2. **Charts** — histograms by accession

### Table Tab
- Shows all columns from the GeoJSON properties (or inference CSV)
- Columns: plot, accession, all numeric trait columns
- Sortable by any column, filterable
- "Download CSV" button
- Uses shadcn/ui Table (or a lightweight virtual table for large datasets)

### Charts Tab
- Accession selector dropdown (or "All")
- Trait selector: **all numeric columns, dynamically detected** — no hardcoded list
- Bar chart: histogram (10 bins) of the selected trait for the selected accession
- "Save as PNG" button (uses canvas export or Recharts' built-in `toDataURL`)
- Library: **Recharts** (`BarChart` + `ResponsiveContainer`)

---

## Data Model Mapping

| Old GEMINI concept | New app equivalent |
|---|---|
| `year/experiment/location/population` | `Workspace` |
| `date/platform/sensor` | `PipelineRun` (date field, pipeline.type) |
| Traits GeoJSON path from filesystem scan | `run.outputs.traits_geojson` (relative path) |
| Tile URL from titiler | `/api/v1/files/serve?path=...` (image overlay for v1) |
| Genotype filter (accession field) | Filter on GeoJSON `feature.properties.accession` |
| `selectedMetric` global state | Local state in `AnalyzeRun` |

---

## Implementation Order

### Phase 1: Backend
1. Add `GET /api/v1/analyze/runs` — list runs with analyze-able outputs
2. Add `GET /api/v1/analyze/runs/{id}/traits` — return merged GeoJSON + available metric columns
   - Aerial: reads `traits_geojson` directly
   - Ground: joins `plot_boundaries.geojson` with inference CSV (aggregates detection counts per plot); returns same GeoJSON shape so frontend is pipeline-agnostic
3. Add `GET /api/v1/analyze/runs/{id}/ortho-info` — return bounds + serve URL for mosaic (aerial: `RGB.tif`, ground: `combined_mosaic.tif`)
4. Add `GET /api/v1/analyze/runs/{id}/inference-csv?model={label}` — return CSV rows as JSON
5. Register routes under `/analyze`, regenerate client

### Phase 2: Analyze Dashboard
1. Create `/analyze` route + page
2. Add "Analyze" nav item to sidebar
3. Table of runs: workspace, pipeline name, date, type, available outputs (badges)
4. Click row → navigate to `/analyze/$runId`

### Phase 3: Dependencies
```
npm install deck.gl @deck.gl/react @deck.gl/layers react-map-gl maplibre-gl d3-scale recharts
```

### Phase 4: Map View
1. Create `TraitMap.tsx` — deck.gl + MapLibre: `TileLayer` (CartoDB base) + `BitmapLayer` (ortho) + `GeoJsonLayer` (polygons)
2. Create `MetricSelector.tsx` — dropdown populated from all numeric keys in GeoJSON properties
3. Create `ColorLegend.tsx` — fixed-position gradient overlay, reacts to selected metric
4. Wire color scale: d3-scale linear, 2nd–98th percentile, red→blue (reverse for temp columns)
5. Hover tooltip: absolute `<div>` at cursor position
6. Accession/genotype filter: multi-select, filters features passed to `GeoJsonLayer`
7. Download CSV: client-side convert from GeoJSON properties

### Phase 5: Stats View
1. Create `TraitsTable.tsx` — shadcn Table, all columns, sort/filter, download CSV
2. Create `TraitHistogram.tsx` — Recharts `BarChart`, 10-bin histogram, accession + metric selectors, PNG export

### Phase 6: Polish
1. Persistent metric/filter selections per run (URL search params)
2. COG tile server (Option A) to replace image overlay for large orthomosaics
3. **Future — multi-run comparison**: routes already scoped to `$runId`; add a second optional `$runId2` query param that overlays a second run's polygon layer at 50% opacity

---

## Resolved Decisions

| # | Question | Decision |
|---|---|---|
| 1 | **Leaflet vs deck.gl** | **deck.gl + MapLibre.** Plot counts can reach ~1000; Leaflet SVG degrades at that scale. deck.gl WebGL rendering stays smooth at 100k+. Leaflet stays in use for BoundaryDrawer (Geoman editing) — separate concern. |
| 2 | **Chart library** | **Recharts.** More React-native than Chart.js, no extra setup. |
| 3 | **Metric column detection** | **All numeric columns dynamically.** No hardcoded list — backend returns every numeric key from the GeoJSON properties; frontend populates the metric dropdown from that. Handles new trait types automatically. |
| 4 | **Ground runs in map view** | **Both ground and aerial supported.** Ground shows `combined_mosaic.tif` overlay + `plot_boundaries.geojson` colored by detection count (from inference CSV joined per-plot). Aerial shows orthomosaic overlay + `Traits-WGS84.geojson` colored by trait metric. Same UI, same component — backend normalizes both to GeoJSON with numeric properties. |
| 5 | **Multi-run comparison** | **Out of scope for v1.** Route is scoped to a single `$runId`. Future: add optional `?compare=$runId2` query param to overlay a second run's polygon layer. |
