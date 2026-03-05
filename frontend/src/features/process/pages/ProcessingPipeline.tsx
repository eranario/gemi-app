import {
  ArrowLeft,
  Check,
  Upload,
  Map,
  Brain,
  Settings,
  ChevronRight,
} from "lucide-react";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";

type Step = 1 | 2 | 3;

export function ProcessingPipeline() {
  const navigate = useNavigate();
  const { workspaceId } = useParams({
    from: "/_layout/process/$workspaceId/pipeline",
  });
  const { type } = useSearch({
    from: "/_layout/process/$workspaceId/pipeline",
  });

  const pipelineType = type === "ground" ? "ground" : "aerial";

  const [currentStep, setCurrentStep] = useState<Step>(1);
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());

  // Step 1: Plot Boundary
  const [pipelineName, setPipelineName] = useState("");
  const [boundarySource, setBoundarySource] = useState("");

  // Step 2: Orthogeneration / Alignment
  const [stitchingMethod, setStitchingMethod] = useState("");
  const [resolution, setResolution] = useState("");

  // Step 3: Inference
  const [modelType, setModelType] = useState("");
  const [outputFormat, setOutputFormat] = useState("");

  const steps = [
    {
      number: 1,
      title: "Plot Boundary Prep",
      description: "Define or import plot boundaries",
      icon: Map,
    },
    {
      number: 2,
      title: pipelineType === "aerial" ? "Orthogeneration" : "Data Alignment",
      description:
        pipelineType === "aerial"
          ? "Generate orthomosaic"
          : "Align sensor data",
      icon: Settings,
    },
    {
      number: 3,
      title: "Inference",
      description: "Run phenotyping analysis",
      icon: Brain,
    },
  ];

  const handleNext = () => {
    setCompletedSteps(new Set([...completedSteps, currentStep]));
    if (currentStep < 3) {
      setCurrentStep((currentStep + 1) as Step);
    }
  };

  const handlePrevious = () => {
    if (currentStep > 1) {
      setCurrentStep((currentStep - 1) as Step);
    }
  };

  const isStepComplete = (step: number) => {
    if (step === 1) return !!pipelineName && !!boundarySource;
    if (step === 2)
      return pipelineType === "ground" || (!!stitchingMethod && !!resolution);
    if (step === 3) return !!modelType && !!outputFormat;
    return false;
  };

  const canProceed = isStepComplete(currentStep);

  return (
    <div className="bg-background min-h-screen">
      <div className="mx-auto max-w-5xl p-8">
        <div className="flex items-center gap-4 mb-8">
          <Button
            variant="ghost"
            size="icon"
            onClick={() =>
              navigate({
                to: "/process/$workspaceId",
                params: { workspaceId },
              })
            }
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-semibold">
              {pipelineType === "aerial" ? "Aerial" : "Ground"} Processing
              Pipeline
            </h1>
            <p className="text-sm text-muted-foreground">
              Follow the steps to process your {pipelineType} sensing data
            </p>
          </div>
        </div>

        {/* Progress Steps */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            {steps.map((step, index) => (
              <div key={step.number} className="flex items-center flex-1">
                <div className="flex flex-col items-center flex-1">
                  <div
                    className={`w-12 h-12 rounded-full flex items-center justify-center border-2 transition-colors ${
                      completedSteps.has(step.number)
                        ? "bg-primary border-primary text-primary-foreground"
                        : currentStep === step.number
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border bg-background text-muted-foreground"
                    }`}
                  >
                    {completedSteps.has(step.number) ? (
                      <Check className="w-6 h-6" />
                    ) : (
                      <step.icon className="w-6 h-6" />
                    )}
                  </div>
                  <div className="mt-2 text-center">
                    <p
                      className={`font-medium text-sm ${
                        currentStep === step.number
                          ? "text-foreground"
                          : "text-muted-foreground"
                      }`}
                    >
                      {step.title}
                    </p>
                    <p className="text-xs text-muted-foreground hidden md:block">
                      {step.description}
                    </p>
                  </div>
                </div>
                {index < steps.length - 1 && (
                  <div
                    className={`h-0.5 flex-1 mx-4 transition-colors ${
                      completedSteps.has(step.number)
                        ? "bg-primary"
                        : "bg-border"
                    }`}
                  />
                )}
              </div>
            ))}
          </div>
          <Progress value={(currentStep / 3) * 100} className="h-2" />
        </div>

        {/* Step Content */}
        <Card>
          <CardHeader>
            <CardTitle>
              Step {currentStep}: {steps[currentStep - 1].title}
            </CardTitle>
            <CardDescription>
              {steps[currentStep - 1].description}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {currentStep === 1 && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="pipeline-name">Pipeline Name</Label>
                  <Input
                    id="pipeline-name"
                    placeholder="e.g., North Field Spring Survey"
                    value={pipelineName}
                    onChange={(e) => setPipelineName(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Boundary Source</Label>
                  <Select
                    value={boundarySource}
                    onValueChange={setBoundarySource}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select boundary source" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="create">
                        Create new boundaries
                      </SelectItem>
                      <SelectItem value="upload">Upload Shapefile</SelectItem>
                      <SelectItem value="gps">
                        Import GPS Coordinates
                      </SelectItem>
                      <SelectItem value="auto">
                        Auto-detect from imagery
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {boundarySource === "upload" && (
                  <div className="border-2 border-dashed rounded-lg p-8">
                    <div className="flex flex-col items-center justify-center gap-2 text-center">
                      <Upload className="w-8 h-8 text-muted-foreground" />
                      <div>
                        <p className="font-medium">Upload Shapefile</p>
                        <p className="text-sm text-muted-foreground">
                          Drop your .shp, .shx, and .dbf files here
                        </p>
                      </div>
                      <Button variant="outline" size="sm" className="mt-2">
                        Browse Files
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}

            {currentStep === 2 && (
              <>
                {pipelineType === "aerial" ? (
                  <>
                    <div className="space-y-2">
                      <Label>Stitching Method</Label>
                      <Select
                        value={stitchingMethod}
                        onValueChange={setStitchingMethod}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select stitching algorithm" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="sfm">
                            Structure from Motion (SfM)
                          </SelectItem>
                          <SelectItem value="direct">
                            Direct Linear Transformation
                          </SelectItem>
                          <SelectItem value="feature">
                            Feature-based Matching
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>Output Resolution</Label>
                      <Select
                        value={resolution}
                        onValueChange={setResolution}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select resolution" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="1cm">
                            1 cm/pixel (High)
                          </SelectItem>
                          <SelectItem value="2cm">
                            2 cm/pixel (Medium)
                          </SelectItem>
                          <SelectItem value="5cm">
                            5 cm/pixel (Low)
                          </SelectItem>
                          <SelectItem value="auto">
                            Auto-detect optimal
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="p-4 bg-blue-500/5 border border-blue-500/20 rounded-lg">
                      <p className="text-sm text-blue-900">
                        <strong>Tip:</strong> Higher resolution provides more
                        detail but requires more processing time and storage.
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="space-y-2">
                      <Label>Alignment Method</Label>
                      <Select
                        value={stitchingMethod}
                        onValueChange={setStitchingMethod}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select alignment method" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="timestamp">
                            Timestamp-based
                          </SelectItem>
                          <SelectItem value="gps">GPS Coordinates</SelectItem>
                          <SelectItem value="marker">
                            Reference Markers
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>Data Interpolation</Label>
                      <Select
                        value={resolution}
                        onValueChange={setResolution}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select interpolation" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="linear">Linear</SelectItem>
                          <SelectItem value="cubic">Cubic Spline</SelectItem>
                          <SelectItem value="none">None</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </>
                )}
              </>
            )}

            {currentStep === 3 && (
              <>
                <div className="space-y-2">
                  <Label>Analysis Model</Label>
                  <Select value={modelType} onValueChange={setModelType}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select analysis model" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ndvi">
                        <div className="flex items-center gap-2">
                          <span>NDVI (Vegetation Index)</span>
                          <Badge variant="secondary" className="text-xs">
                            Popular
                          </Badge>
                        </div>
                      </SelectItem>
                      <SelectItem value="plant-count">
                        Plant Counting
                      </SelectItem>
                      <SelectItem value="height">
                        Height Measurement
                      </SelectItem>
                      <SelectItem value="disease">
                        Disease Detection
                      </SelectItem>
                      <SelectItem value="yield">Yield Prediction</SelectItem>
                      <SelectItem value="custom">Custom Model</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Output Format</Label>
                  <Select
                    value={outputFormat}
                    onValueChange={setOutputFormat}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select output format" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="csv">
                        CSV (Tabular Data)
                      </SelectItem>
                      <SelectItem value="geojson">
                        GeoJSON (Spatial Data)
                      </SelectItem>
                      <SelectItem value="tiff">
                        GeoTIFF (Raster Maps)
                      </SelectItem>
                      <SelectItem value="all">All Formats</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-4 p-4 bg-muted/50 rounded-lg">
                  <h4 className="font-medium">Pipeline Summary</h4>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">
                        Pipeline Name:
                      </span>
                      <span className="font-medium">
                        {pipelineName || "Not set"}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Type:</span>
                      <span className="font-medium capitalize">
                        {pipelineType}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">
                        Plot Boundaries:
                      </span>
                      <span className="font-medium">
                        {boundarySource || "Not set"}
                      </span>
                    </div>
                    {pipelineType === "aerial" && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">
                          Resolution:
                        </span>
                        <span className="font-medium">
                          {resolution || "Not set"}
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Analysis:</span>
                      <span className="font-medium">
                        {modelType || "Not set"}
                      </span>
                    </div>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Navigation Buttons */}
        <div className="flex items-center justify-between mt-6">
          <Button
            variant="outline"
            onClick={handlePrevious}
            disabled={currentStep === 1}
          >
            Previous
          </Button>
          <div className="text-sm text-muted-foreground">
            Step {currentStep} of {steps.length}
          </div>
          <Button onClick={handleNext} disabled={!canProceed}>
            {currentStep === 3 ? "Start Processing" : "Next"}
            {currentStep < 3 && <ChevronRight className="w-4 h-4 ml-2" />}
          </Button>
        </div>
      </div>
    </div>
  );
}
