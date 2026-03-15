/**
 * AnalyzeDashboard — top-level Analyze page.
 *
 * Two tabs:
 *  - Table: filterable flat table of all TraitRecords with expandable
 *           per-plot data rows.
 *  - Map:   satellite → ortho image overlay → trait polygons. Left panel
 *           lists records grouped by workspace/pipeline; click to load.
 */

import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import {
  BarChart2,
  ChevronDown,
  ChevronRight,
  Download,
  Eye,
  EyeOff,
  Loader2,
  Map as MapIcon,
  Table2,
} from "lucide-react"
import { analyzeApi, versionLabel, type TraitRecord } from "../api"
import { TraitMap } from "../components/TraitMap"
import { MetricSelector } from "../components/MetricSelector"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmt(n: number | null | undefined, digits = 3): string {
  if (n == null) return "—"
  return n.toFixed(digits)
}

function downloadCsv(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/csv" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function featuresToCsv(features: GeoJSON.Feature[]): string {
  if (!features.length) return ""
  const cols = [...new Set(features.flatMap((f) => Object.keys(f.properties ?? {})))]
  const header = cols.join(",")
  const lines = features.map((f) =>
    cols
      .map((c) => {
        const v = f.properties?.[c]
        return typeof v === "string" && v.includes(",") ? `"${v}"` : String(v ?? "")
      })
      .join(","),
  )
  return [header, ...lines].join("\n")
}

// ── Version badge ──────────────────────────────────────────────────────────────

function VersionBadge({
  version,
  name,
  label,
}: {
  version: number | null
  name: string | null | undefined
  label: string
}) {
  if (version == null) return <span className="text-muted-foreground text-xs">—</span>
  return (
    <div className="flex flex-col gap-0.5">
      <Badge variant="outline" className="text-xs w-fit">
        {label} {versionLabel(version, name)}
      </Badge>
    </div>
  )
}

// ── Expandable per-plot table ──────────────────────────────────────────────────

