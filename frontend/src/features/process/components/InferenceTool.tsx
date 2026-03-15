/**
 * InferenceTool — configuration form + prediction viewer for the Inference step.
 *
 * Shows two sections:
 *  1. Config form  → API key, model ID, task type → calls onRunStep to trigger inference
 *  2. Results      → summary table + image-by-image viewer with bounding box overlays
 *                    (only shown when run.steps_completed.inference is true)
 */

import { ChevronLeft, ChevronRight, Loader2, Plus, Trash2 } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { ProcessingService } from "@/client"

// ── Types ─────────────────────────────────────────────────────────────────────

interface Prediction {
  image: string
  class: string
  confidence: number
  x: number
  y: number
  width: number
  height: number
}

interface ImageInfo {
  name: string
  path: string // absolute path for /files/serve
}

export interface ModelConfig {
  label: string
  roboflow_api_key: string
  roboflow_model_id: string
  task_type: string
}

export interface InferenceRunConfig {
  models: ModelConfig[]
}

interface InferenceToolProps {
  runId: string
  inferenceComplete: boolean
  isRunning: boolean
  isStopping: boolean
  onRunInference: (config: InferenceRunConfig) => void
  onCancel: () => void
  initialModels?: ModelConfig[]
}

// ── Class colours ─────────────────────────────────────────────────────────────

const CLASS_COLOURS = [
  "#ef4444", "#3b82f6", "#22c55e", "#f59e0b", "#8b5cf6",
  "#ec4899", "#06b6d4", "#f97316", "#14b8a6", "#6366f1",
]

function classColour(cls: string): string {
  let hash = 0
  for (let i = 0; i < cls.length; i++) hash = (hash * 31 + cls.charCodeAt(i)) | 0
  return CLASS_COLOURS[Math.abs(hash) % CLASS_COLOURS.length]
}

// ── Bounding-box image viewer ─────────────────────────────────────────────────

interface ImageViewerProps {
  image: ImageInfo
  predictions: Prediction[]
}

function ImageViewer({ image, predictions }: ImageViewerProps) {
  const imgRef = useRef<HTMLImageElement>(null)
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null)

  function handleLoad() {
    const el = imgRef.current
    if (el) setDims({ w: el.naturalWidth, h: el.naturalHeight })
  }

  const base = (window as any).__GEMI_BACKEND_URL__ ?? ""
  const src = base
    ? `${base}/api/v1/files/serve?path=${encodeURIComponent(image.path)}`
    : `/api/v1/files/serve?path=${encodeURIComponent(image.path)}`

  return (
    <div className="relative w-full">
      <img
        ref={imgRef}
        src={src}
        alt={image.name}
        onLoad={handleLoad}
        className="w-full h-auto rounded border block"
      />
      {dims &&
        predictions.map((p, i) => {
          const left = ((p.x - p.width / 2) / dims.w) * 100
          const top = ((p.y - p.height / 2) / dims.h) * 100
          const width = (p.width / dims.w) * 100
          const height = (p.height / dims.h) * 100
          const colour = classColour(p.class)
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                left: `${left}%`,
                top: `${top}%`,
                width: `${width}%`,
                height: `${height}%`,
                border: `2px solid ${colour}`,
                boxSizing: "border-box",
                pointerEvents: "none",
              }}
            >
              <span
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  background: colour,
                  color: "#fff",
                  fontSize: "10px",
                  lineHeight: 1.2,
                  padding: "1px 3px",
                  whiteSpace: "nowrap",
                }}
              >
                {p.class} {(p.confidence * 100).toFixed(0)}%
              </span>
            </div>
          )
        })}
    </div>
  )
}

// ── Summary table ──────────────────────────────────────────────────────────────

