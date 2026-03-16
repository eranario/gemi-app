/**
 * PlotMarker — interactive tool for ground pipeline Step 1.
 *
 * The user navigates through raw images and marks start/end frames per plot.
 * An optional GPS trajectory panel shows the rover path on a satellite map
 * with the current image position highlighted.
 *
 * Keyboard shortcuts:
 *   ← / →       previous / next image
 *   S           mark current image as Start for active plot
 *   E           mark current image as End for active plot
 *   1-9         switch active plot
 */

import {
  ChevronLeft,
  ChevronRight,
  Flag,
  FlagOff,
  Plus,
  Trash2,
  Check,
  AlertCircle,
  Map,
} from "lucide-react"
import { useState, useEffect, useCallback, useRef } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Map as MapLibre, Source, Layer, Marker } from "react-map-gl/maplibre"
import type { MapRef } from "react-map-gl/maplibre"
import "maplibre-gl/dist/maplibre-gl.css"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ProcessingService } from "@/client"
import useCustomToast from "@/hooks/useCustomToast"

// ── Helpers ───────────────────────────────────────────────────────────────────

function apiUrl(path: string): string {
  const base = (window as any).__GEMI_BACKEND_URL__ ?? ""
  return base ? `${base}${path}` : path
}

const MAP_STYLE = {
  version: 8 as const,
  sources: {
    "esri-satellite": {
      type: "raster" as const,
      tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
      tileSize: 256,
      attribution: "Tiles © Esri",
      maxzoom: 19,
    },
  },
  layers: [{ id: "esri-satellite", type: "raster" as const, source: "esri-satellite" }],
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface PlotSelection {
  plot_id: number
  start_image: string | null
  end_image: string | null
  direction: string
}

interface ImageListResponse {
  images: string[]
  count: number
  raw_dir: string
  has_gps: boolean
  msgs_synced: string | null
}

interface GpsPoint {
  lat: number
  lon: number
  image: string | null
}

interface GpsDataResponse {
  points: GpsPoint[]
  count: number
}

interface PlotMarkerProps {
  runId: string
  onSaved: () => void
  onCancel: () => void
}

const DIRECTIONS = [
  { value: "north_to_south", label: "North → South" },
  { value: "south_to_north", label: "South → North" },
  { value: "east_to_west",   label: "East → West" },
  { value: "west_to_east",   label: "West → East" },
]

// ── GPS Trajectory Panel ───────────────────────────────────────────────────────

function GpsTrajectoryPanel({
  runId,
  currentImage,
}: {
  runId: string
  currentImage: string | null
}) {
  const mapRef = useRef<MapRef>(null)

  const { data: gpsData, isLoading } = useQuery<GpsDataResponse>({
    queryKey: ["gps-data", runId],
    queryFn: async () => {
      const res = await fetch(apiUrl(`/api/v1/pipeline-runs/${runId}/gps-data`))
      if (!res.ok) throw new Error("Failed to load GPS data")
      return res.json()
    },
    staleTime: Infinity,
  })

  const points = gpsData?.points ?? []

  // Fit map to trajectory bounds once points arrive
  useEffect(() => {
    if (!mapRef.current || points.length < 2) return
    const lons = points.map((p) => p.lon)
    const lats = points.map((p) => p.lat)
    mapRef.current.fitBounds(
      [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]],
      { padding: 40, duration: 600 }
    )
  }, [points.length])

  const currentPoint = currentImage
    ? points.find((p) => p.image === currentImage) ?? null
    : null

  const pathGeoJson = {
    type: "FeatureCollection" as const,
    features: points.length >= 2
      ? [{
          type: "Feature" as const,
          geometry: {
            type: "LineString" as const,
            coordinates: points.map((p) => [p.lon, p.lat]),
          },
          properties: {},
        }]
      : [],
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        Loading GPS…
      </div>
    )
  }

  if (points.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground text-sm p-4 text-center">
        <Map className="w-8 h-8 opacity-40" />
        <p>No GPS data found.</p>
        <p className="text-xs">msgs_synced.csv not found or missing lat/lon columns.</p>
      </div>
    )
  }

  const mid = points[Math.floor(points.length / 2)]

  return (
    <MapLibre
      ref={mapRef}
      initialViewState={{ longitude: mid.lon, latitude: mid.lat, zoom: 16 }}
      mapStyle={MAP_STYLE}
      style={{ width: "100%", height: "100%" }}
      attributionControl={false}
    >
      <Source id="trajectory" type="geojson" data={pathGeoJson}>
        <Layer
          id="trajectory-line"
          type="line"
          paint={{ "line-color": "#94a3b8", "line-width": 2, "line-opacity": 0.8 }}
        />
      </Source>

      {currentPoint && (
        <Marker longitude={currentPoint.lon} latitude={currentPoint.lat} anchor="center">
          <div className="w-4 h-4 rounded-full bg-yellow-400 border-2 border-white shadow-lg" />
        </Marker>
      )}
    </MapLibre>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────

export function PlotMarker({ runId, onSaved, onCancel }: PlotMarkerProps) {
  const { showErrorToast } = useCustomToast()
  const queryClient = useQueryClient()

  const { data: imageData, isLoading } = useQuery<ImageListResponse>({
    queryKey: ["run-images", runId],
    queryFn: () =>
      ProcessingService.listImages({ id: runId }) as unknown as Promise<ImageListResponse>,
  })

  const images = imageData?.images ?? []
  const rawDir = imageData?.raw_dir ?? ""
  const hasGps = imageData?.has_gps ?? false

  const [currentIdx, setCurrentIdx] = useState(0)
  const [showGps, setShowGps] = useState(false)
  const [plots, setPlots] = useState<PlotSelection[]>([
    { plot_id: 1, start_image: null, end_image: null, direction: "north_to_south" },
  ])
  const [activePlotId, setActivePlotId] = useState<number>(1)

  const activePlot = plots.find((p) => p.plot_id === activePlotId)
  const currentImage = images[currentIdx] ?? null

  const prev = useCallback(() => setCurrentIdx((i) => Math.max(0, i - 1)), [])
  const next = useCallback(
    () => setCurrentIdx((i) => Math.min(images.length - 1, i + 1)),
    [images.length]
  )

  const markStart = useCallback(() => {
    if (!currentImage) return
    setPlots((prev) =>
      prev.map((p) => p.plot_id === activePlotId ? { ...p, start_image: currentImage } : p)
    )
  }, [currentImage, activePlotId])

  const markEnd = useCallback(() => {
    if (!currentImage) return
    setPlots((prev) =>
      prev.map((p) => p.plot_id === activePlotId ? { ...p, end_image: currentImage } : p)
    )
  }, [currentImage, activePlotId])

  // Global keyboard shortcuts — attached to window so no focus management needed
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === "ArrowLeft")  { e.preventDefault(); prev() }
      if (e.key === "ArrowRight") { e.preventDefault(); next() }
      if (e.key === "s" || e.key === "S") { e.preventDefault(); markStart() }
      if (e.key === "e" || e.key === "E") { e.preventDefault(); markEnd() }
      const digit = parseInt(e.key)
      if (digit >= 1 && digit <= 9) {
        const target = plots[digit - 1]
        if (target) setActivePlotId(target.plot_id)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [prev, next, markStart, markEnd, plots])

  const addPlot = () => {
    const newId = Math.max(...plots.map((p) => p.plot_id)) + 1
    setPlots((prev) => [
      ...prev,
      { plot_id: newId, start_image: null, end_image: null, direction: "north_to_south" },
    ])
    setActivePlotId(newId)
  }

  const removePlot = (id: number) => {
    if (plots.length === 1) return
    const remaining = plots.filter((p) => p.plot_id !== id)
    setPlots(remaining)
    if (activePlotId === id) setActivePlotId(remaining[0].plot_id)
  }

  const setDirection = (id: number, direction: string) => {
    setPlots((prev) => prev.map((p) => (p.plot_id === id ? { ...p, direction } : p)))
  }

  const jumpTo = (imageName: string | null) => {
    if (!imageName) return
    const idx = images.indexOf(imageName)
    if (idx >= 0) setCurrentIdx(idx)
  }

  const incomplete = plots.filter((p) => !p.start_image || !p.end_image)
  const canSave = incomplete.length === 0 && plots.length > 0

  const saveMutation = useMutation({
    mutationFn: () =>
      ProcessingService.savePlotMarking({
        id: runId,
        requestBody: { selections: plots as unknown as { [key: string]: unknown }[] },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pipeline-runs", runId] })
      onSaved()
    },
    onError: () => showErrorToast("Failed to save plot markings"),
  })

  const imgSrc = currentImage
    ? apiUrl(`/api/v1/files/serve?path=${encodeURIComponent(rawDir + "/" + currentImage)}`)
    : null

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
        Loading images…
      </div>
    )
  }

  if (images.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-2 text-muted-foreground">
        <AlertCircle className="w-8 h-8" />
        <p className="text-sm">No images found in the raw data directory for this run.</p>
        <p className="text-xs">{rawDir}</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Keyboard hint + GPS toggle */}
      <div className="flex items-center justify-between text-xs text-muted-foreground bg-muted/40 rounded px-3 py-1.5">
        <span>
          <kbd className="bg-background border rounded px-1">←</kbd>
          <kbd className="bg-background border rounded px-1 ml-1">→</kbd> navigate ·{" "}
          <kbd className="bg-background border rounded px-1">S</kbd> start ·{" "}
          <kbd className="bg-background border rounded px-1">E</kbd> end ·{" "}
          <kbd className="bg-background border rounded px-1">1–9</kbd> switch plot
        </span>
        {hasGps && (
          <button
            onClick={() => setShowGps((v) => !v)}
            className={`flex items-center gap-1 px-2 py-0.5 rounded transition-colors ${
              showGps ? "bg-primary text-primary-foreground" : "hover:bg-muted"
            }`}
          >
            <Map className="w-3.5 h-3.5" />
            {showGps ? "Hide map" : "GPS map"}
          </button>
        )}
      </div>

      {/* Main layout — image viewer | [GPS map] | plot list */}
      <div className={`grid gap-4 ${showGps ? "grid-cols-[2fr_2fr_1fr]" : "grid-cols-[3fr_1fr]"}`}>

        {/* ── Image viewer ── */}
        <div className="space-y-2">
          <div className="relative rounded-lg overflow-hidden bg-black aspect-video flex items-center justify-center">
            {imgSrc ? (
              <img
                src={imgSrc}
                alt={currentImage ?? ""}
                className="max-h-full max-w-full object-contain"
                draggable={false}
              />
            ) : (
              <span className="text-white/50 text-sm">{currentImage}</span>
            )}
            {activePlot?.start_image === currentImage && (
              <div className="absolute top-2 left-2">
                <Badge className="bg-green-600 text-white">START</Badge>
              </div>
            )}
            {activePlot?.end_image === currentImage && (
              <div className="absolute top-2 right-2">
                <Badge className="bg-red-600 text-white">END</Badge>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={prev} disabled={currentIdx === 0}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <div className="flex-1 text-center text-xs text-muted-foreground font-mono truncate px-2">
              {currentImage ?? "—"}
            </div>
            <Button variant="outline" size="icon" onClick={next} disabled={currentIdx === images.length - 1}>
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
          <div className="text-center text-xs text-muted-foreground">
            {currentIdx + 1} / {images.length}
          </div>

          <div className="flex gap-2">
            <Button
              className="flex-1"
              variant={activePlot?.start_image === currentImage ? "default" : "outline"}
              onClick={markStart}
              disabled={!currentImage}
            >
              <Flag className="w-4 h-4 mr-2 text-green-600" />
              Mark Start
            </Button>
            <Button
              className="flex-1"
              variant={activePlot?.end_image === currentImage ? "default" : "outline"}
              onClick={markEnd}
              disabled={!currentImage}
            >
              <FlagOff className="w-4 h-4 mr-2 text-red-600" />
              Mark End
            </Button>
          </div>
        </div>

        {/* ── GPS trajectory map ── */}
        {showGps && (
          <div className="rounded-lg overflow-hidden border" style={{ minHeight: 340 }}>
            <GpsTrajectoryPanel runId={runId} currentImage={currentImage} />
          </div>
        )}

        {/* ── Plot list ── */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Plots ({plots.length})</span>
            <Button variant="outline" size="sm" onClick={addPlot}>
              <Plus className="w-3 h-3 mr-1" />
              Add
            </Button>
          </div>

          <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
            {plots.map((plot, i) => {
              const isActive = plot.plot_id === activePlotId
              const isDone = !!plot.start_image && !!plot.end_image
              return (
                <Card
                  key={plot.plot_id}
                  className={`cursor-pointer transition-colors ${
                    isActive ? "border-primary" : "hover:border-primary/50"
                  }`}
                  onClick={() => setActivePlotId(plot.plot_id)}
                >
                  <CardHeader className="py-2 px-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {isDone ? (
                          <Check className="w-4 h-4 text-green-600" />
                        ) : (
                          <div className="w-4 h-4 rounded-full border-2 border-muted-foreground" />
                        )}
                        <span className="text-sm font-medium">
                          Plot {plot.plot_id}
                          <span className="text-muted-foreground text-xs ml-1 font-normal">
                            ({i + 1})
                          </span>
                        </span>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={(e) => { e.stopPropagation(); removePlot(plot.plot_id) }}
                        disabled={plots.length === 1}
                      >
                        <Trash2 className="w-3 h-3 text-muted-foreground" />
                      </Button>
                    </div>
                  </CardHeader>

                  {isActive && (
                    <CardContent className="px-3 pb-3 space-y-2">
                      <div className="flex items-center gap-1">
                        <Label className="text-xs text-muted-foreground w-8 shrink-0">Start</Label>
                        <span className="text-xs font-mono truncate flex-1 min-w-0 text-green-700 dark:text-green-400">
                          {plot.start_image ?? "—"}
                        </span>
                        {plot.start_image && (
                          <Button variant="ghost" size="icon" className="h-5 w-5 shrink-0" onClick={() => jumpTo(plot.start_image)}>
                            <ChevronRight className="w-3 h-3" />
                          </Button>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <Label className="text-xs text-muted-foreground w-8 shrink-0">End</Label>
                        <span className="text-xs font-mono truncate flex-1 min-w-0 text-red-700 dark:text-red-400">
                          {plot.end_image ?? "—"}
                        </span>
                        {plot.end_image && (
                          <Button variant="ghost" size="icon" className="h-5 w-5 shrink-0" onClick={() => jumpTo(plot.end_image)}>
                            <ChevronRight className="w-3 h-3" />
                          </Button>
                        )}
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Direction</Label>
                        <Select
                          value={plot.direction}
                          onValueChange={(v) => setDirection(plot.plot_id, v)}
                        >
                          <SelectTrigger className="h-7 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {DIRECTIONS.map((d) => (
                              <SelectItem key={d.value} value={d.value} className="text-xs">
                                {d.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </CardContent>
                  )}
                </Card>
              )
            })}
          </div>

          {incomplete.length > 0 && (
            <p className="text-xs text-amber-600">
              {incomplete.length} plot{incomplete.length > 1 ? "s" : ""} still need{incomplete.length === 1 ? "s" : ""} start/end marked.
            </p>
          )}

          <div className="flex gap-2 pt-1">
            <Button variant="outline" className="flex-1" onClick={onCancel}>
              Cancel
            </Button>
            <Button
              className="flex-1"
              disabled={!canSave || saveMutation.isPending}
              onClick={() => saveMutation.mutate()}
            >
              {saveMutation.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
