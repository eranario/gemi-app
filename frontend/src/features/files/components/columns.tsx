import type { ColumnDef, FilterFn } from "@tanstack/react-table"

import type { FileUploadPublic } from "@/client"
import { Badge } from "@/components/ui/badge"
import { ColumnFilter } from "./ColumnFilter"
import { UploadActionsMenu } from "./UploadActionsMenu"

const arrayIncludesFilter: FilterFn<FileUploadPublic> = (
  row,
  columnId,
  filterValue: string[],
) => {
  const value = String(row.getValue(columnId) ?? "")
  return filterValue.includes(value)
}

export const columns: ColumnDef<FileUploadPublic>[] = [
  {
    accessorKey: "data_type",
    header: ({ column }) => <ColumnFilter column={column} title="Data Type" />,
    filterFn: arrayIncludesFilter,
    cell: ({ row }) => (
      <span className="font-medium">{row.original.data_type}</span>
    ),
  },
  {
    accessorKey: "experiment",
    header: ({ column }) => (
      <ColumnFilter column={column} title="Experiment" />
    ),
    filterFn: arrayIncludesFilter,
  },
  {
    accessorKey: "location",
    header: ({ column }) => <ColumnFilter column={column} title="Location" />,
    filterFn: arrayIncludesFilter,
  },
  {
    accessorKey: "date",
    header: ({ column }) => <ColumnFilter column={column} title="Date" />,
    filterFn: arrayIncludesFilter,
  },
  {
    accessorKey: "platform",
    header: ({ column }) => <ColumnFilter column={column} title="Platform" />,
    filterFn: arrayIncludesFilter,
    cell: ({ row }) => (
      <span className="text-muted-foreground">
        {row.original.platform || "—"}
      </span>
    ),
  },
  {
    accessorKey: "sensor",
    header: ({ column }) => <ColumnFilter column={column} title="Sensor" />,
    filterFn: arrayIncludesFilter,
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
    header: ({ column }) => <ColumnFilter column={column} title="Status" />,
    filterFn: arrayIncludesFilter,
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
