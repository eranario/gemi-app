import { useQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { BarChart2, Loader2, Map, Microscope } from "lucide-react"
import { analyzeApi, type AnalyzableRun } from "../api"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

const BADGE_LABELS: Record<string, string> = {
  traits: "Traits",
  orthomosaic: "Orthomosaic",
  boundaries: "Boundaries",
  mosaic: "Mosaic",
  inference: "Inference",
}

function PipelineTypeBadge({ type }: { type: string }) {
  return (
    <Badge variant="outline" className="capitalize text-xs">
      {type}
    </Badge>
  )
}

export function AnalyzeDashboard() {
  const navigate = useNavigate()

  const { data: runs = [], isLoading } = useQuery({
    queryKey: ["analyze-runs"],
    queryFn: analyzeApi.listRuns,
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh] gap-2 text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin" />
        Loading runs…
      </div>
    )
  }

  if (runs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[40vh] gap-3 text-muted-foreground">
        <BarChart2 className="w-10 h-10" />
        <p className="text-sm">No analyzable runs yet. Complete processing steps to see results here.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Analyze</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {runs.length} run{runs.length !== 1 ? "s" : ""} with analyzable outputs
        </p>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Pipeline</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Population</TableHead>
              <TableHead>Platform / Sensor</TableHead>
              <TableHead>Outputs</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.map((run: AnalyzableRun) => (
              <TableRow
                key={run.run_id}
                className="cursor-pointer hover:bg-muted/50"
                onClick={() => navigate({ to: "/analyze/$runId", params: { runId: run.run_id } })}
              >
                <TableCell>
                  <div className="flex items-center gap-2">
                    {run.pipeline_type === "aerial" ? (
                      <Map className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    ) : (
                      <Microscope className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    )}
                    <div>
                      <p className="font-medium text-sm">{run.pipeline_name}</p>
                      <p className="text-xs text-muted-foreground">{run.workspace_name}</p>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-sm">{run.date}</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {[run.experiment, run.location, run.population].filter(Boolean).join(" / ")}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {[run.platform, run.sensor].filter(Boolean).join(" / ")}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    <PipelineTypeBadge type={run.pipeline_type} />
                    {run.available.map((key) => (
                      <Badge key={key} variant="secondary" className="text-xs">
                        {BADGE_LABELS[key] ?? key}
                      </Badge>
                    ))}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