function SummaryTable({ predictions }: { predictions: Prediction[] }) {
  const counts: Record<string, { count: number; confSum: number }> = {}
  for (const p of predictions) {
    if (!counts[p.class]) counts[p.class] = { count: 0, confSum: 0 }
    counts[p.class].count++
    counts[p.class].confSum += p.confidence
  }

  const rows = Object.entries(counts).sort((a, b) => b[1].count - a[1].count)

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Class</TableHead>
          <TableHead className="text-right">Detections</TableHead>
          <TableHead className="text-right">Avg Confidence</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map(([cls, { count, confSum }]) => (
          <TableRow key={cls}>
            <TableCell>
              <span className="flex items-center gap-2">
                <span
                  className="inline-block w-3 h-3 rounded-sm flex-shrink-0"
                  style={{ background: classColour(cls) }}
                />
                {cls}
              </span>
            </TableCell>
            <TableCell className="text-right font-mono">{count}</TableCell>
            <TableCell className="text-right font-mono">
              {((confSum / count) * 100).toFixed(1)}%
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

// ── Multi-model config editor ──────────────────────────────────────────────────

const EMPTY_MODEL = (): ModelConfig => ({
  label: "",
  roboflow_api_key: "",
  roboflow_model_id: "",
  task_type: "detection",
})

function ModelEditor({
  onRun,
  isRunning,
  isStopping,
  inferenceComplete,
  initialModels,
}: {
  onRun: (cfg: InferenceRunConfig) => void
  isRunning: boolean
  isStopping: boolean
  inferenceComplete: boolean
  initialModels?: ModelConfig[]
}) {
  const [models, setModels] = useState<ModelConfig[]>(() =>
    initialModels && initialModels.length > 0 ? initialModels : [EMPTY_MODEL()]
  )

  function update(idx: number, field: keyof ModelConfig, value: string) {
    setModels((prev) => prev.map((m, i) => i === idx ? { ...m, [field]: value } : m))
  }

  function addModel() {
    setModels((prev) => [...prev, EMPTY_MODEL()])
  }

  function removeModel(idx: number) {
    setModels((prev) => prev.filter((_, i) => i !== idx))
  }

  const canRun = models.length > 0 &&
    models.every((m) => m.label && m.roboflow_api_key && m.roboflow_model_id)

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {models.map((model, idx) => (
          <div key={idx} className="grid grid-cols-[1fr_1fr_1fr_auto_auto] gap-2 items-end">
            <div className="space-y-1">
              {idx === 0 && <Label className="text-xs text-muted-foreground">Name</Label>}
              <Input
                placeholder="e.g. Wheat Detection"
                value={model.label}
                onChange={(e) => update(idx, "label", e.target.value)}
              />
            </div>
            <div className="space-y-1">
              {idx === 0 && <Label className="text-xs text-muted-foreground">API Key</Label>}
              <Input
                type="password"
                placeholder="rf_xxxxxxxxxxxx"
                value={model.roboflow_api_key}
                onChange={(e) => update(idx, "roboflow_api_key", e.target.value)}
              />
            </div>
            <div className="space-y-1">
              {idx === 0 && <Label className="text-xs text-muted-foreground">Model ID</Label>}
              <Input
                placeholder="my-model/1"
                value={model.roboflow_model_id}
                onChange={(e) => update(idx, "roboflow_model_id", e.target.value)}
              />
            </div>
            <div className="space-y-1">
              {idx === 0 && <Label className="text-xs text-muted-foreground">Task</Label>}
              <Select value={model.task_type} onValueChange={(v) => update(idx, "task_type", v)}>
                <SelectTrigger className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="detection">Detection</SelectItem>
                  <SelectItem value="segmentation">Segmentation</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className={idx === 0 ? "pt-5" : ""}>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => removeModel(idx)}
                disabled={models.length === 1}
              >
                <Trash2 className="w-4 h-4 text-muted-foreground" />
              </Button>
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={addModel}>
          <Plus className="w-4 h-4 mr-1" />
          Add Model
        </Button>
        <Button
          disabled={!canRun || isRunning}
          onClick={() => onRun({ models })}
        >
          {isRunning && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          {isRunning
            ? isStopping ? "Stopping…" : "Running…"
            : inferenceComplete ? "Re-run Inference" : "Run Inference"}
        </Button>
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export function InferenceTool({
  runId,
  inferenceComplete,
  isRunning,
  isStopping,
  onRunInference,
  onCancel,
  initialModels,
}: InferenceToolProps) {
  const [imageIdx, setImageIdx] = useState(0)
  const [activeModel, setActiveModel] = useState<string | undefined>(undefined)

  const { data, isLoading } = useQuery({
    queryKey: ["inference-results", runId, activeModel],
    queryFn: () => ProcessingService.inferenceResults({ id: runId, model: activeModel }),
    enabled: inferenceComplete,
  })

  const predictions: Prediction[] = (data as any)?.predictions ?? []
  const images: ImageInfo[] = (data as any)?.images ?? []
  const available: boolean = (data as any)?.available ?? false
  const availableModels: string[] = (data as any)?.models ?? []
  const currentModelLabel: string = (data as any)?.active_model ?? ""

  // Reset viewer when model or image list changes
  useEffect(() => { setImageIdx(0) }, [images.length, activeModel])

  const currentImage = images[imageIdx] ?? null
  const currentPreds = currentImage
    ? predictions.filter((p) => p.image === currentImage.name)
    : []

  return (
    <div className="space-y-6">
      {/* Multi-model config */}
      <ModelEditor
        onRun={onRunInference}
        isRunning={isRunning}
        isStopping={isStopping}
        inferenceComplete={inferenceComplete}
        initialModels={initialModels}
      />

      {/* Results */}
      {inferenceComplete && (
        <>
          {isLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm py-4">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading results…
            </div>
          ) : !available ? (
            <p className="text-sm text-muted-foreground">No prediction results found.</p>
          ) : (
            <div className="space-y-6">
              {/* Model selector + summary header */}
              <div>
                <div className="flex items-center gap-3 mb-3 flex-wrap">
                  {availableModels.length > 1 && (
                    <Select value={currentModelLabel} onValueChange={setActiveModel}>
                      <SelectTrigger className="w-48">
                        <SelectValue placeholder="Select model" />
                      </SelectTrigger>
                      <SelectContent>
                        {availableModels.map((m) => (
                          <SelectItem key={m} value={m}>{m}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  {availableModels.length === 1 && (
                    <h3 className="font-medium">{currentModelLabel}</h3>
                  )}
                  <Badge variant="secondary">{predictions.length} detections</Badge>
                  <Badge variant="outline">{images.length} plots</Badge>
                </div>
                <SummaryTable predictions={predictions} />
              </div>

              {/* Image viewer */}
              {images.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-medium">Image Viewer</h3>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => setImageIdx((i) => Math.max(0, i - 1))}
                        disabled={imageIdx === 0}
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </Button>
                      <span className="text-sm text-muted-foreground min-w-24 text-center">
                        {currentImage?.name ?? ""} ({imageIdx + 1} / {images.length})
                      </span>
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => setImageIdx((i) => Math.min(images.length - 1, i + 1))}
                        disabled={imageIdx === images.length - 1}
                      >
                        <ChevronRight className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>

                  {currentImage && (
                    <>
                      <ImageViewer image={currentImage} predictions={currentPreds} />
                      <p className="text-xs text-muted-foreground mt-1">
                        {currentPreds.length === 0
                          ? "No detections in this plot"
                          : `${currentPreds.length} detection${currentPreds.length !== 1 ? "s" : ""} in this plot`}
                      </p>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Close */}
      <div>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Close
        </Button>
      </div>
    </div>
  )
}
