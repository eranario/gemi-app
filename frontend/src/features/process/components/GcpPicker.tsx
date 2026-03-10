/**
 * GcpPicker — interactive tool for aerial pipeline Step 1.
 *
 * Flow:
 *  1. If gcp_locations.csv is missing, show an inline upload panel (paste CSV
 *     text or pick a local file). The CSV is saved to Intermediate/ via
 *     POST /save-gcp-locations, then the picker continues.
 *
 *  2. GCP list on the left — each GCP (label + coordinates) from the CSV.
 *     Images are sorted by distance to the active GCP using EXIF GPS.
 *
 *  3. Image selector below the viewer — click an image name to load it.
 *
 *  4. Click anywhere on the image to set the pixel coordinate for the
 *     active GCP.  A crosshair shows the marked position.
 *
 *  5. Save when all GCPs have an image + pixel marked.  Writes gcp_list.txt
 *     and geo.txt, marks step complete.
 */

import { AlertCircle, Check, Upload, MapPin, ChevronLeft, ChevronRight } from "lucide-react"
import { useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

function apiUrl(path: string): string {
  const base = (window as any).__GEMI_BACKEND_URL__ ?? ""
  return base ? `${base}${path}` : path
}
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardHeader } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { ProcessingService } from "@/client"
import useCustomToast from "@/hooks/useCustomToast"

// ── Types ─────────────────────────────────────────────────────────────────────

interface GcpEntry {
  label: string
  lat: number
  lon: number
  alt: number
}

interface ImageEntry {
  name: string
  lat: number | null
  lon: number | null
  alt: number | null
}

interface GcpCandidatesResponse {
  has_gcp_locations: boolean
  gcps: GcpEntry[]
  images: ImageEntry[]
  count: number
  raw_dir: string
}

interface GcpMarking {
  label: string
  image: string
  pixel_x: number
  pixel_y: number
  lat: number
  lon: number
  alt: number
}

interface GcpPickerProps {
  runId: string
  onSaved: () => void
  onCancel: () => void
}

// ── Distance helper ───────────────────────────────────────────────────────────

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function sortedByDistance(images: ImageEntry[], gcp: GcpEntry): ImageEntry[] {
  return [...images].sort((a, b) => {
    if (a.lat == null || a.lon == null) return 1
    if (b.lat == null || b.lon == null) return -1
    return (
      haversineKm(gcp.lat, gcp.lon, a.lat, a.lon) -
      haversineKm(gcp.lat, gcp.lon, b.lat, b.lon)
    )
  })
}

// ── Inline CSV upload panel ───────────────────────────────────────────────────

interface CsvUploadPanelProps {
  runId: string
  onLoaded: () => void
}

function CsvUploadPanel({ runId, onLoaded }: CsvUploadPanelProps) {
  const { showErrorToast } = useCustomToast()
  const [csvText, setCsvText] = useState("")
  const fileRef = useRef<HTMLInputElement>(null)

  const saveMutation = useMutation({
    mutationFn: (text: string) =>
      ProcessingService.saveGcpLocations({
        id: runId,
        requestBody: { csv_text: text },
      }),
    onSuccess: onLoaded,
    onError: () => showErrorToast("Failed to save GCP locations"),
  })

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev: ProgressEvent<FileReader>) => setCsvText((ev.target?.result as string) ?? "")
    reader.readAsText(file)
  }

  return (
    <div className="space-y-4 max-w-xl mx-auto py-8">
      <div className="flex flex-col items-center gap-2 text-center">
        <MapPin className="w-10 h-10 text-muted-foreground" />
        <h3 className="font-medium">GCP Locations Required</h3>
        <p className="text-sm text-muted-foreground">
          No <code>gcp_locations.csv</code> found. Paste the CSV content below or
          pick the file. Format:{" "}
          <code className="text-xs">Label, Lat_dec, Lon_dec, Altitude</code>
        </p>
      </div>

      <div className="space-y-2">
        <Label>CSV content</Label>
        <Textarea
          rows={8}
          placeholder={"Label,Lat_dec,Lon_dec,Altitude\nGCP1,33.4512,-111.9876,380.5\nGCP2,33.4498,-111.9845,381.0"}
          value={csvText}
          onChange={(e) => setCsvText(e.target.value)}
          className="font-mono text-xs"
        />
      </div>

      <div className="flex items-center gap-3">
        <Button variant="outline" onClick={() => fileRef.current?.click()}>
          <Upload className="w-4 h-4 mr-2" />
          Pick File
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={handleFile}
        />
        <Button
          className="flex-1"
          disabled={!csvText.trim() || saveMutation.isPending}
          onClick={() => saveMutation.mutate(csvText)}
        >
          {saveMutation.isPending ? "Saving…" : "Load GCP Locations"}
        </Button>
      </div>
    </div>
  )
}

// ── Main picker ───────────────────────────────────────────────────────────────

