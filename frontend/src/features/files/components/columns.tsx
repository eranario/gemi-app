import type { ColumnDef } from "@tanstack/react-table"

import type { FileUploadPublic } from "@/client"
import { Badge } from "@/components/ui/badge"
import { UploadActionsMenu } from "./UploadActionsMenu"

export const columns: ColumnDef<FileUploadPublic>[] = [
  {
    accessorKey: "data_type",
    header: "Data Type",
    cell: ({ row }) => (
      <span className="font-medium">{row.original.data_type}</span>
    ),
  },
  {
    accessorKey: "experiment",
    header: "Experiment",
  },
  {
    accessorKey: "location",
    header: "Location",
  },
  {
    accessorKey: "date",
    header: "Date",
  },
  {
    accessorKey: "platform",
    header: "Platform",
    cell: ({ row }) => (
      <span className="text-muted-foreground">
        {row.original.platform || "—"}
      </span>
    ),
  },
  {
    accessorKey: "sensor",
    header: "Sensor",
    cell: ({ row }) => (
      <span className="text-muted-foreground">
        {row.original.sensor || "—"}
      </span>
    ),
  },
  {
    accessorKey: "file_count",
    header: "Files",
    cell: ({ row }) => (
      <span className="tabular-nums">{row.original.file_count}</span>
    ),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => {
      const status = row.original.status
      const variant =
        status === "completed"
          ? "default"
          : status === "missing"
            ? "destructive"
            : "secondary"
      return <Badge variant={variant}>{status}</Badge>
    },
  },
  {
    accessorKey: "created_at",
    header: "Uploaded",
    cell: ({ row }) => {
      const date = new Date(row.original.created_at)
      return (
        <span className="text-muted-foreground">
          {date.toLocaleDateString()}
        </span>
      )
    },
  },
  {
    id: "actions",
    header: () => <span className="sr-only">Actions</span>,
    cell: ({ row }) => (
      <div className="flex justify-end">
        <UploadActionsMenu upload={row.original} />
      </div>
    ),
  },
]
