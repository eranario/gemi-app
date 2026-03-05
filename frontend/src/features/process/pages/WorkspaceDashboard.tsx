import { Plus } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Workspace {
  id: string;
  name: string;
  description: string;
  createdAt: Date;
  processingCount: number;
}

const sampleWorkspaces: Workspace[] = [
  {
    id: "1",
    name: "Corn Field Study 2026",
    description: "Spring planting season phenotyping",
    createdAt: new Date("2026-03-01"),
    processingCount: 3,
  },
  {
    id: "2",
    name: "Wheat Drought Resistance",
    description: "Monitoring drought stress responses",
    createdAt: new Date("2026-02-15"),
    processingCount: 5,
  },
];

export function WorkspaceDashboard() {
  const navigate = useNavigate();
  const [workspaces, setWorkspaces] = useState<Workspace[]>(sampleWorkspaces);
  const [open, setOpen] = useState(false);
  const [newWorkspace, setNewWorkspace] = useState({
    name: "",
    description: "",
  });

  const handleCreateWorkspace = () => {
    if (newWorkspace.name) {
      const workspace: Workspace = {
        id: Date.now().toString(),
        name: newWorkspace.name,
        description: newWorkspace.description,
        createdAt: new Date(),
        processingCount: 0,
      };
      setWorkspaces([...workspaces, workspace]);
      setNewWorkspace({ name: "", description: "" });
      setOpen(false);
    }
  };

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
                      setNewWorkspace({
                        ...newWorkspace,
                        name: e.target.value,
                      })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <Input
                    id="description"
                    placeholder="Brief description of your project"
                    value={newWorkspace.description}
                    onChange={(e) =>
                      setNewWorkspace({
                        ...newWorkspace,
                        description: e.target.value,
                      })
                    }
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleCreateWorkspace}>
                  Create Workspace
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

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
                <CardTitle>{workspace.name}</CardTitle>
                <CardDescription>{workspace.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-muted-foreground flex items-center justify-between text-sm">
                  <span>{workspace.processingCount} processing pipelines</span>
                  <span>{workspace.createdAt.toLocaleDateString()}</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