export function GcpPicker({ runId, onSaved, onCancel }: GcpPickerProps) {
  const { showErrorToast } = useCustomToast()
  const queryClient = useQueryClient()

  const { data, isLoading, refetch } = useQuery<GcpCandidatesResponse>({
    queryKey: ["gcp-candidates", runId],
    queryFn: () =>
      ProcessingService.gcpCandidates({ id: runId }) as unknown as Promise<GcpCandidatesResponse>,
  })

  // Per-GCP markings: label → {image, pixel_x, pixel_y}
  const [markings, setMarkings] = useState<Record<string, GcpMarking>>({})
  const [activeGcpLabel, setActiveGcpLabel] = useState<string | null>(null)
  const [selectedImage, setSelectedImage] = useState<string | null>(null)
  const [imageOffset, setImageOffset] = useState(0)

  const imgRef = useRef<HTMLImageElement>(null)
  const IMAGE_PAGE = 8

  const gcps = data?.gcps ?? []
  const allImages = data?.images ?? []
  const rawDir = data?.raw_dir ?? ""

  const activeGcp = gcps.find((g) => g.label === activeGcpLabel) ?? gcps[0] ?? null
  const activeLabel = activeGcp?.label ?? null

  // Candidates sorted by proximity to active GCP
  const candidates = activeGcp ? sortedByDistance(allImages, activeGcp) : allImages
  const visibleCandidates = candidates.slice(imageOffset, imageOffset + IMAGE_PAGE)

  const activeMark = activeLabel ? markings[activeLabel] : null

  // Click on image to set pixel
  const handleImageClick = (e: React.MouseEvent<HTMLImageElement>) => {
    if (!activeLabel || !selectedImage || !imgRef.current) return
    const rect = imgRef.current.getBoundingClientRect()
    const naturalW = imgRef.current.naturalWidth
    const naturalH = imgRef.current.naturalHeight
    const scaleX = naturalW / rect.width
    const scaleY = naturalH / rect.height
    const px = Math.round((e.clientX - rect.left) * scaleX)
    const py = Math.round((e.clientY - rect.top) * scaleY)

    const gcp = gcps.find((g) => g.label === activeLabel)!
    setMarkings((prev) => ({
      ...prev,
      [activeLabel]: {
        label: activeLabel,
        image: selectedImage,
        pixel_x: px,
        pixel_y: py,
        lat: gcp.lat,
        lon: gcp.lon,
        alt: gcp.alt,
      },
    }))
  }

  // Crosshair position on rendered image
  const getCrosshairStyle = (): React.CSSProperties | null => {
    if (!activeMark || !imgRef.current || activeMark.image !== selectedImage) return null
    const rect = imgRef.current.getBoundingClientRect()
    const naturalW = imgRef.current.naturalWidth
    const naturalH = imgRef.current.naturalHeight
    if (!naturalW || !naturalH) return null
    const x = (activeMark.pixel_x / naturalW) * rect.width
    const y = (activeMark.pixel_y / naturalH) * rect.height
    return { left: x, top: y }
  }

  const unmarked = gcps.filter((g) => !markings[g.label])
  const canSave = gcps.length > 0 && unmarked.length === 0

  const saveMutation = useMutation({
    mutationFn: () => {
      const selections = Object.values(markings)
      const imageGps = allImages.map((img) => ({
        image: img.name,
        lat: img.lat ?? 0,
        lon: img.lon ?? 0,
        alt: img.alt ?? 0,
      }))
      return ProcessingService.saveGcpSelection({
        id: runId,
        requestBody: {
          gcp_selections: selections as unknown as { [key: string]: unknown }[],
          image_gps: imageGps as unknown as { [key: string]: unknown }[],
        },
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pipeline-runs", runId] })
      onSaved()
    },
    onError: () => showErrorToast("Failed to save GCP selection"),
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
        Loading…
      </div>
    )
  }

  // No GCP CSV — show upload panel first
  if (!data?.has_gcp_locations) {
    return <CsvUploadPanel runId={runId} onLoaded={() => refetch()} />
  }

  if (gcps.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-48 gap-2 text-muted-foreground">
        <AlertCircle className="w-8 h-8" />
        <p className="text-sm">GCP locations file is empty or could not be parsed.</p>
      </div>
    )
  }

  const imgSrc = selectedImage
    ? apiUrl(`/api/v1/files/serve?path=${encodeURIComponent(rawDir + "/" + selectedImage)}`)
    : null

  const crosshair = getCrosshairStyle()

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* GCP list */}
        <div className="space-y-2">
          <p className="text-sm font-medium">GCPs ({gcps.length})</p>
          <div className="space-y-1 max-h-[480px] overflow-y-auto pr-1">
            {gcps.map((gcp) => {
              const marked = markings[gcp.label]
              const isActive = gcp.label === activeLabel
              return (
                <Card
                  key={gcp.label}
                  className={`cursor-pointer transition-colors ${isActive ? "border-primary" : "hover:border-primary/50"}`}
                  onClick={() => {
                    setActiveGcpLabel(gcp.label)
                    setSelectedImage(null)
                    setImageOffset(0)
                  }}
                >
                  <CardHeader className="py-2 px-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {marked ? (
                          <Check className="w-4 h-4 text-green-600 shrink-0" />
                        ) : (
                          <div className="w-4 h-4 rounded-full border-2 border-muted-foreground shrink-0" />
                        )}
                        <span className="text-sm font-medium">{gcp.label}</span>
                      </div>
                      {marked && (
                        <Badge variant="outline" className="text-xs">
                          {marked.image.slice(0, 12)}…
                        </Badge>
                      )}
                    </div>
                    {isActive && (
                      <div className="text-xs text-muted-foreground mt-1">
                        {gcp.lat.toFixed(6)}, {gcp.lon.toFixed(6)} · {gcp.alt}m
                      </div>
                    )}
                    {isActive && marked && (
                      <div className="text-xs text-green-700 mt-0.5">
                        Pixel: ({marked.pixel_x}, {marked.pixel_y})
                      </div>
                    )}
                  </CardHeader>
                </Card>
              )
            })}
          </div>

          {unmarked.length > 0 && (
            <p className="text-xs text-amber-600">
              {unmarked.length} GCP{unmarked.length > 1 ? "s" : ""} still need marking.
            </p>
          )}

          <div className="flex gap-2 pt-1">
            <Button variant="outline" className="flex-1" onClick={onCancel}>Cancel</Button>
            <Button
              className="flex-1"
              disabled={!canSave || saveMutation.isPending}
              onClick={() => saveMutation.mutate()}
            >
              {saveMutation.isPending ? "Saving…" : "Save GCPs"}
            </Button>
          </div>
        </div>

        {/* Image viewer + candidate strip */}
        <div className="lg:col-span-2 space-y-3">
          {/* Instruction */}
          {activeLabel && (
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{activeLabel}</span>
              {selectedImage
                ? " — click the image to mark the GCP pixel location"
                : " — select an image below"}
            </p>
          )}

          {/* Image viewer */}
          <div className="relative rounded-lg overflow-hidden bg-black aspect-video flex items-center justify-center">
            {imgSrc ? (
              <>
                <img
                  ref={imgRef}
                  src={imgSrc}
                  alt={selectedImage ?? ""}
                  className="max-h-full max-w-full object-contain cursor-crosshair"
                  draggable={false}
                  onClick={handleImageClick}
                />
                {/* Crosshair overlay */}
                {crosshair && (
                  <div
                    className="absolute pointer-events-none"
                    style={{ left: crosshair.left, top: crosshair.top }}
                  >
                    <div className="absolute -translate-x-1/2 -translate-y-1/2 w-6 h-6">
                      <div className="absolute left-1/2 top-0 w-px h-full bg-red-500" />
                      <div className="absolute top-1/2 left-0 h-px w-full bg-red-500" />
                      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-2 h-2 rounded-full border-2 border-red-500" />
                    </div>
                  </div>
                )}
              </>
            ) : (
              <p className="text-white/40 text-sm">
                {activeLabel ? "Select an image below" : "Select a GCP on the left"}
              </p>
            )}
          </div>

          {/* Candidate image strip */}
          {activeGcp && (
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  Closest images to {activeLabel} ({candidates.length} total)
                </p>
                <div className="flex gap-1">
                  <Button
                    variant="ghost" size="icon"
                    className="h-6 w-6"
                    disabled={imageOffset === 0}
                    onClick={() => setImageOffset((o) => Math.max(0, o - IMAGE_PAGE))}
                  >
                    <ChevronLeft className="w-3 h-3" />
                  </Button>
                  <Button
                    variant="ghost" size="icon"
                    className="h-6 w-6"
                    disabled={imageOffset + IMAGE_PAGE >= candidates.length}
                    onClick={() => setImageOffset((o) => o + IMAGE_PAGE)}
                  >
                    <ChevronRight className="w-3 h-3" />
                  </Button>
                </div>
              </div>
              <div className="grid grid-cols-4 gap-1">
                {visibleCandidates.map((img) => {
                  const isSelected = selectedImage === img.name
                  const isMarked = activeLabel
                    ? markings[activeLabel]?.image === img.name
                    : false
                  return (
                    <button
                      key={img.name}
                      className={`relative rounded overflow-hidden border-2 aspect-video bg-black text-left transition-colors ${
                        isSelected
                          ? "border-primary"
                          : isMarked
                            ? "border-green-500"
                            : "border-border hover:border-primary/50"
                      }`}
                      onClick={() => setSelectedImage(img.name)}
                    >
                      <img
                        src={apiUrl(`/api/v1/files/serve?path=${encodeURIComponent(rawDir + "/" + img.name)}`)}
                        alt={img.name}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                      {isMarked && (
                        <div className="absolute top-0.5 right-0.5">
                          <Check className="w-3 h-3 text-green-400 drop-shadow" />
                        </div>
                      )}
                      <div className="absolute bottom-0 inset-x-0 bg-black/50 px-1 py-0.5">
                        <p className="text-white text-[9px] truncate">{img.name}</p>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
