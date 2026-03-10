import {
  ArrowLeft,
  Check,
  Clock,
  AlertCircle,
  Loader2,
  Lock,
  ChevronDown,
  ChevronRight,
  FileText,
  Square,
  Download,
  Eye,
} from "lucide-react"
import { useNavigate, useParams } from "@tanstack/react-router"
import { useCallback, useEffect, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  ProcessingService,
  PipelinesService,
  SettingsService,
  UtilsService,
  type PipelineRunPublic,
  type PipelinePublic,
} from "@/client"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import useCustomToast from "@/hooks/useCustomToast"

// Resolve a relative /api path to an absolute URL using the backend base
// injected by the Tauri sidecar, or fall back to a same-origin relative path.
function apiUrl(path: string): string {
  const base = (window as any).__GEMI_BACKEND_URL__ ?? ""
  return base ? `${base}${path}` : path
}
import { PlotMarker } from "@/features/process/components/PlotMarker"
import { GcpPicker } from "@/features/process/components/GcpPicker"
import { BoundaryDrawer } from "@/features/process/components/BoundaryDrawer"
import { InferenceTool, type InferenceRunConfig } from "@/features/process/components/InferenceTool"

// ── Step definitions ──────────────────────────────────────────────────────────

type StepKind = "interactive" | "compute" | "optional"

interface StepDef {
  key: string
  label: string
  description: string
  kind: StepKind
}

const GROUND_STEPS: StepDef[] = [
  {
    key: "plot_marking",
    label: "Plot Marking",
    description: "Select start/end images for each plot in the image sequence",
    kind: "interactive",
  },
  {
    key: "stitching",
    label: "Stitching",
    description: "AgRowStitch stitches images per plot into panoramic mosaics",
    kind: "compute",
  },
  {
    key: "georeferencing",
    label: "Georeferencing",
    description: "GPS-based georeferencing of stitched plots and combined mosaic",
    kind: "compute",
  },
  {
    key: "plot_boundaries",
    label: "Plot Boundaries",
    description: "Review and adjust georeferenced plot footprints overlaid on the combined mosaic",
    kind: "interactive",
  },
  {
    key: "inference",
    label: "Inference",
    description: "Roboflow detection/segmentation on plot images",
    kind: "interactive",
  },
]

const AERIAL_STEPS: StepDef[] = [
  {
    key: "data_sync",
    label: "Data Sync",
    description: "Extract GPS from image EXIF and sync with platform log for accurate positioning",
    kind: "compute",
  },
  {
    key: "gcp_selection",
    label: "GCP Selection",
    description: "Match drone images to ground control points, mark GCP pixels",
    kind: "interactive",
  },
  {
    key: "orthomosaic",
    label: "Orthomosaic Generation",
    description: "Run OpenDroneMap to create orthomosaic and DEM",
    kind: "compute",
  },
  {
    key: "plot_boundaries",
    label: "Plot Boundaries",
    description: "Draw plot polygons on the orthomosaic map",
    kind: "interactive",
  },
  {
    key: "trait_extraction",
    label: "Trait Extraction",
    description: "Extract vegetation fraction, height, and temperature per plot",
    kind: "compute",
  },
  {
    key: "inference",
    label: "Inference",
    description: "Roboflow detection/segmentation on split plot images",
    kind: "interactive",
  },
]

// ── SSE progress hook ─────────────────────────────────────────────────────────

interface ProgressEvent {
  event: string
  step?: string
  message?: string
  index?: number
  total?: number
  progress?: number
  outputs?: Record<string, string>
}

