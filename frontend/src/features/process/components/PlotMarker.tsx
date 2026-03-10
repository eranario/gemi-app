/**
 * PlotMarker — interactive tool for ground pipeline Step 1.
 *
 * The user navigates through raw images and clicks "Mark Start" / "Mark End"
 * to define the image range for each plot.  When all plots are marked the
 * selections are saved to the backend (POST /plot-marking), which writes
 * plot_borders.csv to Intermediate/.
 *
 * Images are served from the backend via GET /files/serve?path=... which reads
 * directly from the local filesystem.  The absolute path is provided by the
 * GET /images endpoint (raw_dir + "/" + filename).
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
} from "lucide-react"
import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

function apiUrl(path: string): string {
  const base = (window as any).__GEMI_BACKEND_URL__ ?? ""
  return base ? `${base}${path}` : path
}
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

// ── Component ─────────────────────────────────────────────────────────────────

export function PlotMarker({ runId, onSaved, onCancel }: PlotMarkerProps) {
  const { showErrorToast } = useCustomToast()
  const queryClient = useQueryClient()

  // Fetch image list from backend
  const { data: imageData, isLoading } = useQuery<ImageListResponse>({
    queryKey: ["run-images", runId],
    queryFn: () =>
      ProcessingService.listImages({ id: runId }) as unknown as Promise<ImageListResponse>,
  })

  const images = imageData?.images ?? []
  const rawDir = imageData?.raw_dir ?? ""

  // Current image index
  const [currentIdx, setCurrentIdx] = useState(0)

  // Plot selections — start with one empty plot
  const [plots, setPlots] = useState<PlotSelection[]>([
    { plot_id: 1, start_image: null, end_image: null, direction: "north_to_south" },
  ])
  const [activePlotId, setActivePlotId] = useState<number>(1)

  const activePlot = plots.find((p) => p.plot_id === activePlotId)
  const currentImage = images[currentIdx] ?? null

  // Navigation
  const prev = () => setCurrentIdx((i) => Math.max(0, i - 1))
  const next = () => setCurrentIdx((i) => Math.min(images.length - 1, i + 1))

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowLeft") prev()
    if (e.key === "ArrowRight") next()
  }

  // Marking actions
  const markStart = () => {
    if (!currentImage || !activePlot) return
    setPlots((prev) =>
      prev.map((p) =>
        p.plot_id === activePlotId ? { ...p, start_image: currentImage } : p,
      ),
    )
  }

  const markEnd = () => {
    if (!currentImage || !activePlot) return
    setPlots((prev) =>
      prev.map((p) =>
        p.plot_id === activePlotId ? { ...p, end_image: currentImage } : p,
      ),
    )
  }

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
    setPlots((prev) =>
      prev.map((p) => (p.plot_id === id ? { ...p, direction } : p)),
    )
  }

  // Jump to marked frame
  const jumpTo = (imageName: string | null) => {
    if (!imageName) return
    const idx = images.indexOf(imageName)
    if (idx >= 0) setCurrentIdx(idx)
  }

  // Validation
  const incomplete = plots.filter((p) => !p.start_image || !p.end_image)
  const canSave = incomplete.length === 0 && plots.length > 0

  // Save mutation
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

  // Image src — served through backend file-serve endpoint (absolute path on disk)
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
        <p className="text-sm">
          No images found in the raw data directory for this run.
        </p>
        <p className="text-xs">{rawDir}</p>
      </div>
    )
  }

  return (
    <div className="space-y-4" onKeyDown={handleKey} tabIndex={0}>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Image viewer (2/3 width) */}
        <div className="lg:col-span-2 space-y-2">
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

            {/* Frame overlay badges */}
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

          {/* Navigation controls */}
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={prev} disabled={currentIdx === 0}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <div className="flex-1 text-center text-sm text-muted-foreground font-mono">
              {currentImage ?? "—"}
            </div>
            <Button
              variant="outline"
              size="icon"
              onClick={next}
              disabled={currentIdx === images.length - 1}
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
          <div className="text-center text-xs text-muted-foreground">
            {currentIdx + 1} / {images.length} · Use ← → keys to navigate
          </div>

          {/* Mark buttons */}
          <div className="flex gap-2">
            <Button
              className="flex-1"
              variant={activePlot?.start_image === currentImage ? "default" : "outline"}
              onClick={markStart}
              disabled={!currentImage}
            >
              <Flag className="w-4 h-4 mr-2 text-green-600" />
              Mark as Start
            </Button>
            <Button
              className="flex-1"
              variant={activePlot?.end_image === currentImage ? "default" : "outline"}
              onClick={markEnd}
              disabled={!currentImage}
            >
              <FlagOff className="w-4 h-4 mr-2 text-red-600" />
              Mark as End
            </Button>
          </div>
        </div>

        {/* Plot list (1/3 width) */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Plots ({plots.length})</span>
            <Button variant="outline" size="sm" onClick={addPlot}>
              <Plus className="w-3 h-3 mr-1" />
              Add Plot
            </Button>
          </div>

          <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
            {plots.map((plot) => {
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
                        <span className="text-sm font-medium">Plot {plot.plot_id}</span>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={(e) => {
                          e.stopPropagation()
                          removePlot(plot.plot_id)
                        }}
                        disabled={plots.length === 1}
                      >
                        <Trash2 className="w-3 h-3 text-muted-foreground" />
                      </Button>
                    </div>
                  </CardHeader>
                  {isActive && (
                    <CardContent className="px-3 pb-3 space-y-2">
                      {/* Start frame */}
                      <div className="flex items-center justify-between gap-2">
                        <Label className="text-xs text-muted-foreground shrink-0">Start</Label>
                        <div className="flex items-center gap-1 flex-1 min-w-0">
                          <span className="text-xs font-mono truncate">
                            {plot.start_image ?? "—"}
                          </span>
                          {plot.start_image && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-5 w-5 shrink-0"
                              onClick={() => jumpTo(plot.start_image)}
                            >
                              <ChevronRight className="w-3 h-3" />
                            </Button>
                          )}
                        </div>
                      </div>
                      {/* End frame */}
                      <div className="flex items-center justify-between gap-2">
                        <Label className="text-xs text-muted-foreground shrink-0">End</Label>
                        <div className="flex items-center gap-1 flex-1 min-w-0">
                          <span className="text-xs font-mono truncate">
                            {plot.end_image ?? "—"}
                          </span>
                          {plot.end_image && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-5 w-5 shrink-0"
                              onClick={() => jumpTo(plot.end_image)}
                            >
                              <ChevronRight className="w-3 h-3" />
                            </Button>
                          )}
                        </div>
                      </div>
                      {/* Direction */}
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

          {/* Summary + save */}
          {incomplete.length > 0 && (
            <p className="text-xs text-amber-600">
              {incomplete.length} plot{incomplete.length > 1 ? "s" : ""} still need start/end marked.
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
              {saveMutation.isPending ? "Saving…" : "Save Markings"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
