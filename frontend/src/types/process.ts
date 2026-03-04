export type ProcessType = "file_upload" | "export" | "processing"
export type ProcessStatus = "pending" | "running" | "completed" | "error"
export type ProcessItemStatus =
  | "pending"
  | "running"
  | "completed"
  | "error"
  | "skipped"

export interface ProcessItem {
  id: string
  name: string
  status: ProcessItemStatus
  error?: string
}

export interface Process {
  id: string
  type: ProcessType
  status: ProcessStatus
  title: string
  items: ProcessItem[]
  createdAt: Date
  completedAt?: Date
  error?: string
}
