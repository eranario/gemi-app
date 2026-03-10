import { Plus, FolderOpen, MoreVertical, Trash2, RefreshCw } from "lucide-react"
import { useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { WorkspacesService, type WorkspacePublic } from "@/client"
import useCustomToast from "@/hooks/useCustomToast"

export function WorkspaceDashboard() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { showErrorToast } = useCustomToast()
  const [open, setOpen] = useState(false)
  const [newWorkspace, setNewWorkspace] = useState({ name: "", description: "" })

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["workspaces"],
    queryFn: () => WorkspacesService.readAll(),
  })

  const workspaces = data?.data ?? []

  const createMutation = useMutation({
    mutationFn: (body: { name: string; description: string }) =>
      WorkspacesService.create({ requestBody: body }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspaces"] })
      setNewWorkspace({ name: "", description: "" })
      setOpen(false)
    },
    onError: () => showErrorToast("Failed to create workspace"),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => WorkspacesService.delete({ id }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["workspaces"] }),
    onError: () => showErrorToast("Failed to delete workspace"),
  })

  const [confirmDelete, setConfirmDelete] = useState<WorkspacePublic | null>(null)

  const handleCreate = () => {
    if (newWorkspace.name.trim()) {
      createMutation.mutate(newWorkspace)
    }
  }

  return (
    <div className="bg-background min-h-screen">
      <div className="mx-auto max-w-5xl p-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h2 className="text-xl">Process</h2>
            <p className="text-muted-foreground text-sm">
              Create and manage your phenotyping projects
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              onClick={() => refetch()}
              disabled={isFetching}
              title="Refresh workspaces"
            >
              <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            </Button>
            <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                New Workspace
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create New Workspace</DialogTitle>
                <DialogDescription>
                  Create a workspace to organize your phenotyping projects. You
                  can add aerial and ground-based processing pipelines within
                  each workspace.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Workspace Name</Label>
                  <Input
                    id="name"
                    placeholder="e.g., Corn Field Study 2026"
                    value={newWorkspace.name}
                    onChange={(e) =>
                      setNewWorkspace({ ...newWorkspace, name: e.target.value })
                    }
                    onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <Input
                    id="description"
                    placeholder="Brief description of your project"
                    value={newWorkspace.description}
                    onChange={(e) =>
                      setNewWorkspace({ ...newWorkspace, description: e.target.value })
                    }
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={handleCreate}
                  disabled={!newWorkspace.name.trim() || createMutation.isPending}
                >
                  Create Workspace
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          </div>
        </div>

        {isLoading ? (
          <div className="text-muted-foreground text-sm">Loading workspaces…</div>
        ) : workspaces.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center gap-3">
            <FolderOpen className="h-10 w-10 text-muted-foreground" />
            <p className="text-muted-foreground text-sm">
              No workspaces yet. Create one to get started.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {workspaces.map((workspace) => (
              <Card
                key={workspace.id}
                className="hover:border-primary/50 cursor-pointer transition-colors"
                onClick={() =>
                  navigate({
                    to: "/process/$workspaceId",
                    params: { workspaceId: workspace.id },
                  })
                }
              >
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <CardTitle>{workspace.name}</CardTitle>
                      <CardDescription>{workspace.description}</CardDescription>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                        <Button variant="ghost" size="icon" className="flex-shrink-0 h-8 w-8">
                          <MoreVertical className="w-4 h-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                        <DropdownMenuItem
                          className="text-red-600"
                          onClick={() => setConfirmDelete(workspace)}
                        >
                          <Trash2 className="w-4 h-4 mr-2" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-muted-foreground text-sm">
                    Created on: {new Date(workspace.created_at).toLocaleDateString()}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Delete confirmation — rendered outside the conditional so state persists */}
        <Dialog open={!!confirmDelete} onOpenChange={(v) => !v && setConfirmDelete(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete Workspace</DialogTitle>
              <DialogDescription>
                Are you sure you want to delete <strong>{confirmDelete?.name}</strong>?
                This will permanently remove the workspace and all its pipelines and runs.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmDelete(null)}>Cancel</Button>
              <Button
                variant="destructive"
                disabled={deleteMutation.isPending}
                onClick={() => {
                  if (confirmDelete) deleteMutation.mutate(confirmDelete.id, { onSuccess: () => setConfirmDelete(null) })
                }}
              >
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  )
}
