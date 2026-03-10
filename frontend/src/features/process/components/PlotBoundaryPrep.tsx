/**
 * PlotBoundaryPrep — shared interactive step for both ground and aerial pipelines.
 *
 * Flow
 * ----
 * 1. Check for field design CSV → if missing, show inline upload dialog.
 * 2. Show map with mosaic (ground: combined mosaic, aerial: orthomosaic) as background.
 *    User draws ONE outer population boundary polygon.
 * 3. Grid settings panel (width, length, rows, cols, spacing, angle).
 *    "Generate" sends pop_boundary + options to backend → gets preview GeoJSON.
 * 4. Preview the generated plot rectangles on the map → Save.
 */

import "leaflet/dist/leaflet.css"
import "@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css"

import { useEffect, useRef, useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import L from "leaflet"
import { AlertCircle, Loader2, Upload } from "lucide-react"

import { ProcessingService } from "@/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import useCustomToast from "@/hooks/useCustomToast"

function apiUrl(path: string): string {
  const base = (window as any).__GEMI_BACKEND_URL__ ?? ""
  return base ? `${base}${path}` : path
}

// Fix Leaflet default icon
delete (L.Icon.Default.prototype as any)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
})

// ── Types ─────────────────────────────────────────────────────────────────────

interface OrthoInfo {
  available: boolean
  path: string | null
  bounds: [[number, number], [number, number]] | null
  existing_geojson: GeoJSON.FeatureCollection | null
  existing_pop_boundary: GeoJSON.Feature | GeoJSON.FeatureCollection | null
}

interface FieldDesignInfo {
  available: boolean
  rows: Record<string, string>[]
  row_count: number
  col_count: number
}

interface GridOptions {
  width: number
  length: number
  rows: number
  columns: number
  verticalSpacing: number
  horizontalSpacing: number
  angle: number
}

interface PlotBoundaryPrepProps {
  runId: string
  onSaved: () => void
  onCancel: () => void
}

// ── Field design upload dialog ────────────────────────────────────────────────

