import {
  ArrowLeft,
  Plus,
  Plane,
  Navigation,
  ChevronRight,
  Loader2,
  Play,
  MoreVertical,
  Trash2,
} from "lucide-react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import {
  FilesService,
  PipelinesService,
  ProcessingService,
  type PipelinePublic,
  type PipelineRunPublic,
  type FileUploadPublic,
} from "@/client";
import useCustomToast from "@/hooks/useCustomToast";

// ── Helpers ───────────────────────────────────────────────────────────────────

function statusBadgeClass(status: string) {
  switch (status) {
    case "completed":
      return "bg-green-500/10 text-green-700 hover:bg-green-500/20";
    case "running":
      return "bg-blue-500/10 text-blue-700 hover:bg-blue-500/20";
    case "failed":
      return "bg-red-500/10 text-red-700 hover:bg-red-500/20";
    default:
      return "bg-gray-500/10 text-gray-700 hover:bg-gray-500/20";
  }
}

// ── New Run dialog ────────────────────────────────────────────────────────────

interface NewRunDialogProps {
  pipeline: PipelinePublic;
  workspaceId: string;
  open: boolean;
  onClose: () => void;
}

function NewRunDialog({
  pipeline,
  workspaceId,
  open,
  onClose,
}: NewRunDialogProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { showErrorToast } = useCustomToast();
  const [selectedUploadId, setSelectedUploadId] = useState<string>("");

  const { data: uploadsData, isLoading: uploadsLoading } = useQuery({
    queryKey: ["files"],
    queryFn: () => FilesService.readFiles(),
    enabled: open,
  });

  // Filter to uploads that match the pipeline type
  // Ground pipelines work with ground/Amiga data, aerial with drone data
  const uploads = (uploadsData?.data ?? []).filter((u: FileUploadPublic) =>
    pipeline.type === "ground"
      ? u.data_type === "ground" || u.platform?.toLowerCase().includes("amiga")
      : u.data_type === "aerial" || u.data_type === "drone"
  );

  // If filtering leaves nothing, show all uploads
  const displayUploads =
    uploads.length > 0 ? uploads : (uploadsData?.data ?? []);

  const selectedUpload = displayUploads.find(
    (u: FileUploadPublic) => u.id === selectedUploadId
  );

  const createMutation = useMutation({
    mutationFn: async (upload: FileUploadPublic) => {
      const run = await PipelinesService.createRun({
        pipelineId: pipeline.id,
        requestBody: {
          pipeline_id: pipeline.id,
          date: upload.date,
          experiment: upload.experiment,
          location: upload.location,
          population: upload.population,
          platform: upload.platform ?? "",
          sensor: upload.sensor ?? "",
          file_upload_id: upload.id,
        },
      });
      // Silently try to reuse existing boundaries from a previous run of this pipeline.
      // Ground: reuses plot_borders.csv (plot_marking step)
      // Aerial: reuses Plot-Boundary-WGS84.geojson (plot_boundaries step)
      // If no previous boundaries exist the backend returns 404 — we ignore it.
      try {
        await ProcessingService.applyBoundaries({ id: run.id });
      } catch {
        // no boundaries yet — that's fine
      }
      return run;
    },
    onSuccess: (run: PipelineRunPublic) => {
      queryClient.invalidateQueries({ queryKey: ["runs", pipeline.id] });
      onClose();
      navigate({
        to: "/process/$workspaceId/run/$runId",
        params: { workspaceId, runId: run.id },
      });
    },
    onError: () => showErrorToast("Failed to create run"),
  });

  const handleCreate = () => {
    if (!selectedUpload) return;
    createMutation.mutate(selectedUpload);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Run — {pipeline.name}</DialogTitle>
          <DialogDescription>
            Select the uploaded dataset to process. The run will reuse existing
            plot boundaries if available.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Dataset</Label>
            {uploadsLoading ? (
              <div className="text-muted-foreground flex items-center gap-2 text-sm">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading uploads…
              </div>
            ) : displayUploads.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No uploaded datasets found. Upload data in the Files tab first.
              </p>
            ) : (
              <Select
                value={selectedUploadId}
                onValueChange={setSelectedUploadId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a dataset…" />
                </SelectTrigger>
                <SelectContent>
                  {displayUploads.map((u: FileUploadPublic) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.experiment} / {u.location} / {u.population} — {u.date}
                      {u.platform ? ` (${u.platform})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {selectedUpload && (
            <div className="bg-muted/50 space-y-1 rounded-lg p-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Date:</span>
                <span>{selectedUpload.date}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Platform:</span>
                <span>{selectedUpload.platform ?? "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Sensor:</span>
                <span>{selectedUpload.sensor ?? "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Files:</span>
                <span>{selectedUpload.file_count}</span>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={handleCreate}
            disabled={!selectedUpload || createMutation.isPending}
          >
            {createMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Play className="mr-2 h-4 w-4" />
            )}
            Start Run
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Pipeline card with its runs ───────────────────────────────────────────────

interface PipelineCardProps {
  pipeline: PipelinePublic;
  workspaceId: string;
}

function PipelineCard({ pipeline, workspaceId }: PipelineCardProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { showErrorToast } = useCustomToast();
  const [newRunOpen, setNewRunOpen] = useState(false);
  const [confirmDeletePipeline, setConfirmDeletePipeline] = useState(false);
  const [confirmDeleteRun, setConfirmDeleteRun] =
    useState<PipelineRunPublic | null>(null);

  const { data: runsData, isLoading } = useQuery({
    queryKey: ["runs", pipeline.id],
    queryFn: () => PipelinesService.readRuns({ pipelineId: pipeline.id }),
  });

  const runs = runsData?.data ?? [];

  const deletePipelineMutation = useMutation({
    mutationFn: () => PipelinesService.delete({ id: pipeline.id }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["pipelines", workspaceId] }),
    onError: () => showErrorToast("Failed to delete pipeline"),
  });

  const deleteRunMutation = useMutation({
    mutationFn: (runId: string) => PipelinesService.deleteRun({ id: runId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["runs", pipeline.id] });
      setConfirmDeleteRun(null);
    },
    onError: () => showErrorToast("Failed to delete run"),
  });

  const isAerial = pipeline.type === "aerial";
  const iconCls = isAerial ? "bg-blue-500/10" : "bg-green-500/10";
  const iconColor = isAerial ? "text-blue-600" : "text-green-600";
  const Icon = isAerial ? Plane : Navigation;

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div
                className={`flex h-10 w-10 items-center justify-center rounded-lg ${iconCls}`}
              >
                <Icon className={`h-5 w-5 ${iconColor}`} />
              </div>
              <div>
                <CardTitle className="text-base">{pipeline.name}</CardTitle>
                <CardDescription className="capitalize">
                  {pipeline.type} pipeline
                </CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  navigate({
                    to: "/process/$workspaceId/pipeline",
                    params: { workspaceId },
                    search: {
                      type: pipeline.type as "aerial" | "ground",
                      pipelineId: pipeline.id,
                    },
                  })
                }
              >
                Settings
              </Button>
              <Button size="sm" onClick={() => setNewRunOpen(true)}>
                <Plus className="mr-1 h-4 w-4" />
                New Run
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    className="text-red-600"
                    onClick={() => setConfirmDeletePipeline(true)}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete Pipeline
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </CardHeader>

        {(isLoading || runs.length > 0) && (
          <CardContent>
            {isLoading ? (
              <div className="text-muted-foreground flex items-center gap-2 text-sm">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading runs…
              </div>
            ) : (
              <div className="space-y-2">
                {runs.map((run: PipelineRunPublic) => (
                  <div
                    key={run.id}
                    className="hover:bg-muted/50 flex cursor-pointer items-center justify-between rounded-md p-2 transition-colors"
                    onClick={() =>
                      navigate({
                        to: "/process/$workspaceId/run/$runId",
                        params: { workspaceId, runId: run.id },
                      })
                    }
                  >
                    <div className="flex items-center gap-3">
                      <Badge
                        className={statusBadgeClass(run.status ?? "pending")}
                      >
                        {run.status ?? "pending"}
                      </Badge>
                      <span className="text-sm font-medium">{run.date}</span>
                      <span className="text-muted-foreground text-sm">
                        {run.experiment} / {run.location} / {run.population}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <ChevronRight className="text-muted-foreground h-4 w-4" />
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          asChild
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                          >
                            <MoreVertical className="h-3 w-3" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          align="end"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <DropdownMenuItem
                            className="text-red-600"
                            onClick={() => setConfirmDeleteRun(run)}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Delete Run
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        )}
      </Card>

      <NewRunDialog
        pipeline={pipeline}
        workspaceId={workspaceId}
        open={newRunOpen}
        onClose={() => setNewRunOpen(false)}
      />

      {/* Delete pipeline confirmation */}
      <Dialog
        open={confirmDeletePipeline}
        onOpenChange={(v) => !v && setConfirmDeletePipeline(false)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Pipeline</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete <strong>{pipeline.name}</strong>?
              All runs and output references will be removed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmDeletePipeline(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deletePipelineMutation.isPending}
              onClick={() =>
                deletePipelineMutation.mutate(undefined, {
                  onSuccess: () => setConfirmDeletePipeline(false),
                })
              }
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete run confirmation */}
      <Dialog
        open={!!confirmDeleteRun}
        onOpenChange={(v) => !v && setConfirmDeleteRun(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Run</DialogTitle>
            <DialogDescription>
              Delete the run for <strong>{confirmDeleteRun?.date}</strong>?
              Output file references will be removed from the database.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDeleteRun(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteRunMutation.isPending}
              onClick={() =>
                confirmDeleteRun &&
                deleteRunMutation.mutate(confirmDeleteRun.id)
              }
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function WorkspaceDetail() {
  const navigate = useNavigate();
  const { workspaceId } = useParams({ from: "/_layout/process/$workspaceId/" });

  const { data: workspace } = useQuery({
    queryKey: ["workspaces", workspaceId],
    queryFn: () =>
      import("@/client").then((m) =>
        m.WorkspacesService.readOne({ id: workspaceId })
      ),
  });

  const { data: pipelinesData, isLoading } = useQuery({
    queryKey: ["pipelines", workspaceId],
    queryFn: () => PipelinesService.readAll({ workspaceId }),
  });

  const pipelines = pipelinesData?.data ?? [];

  return (
    <div className="bg-background min-h-screen">
      <div className="mx-auto max-w-5xl p-8">
        <div className="mb-8 flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate({ to: "/process" })}
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-semibold">
              {workspace?.name ?? "Workspace"}
            </h1>
            <p className="text-muted-foreground text-sm">
              {workspace?.description}
            </p>
          </div>
        </div>

        {/* Create new pipeline */}
        <div className="mb-8">
          <h2 className="mb-1 text-lg font-medium">Create New Pipeline</h2>
          <p className="text-muted-foreground mb-4 text-sm">
            Choose the type of sensing data you want to process
          </p>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Card
              className="hover:border-primary cursor-pointer transition-colors"
              onClick={() =>
                navigate({
                  to: "/process/$workspaceId/pipeline",
                  params: { workspaceId },
                  search: { type: "aerial" },
                })
              }
            >
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10">
                    <Plane className="h-5 w-5 text-blue-600" />
                  </div>
                  <div>
                    <CardTitle>Aerial Pipeline</CardTitle>
                    <CardDescription>Process drone imagery</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground text-sm">
                  GCP selection → Orthomosaic → Plot boundaries → Train → Traits
                </p>
              </CardContent>
            </Card>

            <Card
              className="hover:border-primary cursor-pointer transition-colors"
              onClick={() =>
                navigate({
                  to: "/process/$workspaceId/pipeline",
                  params: { workspaceId },
                  search: { type: "ground" },
                })
              }
            >
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-500/10">
                    <Navigation className="h-5 w-5 text-green-600" />
                  </div>
                  <div>
                    <CardTitle>Ground Pipeline</CardTitle>
                    <CardDescription>Process Amiga rover data</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground text-sm">
                  Plot marking → AgRowStitch → Train → Traits
                </p>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Existing pipelines */}
        <div>
          <h2 className="mb-4 text-lg font-medium">Pipelines</h2>
          {isLoading ? (
            <p className="text-muted-foreground text-sm">Loading…</p>
          ) : pipelines.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No pipelines yet. Create one above to get started.
            </p>
          ) : (
            <div className="space-y-3">
              {pipelines.map((pipeline: PipelinePublic) => (
                <PipelineCard
                  key={pipeline.id}
                  pipeline={pipeline}
                  workspaceId={workspaceId}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
