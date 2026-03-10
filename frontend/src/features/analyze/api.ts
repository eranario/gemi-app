/** Typed fetch wrappers for the /analyze backend endpoints. */

function apiUrl(path: string): string {
  const base = (window as any).__GEMI_BACKEND_URL__ ?? import.meta.env.VITE_API_URL ?? ""
  return base ? `${base}${path}` : path
}

function authHeaders() {
  const token = localStorage.getItem("access_token") || ""
  return { Authorization: `Bearer ${token}` }
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(apiUrl(path), { headers: authHeaders() })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail ?? `HTTP ${res.status}`)
  }
  return res.json()
}

export interface AnalyzableRun {
  run_id: string
  pipeline_id: string
  pipeline_name: string
  pipeline_type: "aerial" | "ground"
  workspace_name: string
  date: string
  experiment: string
  location: string
  population: string
  platform: string
  sensor: string
  status: string
  available: string[]
  created_at: string
}

export interface TraitsResponse {
  geojson: GeoJSON.FeatureCollection
  metric_columns: string[]
  feature_count: number
}

export interface OrthoInfoResponse {
  available: boolean
  path: string | null
  bounds: [[number, number], [number, number]] | null
}

export const analyzeApi = {
  listRuns: () => get<AnalyzableRun[]>("/api/v1/analyze/runs"),
  getTraits: (runId: string) => get<TraitsResponse>(`/api/v1/analyze/runs/${runId}/traits`),
  getOrthoInfo: (runId: string) => get<OrthoInfoResponse>(`/api/v1/analyze/runs/${runId}/ortho-info`),
}
