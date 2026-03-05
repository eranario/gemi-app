import { ArrowLeft, Plus, Plane, Navigation } from "lucide-react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface Pipeline {
  id: string;
  name: string;
  type: "aerial" | "ground";
  status: "draft" | "processing" | "completed";
  steps: {
    plotBoundary: boolean;
    orthogeneration: boolean;
    inference: boolean;
  };
  createdAt: Date;
}

const samplePipelines: Pipeline[] = [
  {
    id: "1",
    name: "Aerial Survey - North Field",
    type: "aerial",
    status: "completed",
    steps: { plotBoundary: true, orthogeneration: true, inference: true },
    createdAt: new Date("2026-03-02"),
  },
  {
    id: "2",
    name: "Ground Imaging - Plot A1-A10",
    type: "ground",
    status: "processing",
    steps: { plotBoundary: true, orthogeneration: false, inference: false },
    createdAt: new Date("2026-03-03"),
  },
];

const workspaceNames: Record<string, { name: string; description: string }> = {
  "1": {
    name: "Corn Field Study 2026",
    description: "Spring planting season phenotyping",
  },
  "2": {
    name: "Wheat Drought Resistance",
    description: "Monitoring drought stress responses",
  },
};

function getStatusColor(status: string) {
  switch (status) {
    case "completed":
      return "bg-green-500/10 text-green-700 hover:bg-green-500/20";
    case "processing":
      return "bg-blue-500/10 text-blue-700 hover:bg-blue-500/20";
    default:
      return "bg-gray-500/10 text-gray-700 hover:bg-gray-500/20";
  }
}

function getStepsCompleted(steps: Pipeline["steps"]) {
  const completed = Object.values(steps).filter(Boolean).length;
  return `${completed}/3 steps`;
}

export function WorkspaceDetail() {
  const navigate = useNavigate();
  const { workspaceId } = useParams({ from: "/_layout/process/$workspaceId/" });
  const [pipelines] = useState<Pipeline[]>(samplePipelines);

  const workspace = workspaceNames[workspaceId] ?? {
    name: `Workspace ${workspaceId}`,
    description: "",
  };

  return (
    <div className="bg-background min-h-screen">
      <div className="mx-auto max-w-5xl p-8">
        <div className="flex items-center gap-4 mb-8">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate({ to: "/process" })}
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-semibold">{workspace.name}</h1>
            <p className="text-sm text-muted-foreground">
              {workspace.description}
            </p>
          </div>
        </div>

        <div className="mb-8">
          <h2 className="text-xl mb-2">Create New Pipeline</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Choose the type of sensing data you want to process
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card
              className="cursor-pointer hover:border-primary transition-colors"
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
                  <div className="w-10 h-10 bg-blue-500/10 rounded-lg flex items-center justify-center">
                    <Plane className="w-5 h-5 text-blue-600" />
                  </div>
                  <div>
                    <CardTitle>Aerial Pipeline</CardTitle>
                    <CardDescription>
                      Process drone or satellite imagery
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Plus className="w-4 h-4" />
                  <span>Create aerial processing pipeline</span>
                </div>
              </CardContent>
            </Card>

            <Card
              className="cursor-pointer hover:border-primary transition-colors"
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
                  <div className="w-10 h-10 bg-green-500/10 rounded-lg flex items-center justify-center">
                    <Navigation className="w-5 h-5 text-green-600" />
                  </div>
                  <div>
                    <CardTitle>Ground Pipeline</CardTitle>
                    <CardDescription>
                      Process ground-based sensor data
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Plus className="w-4 h-4" />
                  <span>Create ground-based processing pipeline</span>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        <div>
          <h2 className="text-xl mb-4">Active Pipelines</h2>
          <div className="space-y-3">
            {pipelines.map((pipeline) => (
              <Card
                key={pipeline.id}
                className="cursor-pointer hover:border-primary/50 transition-colors"
              >
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                          pipeline.type === "aerial"
                            ? "bg-blue-500/10"
                            : "bg-green-500/10"
                        }`}
                      >
                        {pipeline.type === "aerial" ? (
                          <Plane className="w-5 h-5 text-blue-600" />
                        ) : (
                          <Navigation className="w-5 h-5 text-green-600" />
                        )}
                      </div>
                      <div>
                        <CardTitle className="text-base">
                          {pipeline.name}
                        </CardTitle>
                        <CardDescription className="text-sm">
                          {getStepsCompleted(pipeline.steps)} completed
                        </CardDescription>
                      </div>
                    </div>
                    <Badge className={getStatusColor(pipeline.status)}>
                      {pipeline.status}
                    </Badge>
                  </div>
                </CardHeader>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