function ExpandedPlotTable({ recordId }: { recordId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["trait-record-geojson", recordId],
    queryFn: () => analyzeApi.getTraitRecordGeojson(recordId),
    staleTime: 60_000,
  })

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-4 px-6 text-muted-foreground text-sm">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading plot data…
      </div>
    )
  }

  const features = data?.geojson?.features ?? []
  if (!features.length) {
    return <p className="px-6 py-3 text-sm text-muted-foreground">No plot data found.</p>
  }

  // Determine columns: metadata first, then numeric traits
  const allKeys = [...new Set(features.flatMap((f) => Object.keys(f.properties ?? {})))]
  const metaCols = allKeys.filter(
    (k) =>
      !["", "geometry"].includes(k) &&
      typeof features[0]?.properties?.[k] !== "number",
  )
  const numCols = data?.metric_columns ?? []
  const cols = [...metaCols, ...numCols].filter((c) => c !== "")

  function handleDownload() {
    downloadCsv(featuresToCsv(features), `traits_${recordId}.csv`)
  }

  return (
    <div className="border-t bg-muted/20">
      <div className="px-6 py-2 flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {features.length} plots · {numCols.join(", ")}
        </p>
        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={handleDownload}>
          <Download className="w-3 h-3 mr-1.5" />
          Download CSV
        </Button>
      </div>
      <div className="overflow-x-auto max-h-64 overflow-y-auto">
        <Table>
          <TableHeader>
            <TableRow>
              {cols.map((c) => (
                <TableHead key={c} className="text-xs whitespace-nowrap px-3 py-1.5">
                  {c.replace(/_/g, " ")}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {features.map((f, i) => (
              <TableRow key={i} className="text-xs">
                {cols.map((c) => {
                  const v = f.properties?.[c]
                  return (
                    <TableCell key={c} className="px-3 py-1 font-mono">
                      {typeof v === "number" ? v.toFixed(3) : String(v ?? "—")}
                    </TableCell>
                  )
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

// ── Table tab ─────────────────────────────────────────────────────────────────

function TableTab({ records }: { records: TraitRecord[] }) {
  const [wsFilter, setWsFilter] = useState("__all__")
  const [pipelineFilter, setPipelineFilter] = useState("__all__")
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const workspaces = useMemo(
    () => [...new Set(records.map((r) => r.workspace_name))].sort(),
    [records],
  )
  const pipelines = useMemo(
    () =>
      [
        ...new Set(
          records
            .filter((r) => wsFilter === "__all__" || r.workspace_name === wsFilter)
            .map((r) => r.pipeline_name),
        ),
      ].sort(),
    [records, wsFilter],
  )

  const filtered = useMemo(
    () =>
      records.filter((r) => {
        if (wsFilter !== "__all__" && r.workspace_name !== wsFilter) return false
        if (pipelineFilter !== "__all__" && r.pipeline_name !== pipelineFilter) return false
        return true
      }),
    [records, wsFilter, pipelineFilter],
  )

  function toggleExpanded(id: string) {
    setExpandedId((prev) => (prev === id ? null : id))
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <Select
          value={wsFilter}
          onValueChange={(v) => {
            setWsFilter(v)
            setPipelineFilter("__all__")
          }}
        >
          <SelectTrigger className="h-8 w-48 text-xs">
            <SelectValue placeholder="All workspaces" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All workspaces</SelectItem>
            {workspaces.map((w) => (
              <SelectItem key={w} value={w} className="text-xs">
                {w}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={pipelineFilter} onValueChange={setPipelineFilter}>
          <SelectTrigger className="h-8 w-48 text-xs">
            <SelectValue placeholder="All pipelines" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All pipelines</SelectItem>
            {pipelines.map((p) => (
              <SelectItem key={p} value={p} className="text-xs">
                {p}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <span className="text-xs text-muted-foreground ml-auto">
          {filtered.length} record{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Table */}
      <div className="rounded-lg border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
              <TableHead>Workspace</TableHead>
              <TableHead>Pipeline</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Ortho</TableHead>
              <TableHead>Boundary</TableHead>
              <TableHead className="text-right">Plots</TableHead>
              <TableHead className="text-right">VF avg</TableHead>
              <TableHead className="text-right">Height avg</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={9}
                  className="text-center text-muted-foreground py-8 text-sm"
                >
                  No trait records match the current filter.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((r) => (
                <>
                  <TableRow
                    key={r.id}
                    className="cursor-pointer hover:bg-muted/40"
                    onClick={() => toggleExpanded(r.id)}
                  >
                    <TableCell className="px-3">
                      {expandedId === r.id ? (
                        <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
                      )}
                    </TableCell>
                    <TableCell className="text-sm font-medium">{r.workspace_name}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <Badge variant="outline" className="text-xs capitalize">
                          {r.pipeline_type}
                        </Badge>
                        <span className="text-sm">{r.pipeline_name}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">{r.date}</TableCell>
                    <TableCell>
                      <VersionBadge
                        version={r.ortho_version}
                        name={r.ortho_name}
                        label="Ortho"
                      />
                    </TableCell>
                    <TableCell>
                      <VersionBadge
                        version={r.boundary_version}
                        name={r.boundary_name}
                        label="Boundary"
                      />
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {r.plot_count}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {fmt(r.vf_avg)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {r.height_avg != null ? `${fmt(r.height_avg)} m` : "—"}
                    </TableCell>
                  </TableRow>
                  {expandedId === r.id && (
                    <TableRow key={`${r.id}-expanded`}>
                      <TableCell colSpan={9} className="p-0">
                        <ExpandedPlotTable recordId={r.id} />
                      </TableCell>
                    </TableRow>
                  )}
                </>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

// ── Map tab ───────────────────────────────────────────────────────────────────

function MapTab({ records }: { records: TraitRecord[] }) {
  const [wsFilter, setWsFilter] = useState("__all__")
  const [pipelineFilter, setPipelineFilter] = useState("__all__")
  const [selectedId, setSelectedId] = useState<string | null>(() => records[0]?.id ?? null)
  const [selectedMetric, setSelectedMetric] = useState<string | null>(null)
  const [showPolygons, setShowPolygons] = useState(true)

  const workspaces = useMemo(
    () => [...new Set(records.map((r) => r.workspace_name))].sort(),
    [records],
  )

  const pipelines = useMemo(
    () =>
      [
        ...new Set(
          records
            .filter((r) => wsFilter === "__all__" || r.workspace_name === wsFilter)
            .map((r) => r.pipeline_name),
        ),
      ].sort(),
    [records, wsFilter],
  )

  const filteredRecords = useMemo(
    () =>
      records.filter((r) => {
        if (wsFilter !== "__all__" && r.workspace_name !== wsFilter) return false
        if (pipelineFilter !== "__all__" && r.pipeline_name !== pipelineFilter) return false
        return true
      }),
    [records, wsFilter, pipelineFilter],
  )

  // Group for sidebar display: workspace → pipeline → records
  const grouped = useMemo(() => {
    const map = new Map<string, Map<string, TraitRecord[]>>()
    for (const r of filteredRecords) {
      if (!map.has(r.workspace_name)) map.set(r.workspace_name, new Map())
      const pMap = map.get(r.workspace_name)!
      if (!pMap.has(r.pipeline_name)) pMap.set(r.pipeline_name, [])
      pMap.get(r.pipeline_name)!.push(r)
    }
    return map
  }, [filteredRecords])

  const { data: traitsData, isLoading: traitsLoading } = useQuery({
    queryKey: ["trait-record-geojson", selectedId],
    queryFn: () => analyzeApi.getTraitRecordGeojson(selectedId!),
    enabled: !!selectedId,
    staleTime: 60_000,
  })

  // Auto-pick the first metric when data loads; fall back when user hasn't chosen one yet.
  // Derived rather than stored in state to avoid side effects in render callbacks.
  const effectiveMetric =
    selectedMetric ?? traitsData?.metric_columns?.[0] ?? null

  const { data: orthoInfo } = useQuery({
    queryKey: ["trait-record-ortho", selectedId],
    queryFn: () => analyzeApi.getTraitRecordOrthoInfo(selectedId!),
    enabled: !!selectedId,
    staleTime: 60_000,
  })

  return (
    <div className="flex h-full min-h-0">
      {/* Left panel */}
      <div className="w-56 flex-shrink-0 border-r flex flex-col overflow-hidden">
        <div className="p-3 border-b space-y-2">
          <Select
            value={wsFilter}
            onValueChange={(v) => {
              setWsFilter(v)
              setPipelineFilter("__all__")
            }}
          >
            <SelectTrigger className="h-7 text-xs">
              <SelectValue placeholder="All workspaces" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All workspaces</SelectItem>
              {workspaces.map((w) => (
                <SelectItem key={w} value={w} className="text-xs">
                  {w}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={pipelineFilter} onValueChange={setPipelineFilter}>
            <SelectTrigger className="h-7 text-xs">
              <SelectValue placeholder="All pipelines" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All pipelines</SelectItem>
              {pipelines.map((p) => (
                <SelectItem key={p} value={p} className="text-xs">
                  {p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="overflow-y-auto flex-1 py-1">
          {[...grouped.entries()].map(([ws, pipelineMap]) => (
            <div key={ws}>
              <p className="px-3 pt-2 pb-0.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                {ws}
              </p>
              {[...pipelineMap.entries()].map(([pipeline, recs]) => (
                <div key={pipeline}>
                  <p className="px-3 py-0.5 text-xs text-muted-foreground">{pipeline}</p>
                  {recs.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => {
                        setSelectedId(r.id)
                        setSelectedMetric(null)
                      }}
                      className={`w-full text-left px-4 py-1.5 text-xs hover:bg-muted/60 transition-colors ${
                        selectedId === r.id ? "bg-muted font-medium" : ""
                      }`}
                    >
                      <div className="truncate">{r.date}</div>
                      <div className="text-muted-foreground text-[11px] mt-0.5 space-y-0.5">
                        <div className="truncate">
                          <span className="text-foreground/50">Ortho:</span>{" "}
                          {versionLabel(r.ortho_version, r.ortho_name)}
                        </div>
                        <div className="truncate">
                          <span className="text-foreground/50">Boundary:</span>{" "}
                          {r.boundary_version != null
                            ? versionLabel(r.boundary_version, r.boundary_name)
                            : "canonical"}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          ))}
          {filteredRecords.length === 0 && (
            <p className="px-3 py-4 text-xs text-muted-foreground text-center">
              No records to show.
            </p>
          )}
        </div>

        {/* Metric selector + toggle */}
        {traitsData && traitsData.metric_columns.length > 0 && (
          <div className="border-t p-3 space-y-1.5">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Color by
              </p>
              <button
                onClick={() => setShowPolygons((v) => !v)}
                className="text-muted-foreground hover:text-foreground transition-colors"
                title={showPolygons ? "Hide polygons" : "Show polygons"}
              >
                {showPolygons ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
              </button>
            </div>
            <MetricSelector
              columns={traitsData.metric_columns}
              value={effectiveMetric}
              onChange={setSelectedMetric}
            />
          </div>
        )}
      </div>

      {/* Map */}
      <div className="flex-1 relative min-w-0">
        {!selectedId ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground">
            <MapIcon className="w-10 h-10" />
            <p className="text-sm">Select a record from the list to view on the map.</p>
          </div>
        ) : traitsLoading ? (
          <div className="flex items-center justify-center h-full gap-2 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" />
            Loading traits…
          </div>
        ) : (
          <TraitMap
            geojson={traitsData?.geojson ?? null}
            orthoInfo={orthoInfo ?? null}
            selectedMetric={effectiveMetric}
            filteredIds={null}
            recordId={selectedId}
            showPolygons={showPolygons}
          />
        )}
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function AnalyzeDashboard() {
  const { data: records = [], isLoading } = useQuery({
    queryKey: ["trait-records"],
    queryFn: analyzeApi.listTraitRecords,
    staleTime: 30_000,
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh] gap-2 text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin" />
        Loading…
      </div>
    )
  }

  if (records.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[40vh] gap-3 text-muted-foreground">
        <BarChart2 className="w-10 h-10" />
        <p className="text-sm">
          No trait records yet. Complete a Trait Extraction step to see results here.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 64px)" }}>
      {/* Header */}
      <div className="px-6 pt-5 pb-3 flex-shrink-0">
        <h1 className="text-2xl font-semibold">Analyze</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {records.length} trait extraction{records.length !== 1 ? "s" : ""}
        </p>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="table" className="flex-1 flex flex-col min-h-0 px-6">
        <TabsList className="self-start mb-4 flex-shrink-0">
          <TabsTrigger value="table" className="gap-1.5">
            <Table2 className="w-3.5 h-3.5" />
            Table
          </TabsTrigger>
          <TabsTrigger value="map" className="gap-1.5">
            <MapIcon className="w-3.5 h-3.5" />
            Map
          </TabsTrigger>
        </TabsList>

        <TabsContent value="table" className="mt-0 flex-1 overflow-auto pb-6">
          <TableTab records={records} />
        </TabsContent>

        <TabsContent
          value="map"
          className="mt-0 flex-1 min-h-0 data-[state=inactive]:hidden"
          style={{ display: undefined }}
        >
          <div className="h-full rounded-lg border overflow-hidden">
            <MapTab records={records} />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