function useStepProgress(runId: string, isRunning: boolean) {
  const [events, setEvents] = useState<ProgressEvent[]>([])
  const [lastProgress, setLastProgress] = useState<number | null>(null)
  const esRef = useRef<EventSource | null>(null)
  const offsetRef = useRef(0)
  const queryClient = useQueryClient()

  const connect = useCallback(() => {
    if (esRef.current) esRef.current.close()

    const url = apiUrl(`/api/v1/pipeline-runs/${runId}/progress?offset=${offsetRef.current}`)
    const es = new EventSource(url)
    esRef.current = es

    es.onmessage = (e) => {
      try {
        const evt: ProgressEvent = JSON.parse(e.data)
        offsetRef.current += 1
        setEvents((prev) => [...prev, evt])

        if (typeof evt.progress === "number") setLastProgress(evt.progress)

        // Refresh run state from DB when step completes or fails
        if (evt.event === "complete" || evt.event === "error" || evt.event === "cancelled") {
          queryClient.invalidateQueries({ queryKey: ["pipeline-runs", runId] })
          es.close()
          esRef.current = null
        }
      } catch {
        // ignore parse errors
      }
    }

    es.onerror = () => {
      es.close()
      esRef.current = null
    }
  }, [runId, queryClient])

  useEffect(() => {
    if (isRunning) {
      connect()
    } else {
      esRef.current?.close()
      esRef.current = null
    }
    return () => {
      esRef.current?.close()
      esRef.current = null
    }
  }, [isRunning, connect])

  const clearEvents = () => {
    setEvents([])
    setLastProgress(null)
    offsetRef.current = 0
  }

  return { events, lastProgress, clearEvents }
}

// ── Step status helpers ───────────────────────────────────────────────────────

type StepStatus = "completed" | "running" | "failed" | "ready" | "locked"

function getStepStatus(
  stepKey: string,
  currentStep: string | null | undefined,
  stepsCompleted: Record<string, boolean> | null | undefined,
  runStatus: string,
): StepStatus {
  if (stepsCompleted?.[stepKey]) return "completed"
  if (currentStep === stepKey) {
    return runStatus === "failed" ? "failed" : "running"
  }
  return "locked"
}

function getNextStep(
  steps: StepDef[],
  stepsCompleted: Record<string, boolean> | null | undefined,
  runStatus: string,
): string | null {
  if (runStatus === "running" || runStatus === "failed") return null
  for (const step of steps) {
    if (!stepsCompleted?.[step.key]) return step.key
  }
  return null
}

// ── Progress log ──────────────────────────────────────────────────────────────

function ProgressLog({ events }: { events: ProgressEvent[] }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: "smooth" })
  }, [events])

  if (events.length === 0) return null

  return (
    <div
      ref={ref}
      className="mt-3 max-h-36 overflow-y-auto rounded-md bg-muted/60 p-3 space-y-0.5 text-xs font-mono"
    >
      {events.map((e, i) => (
        <div
          key={i}
          className={
            e.event === "error"
              ? "text-red-600"
              : e.event === "complete"
                ? "text-green-600"
                : "text-muted-foreground"
          }
        >
          [{e.event}] {e.message ?? e.step ?? JSON.stringify(e)}
        </div>
      ))}
    </div>
  )
}

// ── Step row ──────────────────────────────────────────────────────────────────

interface StepRowProps {
  step: StepDef
  status: StepStatus
  isNext: boolean
  isLast: boolean
  runId: string
  runStatus: string
  progressEvents: ProgressEvent[]
  lastProgress: number | null
  onRunStep: (step: string) => void
  onOpenTool: (step: string) => void
  onStopStep: () => void
  isExecuting: boolean
  isStopping: boolean
  isToolOpen: boolean
}