function FieldDesignUploadDialog({
  open,
  onClose,
  onSaved,
  runId,
}: {
  open: boolean
  onClose: () => void
  onSaved: (info: { row_count: number; col_count: number }) => void
  runId: string
}) {
  const [csvText, setCsvText] = useState("")
  const { showErrorToast } = useCustomToast()

  const saveMutation = useMutation({
    mutationFn: () =>
      fetch(apiUrl(`/api/v1/pipeline-runs/${runId}/field-design`), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("access_token") || ""}`,
        },
        body: JSON.stringify({ csv_text: csvText }),
      }).then(async (r) => {
        if (!r.ok) throw new Error(await r.text())
        return r.json()
      }),
    onSuccess: (data) => {
      onSaved({ row_count: data.row_count, col_count: data.col_count })
      onClose()
    },
    onError: () => showErrorToast("Failed to save field design"),
  })

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => setCsvText(ev.target?.result as string)
    reader.readAsText(file)
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Upload Field Design</DialogTitle>
          <DialogDescription>
            Required CSV columns: <code>row</code>, <code>col</code>. Optional:
            <code> plot</code>, <code>accession</code>, and any other metadata columns.
            These are merged into the generated plot polygon properties.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Select CSV file</Label>
            <Input type="file" accept=".csv" className="mt-1" onChange={handleFileChange} />
          </div>
          {csvText && (
            <div>
              <Label>Preview</Label>
              <Textarea
                className="mt-1 font-mono text-xs h-36"
                readOnly
                value={csvText.split("\n").slice(0, 6).join("\n")}
              />
              <p className="text-xs text-muted-foreground mt-1">
                {csvText.split("\n").length - 1} data rows detected
              </p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            disabled={!csvText || saveMutation.isPending}
            onClick={() => saveMutation.mutate()}
          >
            {saveMutation.isPending ? "Saving…" : "Save Field Design"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Grid settings panel ───────────────────────────────────────────────────────

function GridSettingsPanel({
  options,
  onChange,
  onGenerate,
  isGenerating,
  featureCount,
}: {
  options: GridOptions
  onChange: (opts: GridOptions) => void
  onGenerate: () => void
  isGenerating: boolean
  featureCount: number
}) {
  function field(label: string, key: keyof GridOptions, step = 0.1) {
    return (
      <div>
        <Label className="text-xs">{label}</Label>
        <Input
          type="number"
          step={step}
          value={options[key]}
          onChange={(e) => onChange({ ...options, [key]: parseFloat(e.target.value) || 0 })}
          className="h-8 text-sm mt-0.5"
        />
      </div>
    )
  }

  return (
    <div className="absolute bottom-4 left-4 z-[1000] bg-background/95 border rounded-lg p-4 shadow-lg w-64 space-y-3">
      <p className="text-sm font-medium">Plot Grid Settings</p>
      <div className="grid grid-cols-2 gap-2">
        {field("Width (m)", "width")}
        {field("Length (m)", "length")}
        {field("Rows", "rows", 1)}
        {field("Columns", "columns", 1)}
        {field("V. Spacing (m)", "verticalSpacing")}
        {field("H. Spacing (m)", "horizontalSpacing")}
      </div>
      <div>
        <Label className="text-xs">Angle (°) — {options.angle.toFixed(1)}</Label>
        <input
          type="range"
          min={0}
          max={360}
          step={0.5}
          value={options.angle}
          onChange={(e) => onChange({ ...options, angle: parseFloat(e.target.value) })}
          className="w-full mt-1"
        />
      </div>
      <Button size="sm" className="w-full" onClick={onGenerate} disabled={isGenerating}>
        {isGenerating ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null}
        {isGenerating ? "Generating…" : "Generate Grid"}
      </Button>
      {featureCount > 0 && (
        <p className="text-xs text-muted-foreground text-center">
          {featureCount} plot polygons generated
        </p>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function PlotBoundaryPrep({ runId, onSaved, onCancel }: PlotBoundaryPrepProps) {
  const { showErrorToast } = useCustomToast()

  // Map refs
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const popLayerRef = useRef<L.FeatureGroup | null>(null)
  const plotLayerRef = useRef<L.FeatureGroup | null>(null)

  const [showUploadDialog, setShowUploadDialog] = useState(false)
  const [gridOptions, setGridOptions] = useState<GridOptions>({
    width: 1.5,
    length: 10,
    rows: 1,
    columns: 1,
    verticalSpacing: 0.5,
    horizontalSpacing: 0.5,
    angle: 0,
  })
  const [previewGeoJson, setPreviewGeoJson] = useState<GeoJSON.FeatureCollection | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  // Fetch mosaic/orthomosaic info (serves as background + provides existing boundaries)
  const { data: orthoInfo, isLoading: orthoLoading } = useQuery<OrthoInfo>({
    queryKey: ["orthomosaic-info", runId],
    queryFn: () => ProcessingService.orthomosaicInfo({ id: runId }) as unknown as Promise<OrthoInfo>,
  })

  // Check for field design
  const { data: fdInfo, refetch: refetchFd } = useQuery<FieldDesignInfo>({
    queryKey: ["field-design", runId],
    queryFn: () =>
      fetch(apiUrl(`/api/v1/pipeline-runs/${runId}/field-design`), {
        headers: { Authorization: `Bearer ${localStorage.getItem("access_token") || ""}` },
      }).then((r) => r.json()),
  })

  // When field design loads, populate rows/cols
  useEffect(() => {
    if (fdInfo?.available && fdInfo.row_count > 0) {
      setGridOptions((prev) => ({
        ...prev,
        rows: fdInfo.row_count,
        columns: fdInfo.col_count,
      }))
    }
  }, [fdInfo])

  // Initialise map once orthoInfo is available
  useEffect(() => {
    if (!orthoInfo?.available || !orthoInfo.bounds || !mapContainerRef.current) return
    if (mapRef.current) return

    const bounds = L.latLngBounds(orthoInfo.bounds[0], orthoInfo.bounds[1])
    const map = L.map(mapContainerRef.current, {
      crs: L.CRS.EPSG3857,
      center: bounds.getCenter(),
      zoom: 17,
      minZoom: 10,
      maxZoom: 22,
    })
    mapRef.current = map

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap contributors",
      opacity: 0.4,
    }).addTo(map)

    // Mosaic overlay
    const imgSrc = apiUrl(`/api/v1/files/serve?path=${encodeURIComponent(orthoInfo.path!)}`)
    L.imageOverlay(imgSrc, bounds, { opacity: 0.9 }).addTo(map)
    map.fitBounds(bounds)

    // Layer for population boundary (user draws ONE polygon)
    const popLayer = new L.FeatureGroup()
    popLayerRef.current = popLayer
    popLayer.addTo(map)

    // Layer for plot grid preview (read-only)
    const plotLayer = new L.FeatureGroup()
    plotLayerRef.current = plotLayer
    plotLayer.addTo(map)

    // Load existing pop boundary if present
    if (orthoInfo.existing_pop_boundary) {
      L.geoJSON(orthoInfo.existing_pop_boundary as GeoJSON.GeoJsonObject, {
        style: { color: "#f59e0b", weight: 2, fillOpacity: 0.1 },
      }).eachLayer((l) => popLayer.addLayer(l))
    }

    // Load existing plot grid if present
    if (orthoInfo.existing_geojson) {
      setPreviewGeoJson(orthoInfo.existing_geojson)
      L.geoJSON(orthoInfo.existing_geojson as GeoJSON.GeoJsonObject, {
        style: { color: "#2563eb", weight: 1.5, fillOpacity: 0.15 },
      }).eachLayer((l) => plotLayer.addLayer(l))
    }

    // Geoman: only allow drawing ONE polygon (population boundary)
    const mapAny = map as any
    if (mapAny.pm) {
      mapAny.pm.addControls({
        position: "topleft",
        drawMarker: false,
        drawCircleMarker: false,
        drawPolyline: false,
        drawCircle: false,
        drawText: false,
        drawPolygon: true,
        drawRectangle: false,
        editMode: true,
        dragMode: true,
        cutPolygon: false,
        removalMode: true,
        rotateMode: false,
      })
      mapAny.pm.setGlobalOptions({
        layerGroup: popLayer,
        pathOptions: { color: "#f59e0b", weight: 2, fillOpacity: 0.1 },
      })
    }

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [orthoInfo])

  // Update plot preview layer when previewGeoJson changes
  useEffect(() => {
    const plotLayer = plotLayerRef.current
    if (!plotLayer) return
    plotLayer.clearLayers()
    if (previewGeoJson) {
      L.geoJSON(previewGeoJson as GeoJSON.GeoJsonObject, {
        style: { color: "#2563eb", weight: 1.5, fillOpacity: 0.15 },
      }).eachLayer((l) => plotLayer.addLayer(l))
    }
  }, [previewGeoJson])

  async function handleGenerate() {
    const popLayers = popLayerRef.current?.getLayers() ?? []
    if (popLayers.length === 0) {
      showErrorToast("Draw the outer population boundary first, then generate the grid.")
      return
    }

    const popFeature = (popLayers[0] as any).toGeoJSON() as GeoJSON.Feature

    setIsGenerating(true)
    try {
      const res = await fetch(apiUrl(`/api/v1/pipeline-runs/${runId}/generate-plot-grid`), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("access_token") || ""}`,
        },
        body: JSON.stringify({ pop_boundary: popFeature, options: gridOptions }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Failed to generate grid" }))
        showErrorToast(err.detail ?? "Failed to generate grid")
        return
      }
      const data = await res.json()
      setPreviewGeoJson(data.geojson)
      // Mark saved immediately (backend already saved it)
      onSaved()
    } catch {
      showErrorToast("Failed to generate grid")
    } finally {
      setIsGenerating(false)
    }
  }

  if (orthoLoading) {
    return (
      <div className="flex h-64 items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        Loading mosaic…
      </div>
    )
  }

  if (!orthoInfo?.available) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2 text-muted-foreground">
        <AlertCircle className="h-8 w-8" />
        <p className="text-sm">
          No mosaic found for this run. Complete the preceding processing steps first.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Field design status banner */}
      <div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
        {fdInfo?.available ? (
          <span className="text-green-700">
            Field design loaded — {fdInfo.row_count} rows × {fdInfo.col_count} cols
          </span>
        ) : (
          <span className="text-muted-foreground">
            No field design found. Upload one to auto-populate row/col counts and merge accession data.
          </span>
        )}
        <Button variant="outline" size="sm" onClick={() => setShowUploadDialog(true)}>
          <Upload className="mr-1 h-3 w-3" />
          {fdInfo?.available ? "Replace" : "Upload"}
        </Button>
      </div>

      <p className="text-sm text-muted-foreground">
        <strong>Step 1:</strong> Draw the outer population boundary (yellow) on the map.<br />
        <strong>Step 2:</strong> Adjust grid dimensions and click <em>Generate Grid</em>.
      </p>

      {/* Map with floating grid settings panel */}
      <div className="relative">
        <div
          ref={mapContainerRef}
          className="w-full overflow-hidden rounded-lg border"
          style={{ height: 520 }}
        />
        <GridSettingsPanel
          options={gridOptions}
          onChange={setGridOptions}
          onGenerate={handleGenerate}
          isGenerating={isGenerating}
          featureCount={previewGeoJson?.features?.length ?? 0}
        />
      </div>

      {/* Footer */}
      <div className="flex gap-2">
        <Button variant="outline" className="flex-1" onClick={onCancel}>
          Cancel
        </Button>
      </div>

      <FieldDesignUploadDialog
        open={showUploadDialog}
        onClose={() => setShowUploadDialog(false)}
        runId={runId}
        onSaved={(info) => {
          refetchFd()
          setGridOptions((prev) => ({
            ...prev,
            rows: info.row_count || prev.rows,
            columns: info.col_count || prev.columns,
          }))
        }}
      />
    </div>
  )
}
