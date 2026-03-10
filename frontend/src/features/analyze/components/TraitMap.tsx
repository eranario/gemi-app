/**
 * TraitMap — deck.gl + MapLibre map for the Analyze tab.
 *
 * Layers:
 *  1. CartoDB Positron base tiles (MapLibre)
 *  2. BitmapLayer — orthomosaic / combined_mosaic image overlay
 *  3. GeoJsonLayer — plot polygons filled by selected metric via d3 color scale
 *
 * Works for both aerial and ground pipeline runs.
 */

import DeckGL from "@deck.gl/react"
import { BitmapLayer, GeoJsonLayer } from "@deck.gl/layers"
import { Map as MapLibre } from "react-map-gl/maplibre"
import "maplibre-gl/dist/maplibre-gl.css"
import { useState, useMemo } from "react"
import { buildColorScale, percentileRange } from "../utils/colorScale"
import { ColorLegend } from "./ColorLegend"

const MAP_STYLE = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json"

function apiUrl(path: string): string {
  const base = (window as any).__GEMI_BACKEND_URL__ ?? ""
  return base ? `${base}${path}` : path
}

interface OrthoInfo {
  available: boolean
  path: string | null
  bounds: [[number, number], [number, number]] | null // [[s,w],[n,e]]
}

interface TraitMapProps {
  geojson: GeoJSON.FeatureCollection | null
  orthoInfo: OrthoInfo | null
  selectedMetric: string | null
  /** Feature ids to highlight (accession filter); null = show all */
  filteredIds: Set<string> | null
}

interface TooltipState {
  x: number
  y: number
  properties: Record<string, unknown>
}

export function TraitMap({ geojson, orthoInfo, selectedMetric, filteredIds }: TraitMapProps) {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)

  // Compute color scale from visible features
  const { colorFn, minVal, maxVal } = useMemo(() => {
    if (!geojson || !selectedMetric) {
      return { colorFn: null, minVal: 0, maxVal: 1 }
    }
    const values: number[] = geojson.features
      .filter((f) => filteredIds == null || filteredIds.has(String(f.properties?.plot_id ?? f.properties?.accession ?? "")))
      .map((f) => f.properties?.[selectedMetric] as number)
      .filter((v) => typeof v === "number" && !isNaN(v))
    const [lo, hi] = percentileRange(values)
    return { colorFn: buildColorScale(lo, hi, selectedMetric), minVal: lo, maxVal: hi }
  }, [geojson, selectedMetric, filteredIds])

  // Bitmap layer for the ortho/mosaic image
  const bitmapLayer = useMemo(() => {
    if (!orthoInfo?.available || !orthoInfo.bounds || !orthoInfo.path) return null
    const [[south, west], [north, east]] = orthoInfo.bounds
    const imgUrl = apiUrl(`/api/v1/files/serve?path=${encodeURIComponent(orthoInfo.path)}`)
    return new BitmapLayer({
      id: "ortho-bitmap",
      image: imgUrl,
      bounds: [west, south, east, north],
      opacity: 0.9,
    })
  }, [orthoInfo])

  // GeoJSON polygon layer
  const polygonLayer = useMemo(() => {
    if (!geojson) return null
    return new GeoJsonLayer({
      id: "trait-polygons",
      data: geojson,
      stroked: true,
      filled: true,
      lineWidthMinPixels: 1,
      getLineColor: [255, 255, 255, 120],
      getFillColor: (f: GeoJSON.Feature) => {
        if (filteredIds != null) {
          const pid = String(f.properties?.plot_id ?? f.properties?.accession ?? "")
          if (!filteredIds.has(pid)) return [128, 128, 128, 40]
        }
        if (!colorFn || !selectedMetric) return [128, 128, 128, 160]
        const v = f.properties?.[selectedMetric] as number | null | undefined
        return colorFn(v)
      },
      updateTriggers: {
        getFillColor: [selectedMetric, colorFn, filteredIds],
      },
      pickable: true,
      onHover: (info: any) => {
        if (info.object && info.coordinate) {
          setTooltip({ x: info.x, y: info.y, properties: info.object.properties ?? {} })
        } else {
          setTooltip(null)
        }
      },
    })
  }, [geojson, colorFn, selectedMetric, filteredIds])

  // Compute initial view state from ortho bounds or GeoJSON extent
  const initialViewState = useMemo(() => {
    if (orthoInfo?.bounds) {
      const [[s, w], [n, e]] = orthoInfo.bounds
      return {
        longitude: (w + e) / 2,
        latitude: (s + n) / 2,
        zoom: 15,
        pitch: 0,
        bearing: 0,
      }
    }
    return { longitude: 0, latitude: 0, zoom: 2, pitch: 0, bearing: 0 }
  }, [orthoInfo])

  const layers = [bitmapLayer, polygonLayer].filter(Boolean)

  return (
    <div className="relative w-full h-full">
      <DeckGL
        initialViewState={initialViewState}
        controller
        layers={layers}
        style={{ position: "absolute", inset: "0" }}
      >
        <MapLibre mapStyle={MAP_STYLE} />
      </DeckGL>

      {selectedMetric && colorFn && (
        <ColorLegend min={minVal} max={maxVal} column={selectedMetric} />
      )}

      {tooltip && (
        <MapTooltip x={tooltip.x} y={tooltip.y} properties={tooltip.properties} selectedMetric={selectedMetric} />
      )}
    </div>
  )
}

// ── Tooltip ────────────────────────────────────────────────────────────────────

const NON_METRIC_KEYS = new Set(["plot_id", "plot", "accession"])

function MapTooltip({
  x,
  y,
  properties,
  selectedMetric,
}: {
  x: number
  y: number
  properties: Record<string, unknown>
  selectedMetric: string | null
}) {
  const numericEntries = Object.entries(properties).filter(
    ([k, v]) => !NON_METRIC_KEYS.has(k) && typeof v === "number",
  )

  return (
    <div
      className="absolute z-20 pointer-events-none bg-background/95 backdrop-blur-sm border rounded-lg shadow-lg p-3 text-xs max-w-[240px]"
      style={{ left: x + 12, top: y - 8 }}
    >
      <p className="font-semibold mb-1">
        Plot {String(properties.plot ?? properties.plot_id ?? "—")}
      </p>
      {properties.accession != null && (
        <p className="text-muted-foreground mb-1.5">{String(properties.accession)}</p>
      )}
      {selectedMetric && properties[selectedMetric] != null && (
        <p className="font-medium text-primary mb-1.5">
          {formatLabel(selectedMetric)}: {Number(properties[selectedMetric]).toFixed(2)}
        </p>
      )}
      <div className="space-y-0.5 text-muted-foreground max-h-32 overflow-y-auto">
        {numericEntries
          .filter(([k]) => k !== selectedMetric)
          .map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3">
              <span className="truncate">{formatLabel(k)}</span>
              <span className="font-mono flex-shrink-0">{Number(v).toFixed(2)}</span>
            </div>
          ))}
      </div>
    </div>
  )
}

function formatLabel(col: string): string {
  return col.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}