function StepRow({
  step,
  status,
  isNext,
  isLast,
  progressEvents,
  lastProgress,
  onRunStep,
  onOpenTool,
  onStopStep,
  isExecuting,
  isStopping,
  isToolOpen,
}: StepRowProps) {
  const [expanded, setExpanded] = useState(false)

  // Only show progress events relevant to this step
  const stepEvents = progressEvents.filter(
    (e) => !e.step || e.step === step.key,
  )

  const iconEl = (() => {
    switch (status) {
      case "completed": return <Check className="w-5 h-5 text-green-600" />
      case "running":   return <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
      case "failed":    return <AlertCircle className="w-5 h-5 text-red-600" />
      case "ready":     return <Clock className="w-5 h-5 text-primary" />
      default:          return <Lock className="w-5 h-5 text-muted-foreground" />
    }
  })()

  const circleCls = {
    completed: "border-green-500 bg-green-500/10",
    running:   "border-blue-500 bg-blue-500/10",
    failed:    "border-red-500 bg-red-500/10",
    ready:     "border-primary bg-primary/10",
    locked:    "border-border bg-muted/30",
  }[status]

  const isActive = status === "running"
  const canRun = (status === "ready" || status === "completed" || status === "failed") && !isExecuting
  const isInteractive = step.kind === "interactive"

  const actionLabel = (() => {
    if (isActive) return isStopping ? "Stopping…" : "Running…"
    if (isInteractive && isToolOpen) return "Close"
    if (status === "completed") return isInteractive ? "Re-open Tool" : "Re-run"
    if (isInteractive) return "Open Tool"
    return "Run Step"
  })()

  return (
    <div className="relative">
      {!isLast && (
        <div className="absolute left-[23px] top-[52px] bottom-0 w-0.5 bg-border" />
      )}
      <div className="flex gap-4">
        <div
          className={`relative z-10 w-12 h-12 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${circleCls}`}
        >
          {iconEl}
        </div>

        <div className="flex-1 pb-6">
          <div className="flex items-start justify-between gap-2 pt-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`font-medium ${status === "locked" ? "text-muted-foreground" : ""}`}>
                {step.label}
              </span>
              {step.kind !== "compute" && (
                <Badge variant="outline" className="text-xs">
                  {step.kind}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {isActive && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onStopStep}
                  disabled={isStopping}
                >
                  <Square className="w-3 h-3 mr-1" />
                  Stop
                </Button>
              )}
              <Button
                variant={status === "completed" ? "outline" : "default"}
                size="sm"
                disabled={status === "locked" || isActive || (isExecuting && !isActive)}
                onClick={() => {
                  if (isInteractive) onOpenTool(step.key)
                  else if (canRun) onRunStep(step.key)
                }}
              >
                {isActive && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
                {actionLabel}
              </Button>
              {status === "completed" && (
                <Button variant="ghost" size="icon" onClick={() => setExpanded(!expanded)}>
                  {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                </Button>
              )}
            </div>
          </div>

          <p className={`text-sm mt-0.5 ${status === "locked" ? "text-muted-foreground/60" : "text-muted-foreground"}`}>
            {step.description}
          </p>

          {isNext && status !== "completed" && !isActive && (
            <p className="text-xs text-primary mt-1">Ready to start</p>
          )}

          {/* Live progress for running step */}
          {isActive && (
            <div className="mt-2">
              {lastProgress !== null && (
                <Progress value={lastProgress} className="h-1.5 mb-1" />
              )}
              <ProgressLog events={stepEvents} />
            </div>
          )}

          {/* Completed step log (collapsible) */}
          {expanded && status === "completed" && stepEvents.length > 0 && (
            <ProgressLog events={stepEvents} />
          )}
        </div>
      </div>
    </div>
  )
}

// ── Outputs table ─────────────────────────────────────────────────────────────

const VIEWABLE_EXTS = new Set([".jpg", ".jpeg", ".png", ".tif", ".tiff", ".webp"])
const DOWNLOADABLE_EXTS = new Set([".jpg", ".jpeg", ".png", ".tif", ".tiff", ".webp", ".geojson", ".csv", ".zip"])

function isViewable(path: string) {
  const ext = path.slice(path.lastIndexOf(".")).toLowerCase()
  return VIEWABLE_EXTS.has(ext)
}

function isDownloadable(path: string) {
  const ext = path.slice(path.lastIndexOf(".")).toLowerCase()
  return DOWNLOADABLE_EXTS.has(ext)
}

function OutputsTable({ outputs, dataRoot }: { outputs: Record<string, unknown> | null | undefined; dataRoot?: string }) {
  if (!outputs || Object.keys(outputs).length === 0) {
    return (
      <div className="flex flex-col items-center py-8 gap-2 text-muted-foreground">
        <FileText className="w-8 h-8" />
        <p className="text-sm">No outputs yet. Run steps above to generate files.</p>
      </div>
    )
  }

  const rows: { key: string; value: string }[] = Object.entries(outputs)
    .filter(([, v]) => typeof v === "string")
    .map(([k, v]) => ({ key: k, value: String(v) }))

  // Resolve relative path to absolute using data_root
  function absPath(relPath: string) {
    if (!dataRoot || relPath.startsWith("/")) return relPath
    return `${dataRoot}/${relPath}`
  }

  function handleView(relPath: string) {
    const abs = absPath(relPath)
    const url = apiUrl(`/api/v1/files/serve?path=${encodeURIComponent(abs)}`)
    window.open(url, "_blank")
  }

  function handleDownload(relPath: string) {
    const abs = absPath(relPath)
    const url = apiUrl(`/api/v1/files/serve?path=${encodeURIComponent(abs)}`)
    const a = document.createElement("a")
    a.href = url
    a.download = relPath.split("/").pop() ?? relPath
    a.click()
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Step</TableHead>
          <TableHead>File</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.key}>
            <TableCell className="text-sm capitalize whitespace-nowrap">
              {row.key.replace(/_/g, " ")}
            </TableCell>
            <TableCell className="text-sm font-mono text-muted-foreground break-all">
              {row.value.split("/").pop()}
            </TableCell>
            <TableCell className="text-right whitespace-nowrap">
              {isViewable(row.value) && (
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleView(row.value)}>
                  <Eye className="w-3.5 h-3.5" />
                </Button>
              )}
              {isDownloadable(row.value) && (
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleDownload(row.value)}>
                  <Download className="w-3.5 h-3.5" />
                </Button>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

// ── Status badge ──────────────────────────────────────────────────────────────

function RunStatusBadge({ status }: { status: string }) {
  const cls: Record<string, string> = {
    pending:   "bg-gray-500/10 text-gray-700",
    running:   "bg-blue-500/10 text-blue-700",
    completed: "bg-green-500/10 text-green-700",
    failed:    "bg-red-500/10 text-red-700",
  }
  return <Badge className={cls[status] ?? cls.pending}>{status}</Badge>
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function RunDetail() {
  const navigate = useNavigate()
  const { workspaceId, runId } = useParams({
    from: "/_layout/process/$workspaceId/run/$runId",
  })
  const { showErrorToast } = useCustomToast()
  const queryClient = useQueryClient()

  const { data: run, isLoading: runLoading } = useQuery<PipelineRunPublic>({
    queryKey: ["pipeline-runs", runId],
    queryFn: () => PipelinesService.readRun({ id: runId }),
    // Poll every 3s while running so status stays fresh even without SSE
    refetchInterval: (query) =>
      query.state.data?.status === "running" ? 3000 : false,
  })

  const { data: pipeline } = useQuery<PipelinePublic>({
    queryKey: ["pipelines", run?.pipeline_id],
    queryFn: () => PipelinesService.readOne({ id: run!.pipeline_id }),
    enabled: !!run,
  })

  const { data: settingsData } = useQuery({
    queryKey: ["settings", "data-root"],
    queryFn: () => SettingsService.readDataRoot(),
    staleTime: Infinity,
  })
  const dataRoot = settingsData?.value

  const runStatus = run?.status ?? "pending"
  const isRunning = runStatus === "running"
  const pipelineType = pipeline?.type ?? "ground"
  const steps = pipelineType === "aerial" ? AERIAL_STEPS : GROUND_STEPS
  const nextStepKey = getNextStep(steps, run?.steps_completed, runStatus)

  // Inline interactive tool state
  const [openTool, setOpenTool] = useState<string | null>(null)

  // SSE progress — only connect when a step is actively running
  const { events: progressEvents, lastProgress, clearEvents } = useStepProgress(runId, isRunning)

  // Execute step mutation — accepts a full request body so inference can pass API key/model
  const executeMutation = useMutation({
    mutationFn: (body: { step: string; models?: { label: string; roboflow_api_key: string; roboflow_model_id: string; task_type: string }[] }) =>
      ProcessingService.executeStep({
        id: runId,
        requestBody: body,
      }),
    onMutate: () => clearEvents(),
    onSuccess: () => {
      // Immediately refresh run to get status="running"
      queryClient.invalidateQueries({ queryKey: ["pipeline-runs", runId] })
    },
    onError: () => showErrorToast("Failed to start step"),
  })

  // Stop mutation
  const stopMutation = useMutation({
    mutationFn: () => ProcessingService.stopStep({ id: runId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["pipeline-runs", runId] }),
    onError: () => showErrorToast("Failed to stop step"),
  })

  // Docker check dialog (shown when user tries to run orthomosaic without Docker)
  const [showDockerDialog, setShowDockerDialog] = useState(false)

  // Guarded step runner — checks Docker availability before starting orthomosaic
  async function handleRunStep(step: string) {
    if (step === "orthomosaic") {
      try {
        const result = await UtilsService.dockerCheck()
        if (!result.available) {
          setShowDockerDialog(true)
          return
        }
      } catch {
        // If the check itself fails, let the step run and surface the error via SSE
      }
    }
    executeMutation.mutate({ step })
  }

  // Use uploaded orthomosaic (aerial: skip ODM)
  const [isRegisteringOrtho, setIsRegisteringOrtho] = useState(false)

  async function handleUseUploadedOrtho() {
    setIsRegisteringOrtho(true)
    try {
      const res = await fetch(apiUrl(`/api/v1/pipeline-runs/${runId}/use-uploaded-ortho`), {
        method: "POST",
        headers: { Authorization: `Bearer ${localStorage.getItem("access_token") || ""}` },
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Failed to register orthomosaic" }))
        showErrorToast(err.detail ?? "Failed to register orthomosaic")
        return
      }
      queryClient.invalidateQueries({ queryKey: ["pipeline-runs", runId] })
    } catch {
      showErrorToast("Failed to register orthomosaic")
    } finally {
      setIsRegisteringOrtho(false)
    }
  }

  // Download crops
  const [isDownloading, setIsDownloading] = useState(false)
  const hasCrops = !!(run?.outputs?.stitching || run?.outputs?.cropped_images || run?.outputs?.traits)

  async function handleDownloadCrops() {
    setIsDownloading(true)
    try {
      const res = await fetch(apiUrl(`/api/v1/pipeline-runs/${runId}/download-crops`), { method: "POST" })
      if (!res.ok) throw new Error(`Server returned ${res.status}`)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      const cd = res.headers.get("content-disposition") ?? ""
      const match = cd.match(/filename="([^"]+)"/)
      a.download = match?.[1] ?? "crops.zip"
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      showErrorToast("Download failed")
    } finally {
      setIsDownloading(false)
    }
  }

  if (runLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!run) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-muted-foreground">Run not found.</p>
      </div>
    )
  }

  return (
    <div className="bg-background min-h-screen">
      <div className="mx-auto max-w-4xl p-8">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate({ to: "/process/$workspaceId", params: { workspaceId } })}
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-semibold">
                {pipeline?.name ?? "Pipeline"} — {run.date}
              </h1>
              <RunStatusBadge status={runStatus} />
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">
              {run.experiment} / {run.location} / {run.population} · {run.platform} · {run.sensor}
            </p>
          </div>
        </div>

        {/* Error banner */}
        {runStatus === "failed" && run.error && (
          <div className="mb-6 p-4 rounded-lg bg-red-500/10 border border-red-200 text-red-700 text-sm">
            <strong>Error:</strong> {run.error}
          </div>
        )}

        {/* Step stepper */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Processing Steps</CardTitle>
            <CardDescription>
              {pipelineType === "aerial" ? "Aerial" : "Ground"} pipeline · {steps.length} steps
            </CardDescription>
          </CardHeader>
          <CardContent>
            {steps.map((step, idx) => {
              const status = getStepStatus(step.key, run.current_step, run.steps_completed, runStatus)
              const isNext = nextStepKey === step.key
              const effectiveStatus: StepStatus =
                isNext && status === "locked" ? "ready" : status

              return (
                <StepRow
                  key={step.key}
                  step={step}
                  status={effectiveStatus}
                  isNext={isNext}
                  isLast={idx === steps.length - 1}
                  runId={runId}
                  runStatus={runStatus}
                  progressEvents={progressEvents}
                  lastProgress={run.current_step === step.key ? lastProgress : null}
                  onRunStep={handleRunStep}
                  onOpenTool={(s) => setOpenTool(openTool === s ? null : s)}
                  onStopStep={() => stopMutation.mutate()}
                  isExecuting={executeMutation.isPending || isRunning}
                  isStopping={stopMutation.isPending}
                  isToolOpen={openTool === step.key}
                />
              )
            })}
          </CardContent>
        </Card>

        {/* Aerial: use uploaded orthomosaic instead of running ODM */}
        {pipelineType === "aerial" && !run.steps_completed?.orthomosaic && (
          <div className="mb-6 p-4 rounded-lg border border-dashed flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Skip ODM — Use Uploaded Orthomosaic</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                If you already have a GeoTIFF orthomosaic, upload it via Files → Orthomosaic
                (same experiment/location/population/date/platform/sensor), then click here to
                register it and skip the ODM generation step.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="flex-shrink-0"
              disabled={isRegisteringOrtho || isRunning}
              onClick={handleUseUploadedOrtho}
            >
              {isRegisteringOrtho && <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />}
              {isRegisteringOrtho ? "Registering…" : "Use Uploaded Orthomosaic"}
            </Button>
          </div>
        )}

        {/* Inline interactive tools */}
        {openTool === "plot_marking" && (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Plot Marker</CardTitle>
              <CardDescription>
                Navigate through images and mark the start and end frame for each plot row.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <PlotMarker
                runId={runId}
                onSaved={() => {
                  setOpenTool(null)
                  queryClient.invalidateQueries({ queryKey: ["pipeline-runs", runId] })
                }}
                onCancel={() => setOpenTool(null)}
              />
            </CardContent>
          </Card>
        )}

        {openTool === "gcp_selection" && (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>GCP Picker</CardTitle>
              <CardDescription>
                Select each ground control point in a drone image and mark its pixel location.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <GcpPicker
                runId={runId}
                onSaved={() => {
                  setOpenTool(null)
                  queryClient.invalidateQueries({ queryKey: ["pipeline-runs", runId] })
                }}
                onCancel={() => setOpenTool(null)}
              />
            </CardContent>
          </Card>
        )}

        {openTool === "plot_boundaries" && (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Plot Boundaries</CardTitle>
              <CardDescription>
                {pipelineType === "ground"
                  ? "Review and adjust georeferenced plot footprints overlaid on the combined mosaic. Existing boundaries from georeferencing are pre-loaded."
                  : "Draw plot polygons on the orthomosaic to define field boundaries."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <BoundaryDrawer
                runId={runId}
                onSaved={() => {
                  setOpenTool(null)
                  queryClient.invalidateQueries({ queryKey: ["pipeline-runs", runId] })
                }}
                onCancel={() => setOpenTool(null)}
              />
            </CardContent>
          </Card>
        )}

        {openTool === "inference" && (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Inference</CardTitle>
              <CardDescription>
                Run Roboflow detection or segmentation on plot images and view results.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <InferenceTool
                runId={runId}
                inferenceComplete={!!run.steps_completed?.inference}
                isRunning={isRunning && run.current_step === "inference"}
                isStopping={stopMutation.isPending}
                onRunInference={(cfg: InferenceRunConfig) => {
                  executeMutation.mutate({
                    step: "inference",
                    models: cfg.models,
                  })
                }}
                onCancel={() => setOpenTool(null)}
              />
            </CardContent>
          </Card>
        )}

        {/* Outputs table */}
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle>Output Files</CardTitle>
                <CardDescription>
                  Files generated by this run, stored as paths relative to your data root.
                </CardDescription>
              </div>
              {hasCrops && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDownloadCrops}
                  disabled={isDownloading}
                >
                  {isDownloading
                    ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    : <Download className="w-4 h-4 mr-2" />}
                  Download Crops
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <OutputsTable outputs={run.outputs} dataRoot={dataRoot} />
          </CardContent>
        </Card>
      </div>

      {/* Docker missing dialog */}
      <Dialog open={showDockerDialog} onOpenChange={setShowDockerDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Docker Required</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-3 text-sm text-muted-foreground">
                <p>
                  Orthomosaic generation uses{" "}
                  <strong className="text-foreground">OpenDroneMap (ODM)</strong>, which requires
                  Docker to be installed on your machine.
                </p>
                <p>
                  Docker was not found. Download and install Docker Desktop, then restart GEMI.
                  The ODM image (~4 GB) will download automatically the first time you run this
                  step — no extra setup needed.
                </p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setShowDockerDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                window.open("https://www.docker.com/products/docker-desktop/", "_blank")
              }}
            >
              Download Docker Desktop
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
