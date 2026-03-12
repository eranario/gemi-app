/**
 * RunTool — full-page interactive tool view.
 *
 * Opened when the user clicks "Open Tool" on an interactive step in RunDetail.
 * Renders the tool at full width with a back button; "Save" navigates back.
 */

import { ArrowLeft } from "lucide-react"
import { useNavigate, useParams, useSearch } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"
import { useQueryClient } from "@tanstack/react-query"

import { PipelinesService, type PipelineRunPublic } from "@/client"
import { Button } from "@/components/ui/button"
import { GcpPicker } from "@/features/process/components/GcpPicker"
import { PlotBoundaryPrep } from "@/features/process/components/PlotBoundaryPrep"
import { InferenceTool, type InferenceRunConfig } from "@/features/process/components/InferenceTool"
import { ProcessingService } from "@/client"
import { useMutation } from "@tanstack/react-query"
import useCustomToast from "@/hooks/useCustomToast"

const STEP_LABELS: Record<string, string> = {
  gcp_selection: "GCP Selection",
  plot_boundary_prep: "Plot Boundary Prep",
  inference: "Inference",
}

const STEP_DESCRIPTIONS: Record<string, string> = {
  gcp_selection: "Select each ground control point in a drone image and mark its pixel location.",
  plot_boundary_prep: "Draw the outer field boundary on the mosaic, then generate a rectangular plot grid from your field design CSV.",
  inference: "Run Roboflow detection or segmentation on plot images and view results.",
}

export function RunTool() {
  const navigate = useNavigate()
  const { workspaceId } = useParams({
    from: "/_layout/process/$workspaceId/tool",
  })
  const { runId, step } = useSearch({
    from: "/_layout/process/$workspaceId/tool",
  })
  const queryClient = useQueryClient()
  const { showErrorToast } = useCustomToast()

  const { data: run } = useQuery<PipelineRunPublic>({
    queryKey: ["pipeline-runs", runId],
    queryFn: () => PipelinesService.readRun({ id: runId }),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  })

  const executeMutation = useMutation({
    mutationFn: (body: { step: string; models?: { label: string; roboflow_api_key: string; roboflow_model_id: string; task_type: string }[] }) =>
      ProcessingService.executeStep({ id: runId, requestBody: body }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["pipeline-runs", runId] }),
    onError: () => showErrorToast("Failed to start step"),
  })

  function goBack() {
    navigate({
      to: "/process/$workspaceId/run/$runId",
      params: { workspaceId, runId: runId as string },
    })
  }

  function onSaved() {
    queryClient.invalidateQueries({ queryKey: ["pipeline-runs", runId] })
    goBack()
  }

  const label = STEP_LABELS[step] ?? step
  const description = STEP_DESCRIPTIONS[step] ?? ""
  const isRunning = run?.status === "running" && run.current_step === step

  return (
    <div className="bg-background min-h-screen">
      <div className="mx-auto max-w-5xl p-8">
        {/* Header */}
        <div className="mb-6 flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={goBack}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-xl font-semibold">{label}</h1>
            {description && (
              <p className="text-muted-foreground text-sm mt-0.5">{description}</p>
            )}
          </div>
        </div>

        {/* Tool content */}
        {step === "gcp_selection" && (
          <GcpPicker
            runId={runId}
            onSaved={onSaved}
            onCancel={goBack}
          />
        )}

        {step === "plot_boundary_prep" && (
          <PlotBoundaryPrep
            runId={runId}
            onSaved={onSaved}
            onCancel={goBack}
          />
        )}

        {step === "inference" && (
          <InferenceTool
            runId={runId}
            inferenceComplete={!!run?.steps_completed?.inference}
            isRunning={isRunning}
            isStopping={false}
            onRunInference={(cfg: InferenceRunConfig) => {
              executeMutation.mutate({ step: "inference", models: cfg.models })
            }}
            onCancel={goBack}
          />
        )}
      </div>
    </div>
  )
}
