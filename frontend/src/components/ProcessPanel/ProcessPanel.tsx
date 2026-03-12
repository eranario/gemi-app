import { useState } from "react"
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  ExternalLink,
  History,
  X,
} from "lucide-react"
import { useNavigate } from "@tanstack/react-router"
import { useProcess } from "@/contexts/ProcessContext"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { ProcessItemRow } from "./ProcessItemRow"
import type { Process } from "@/types/process"

function processSummary(process: Process) {
  if (process.type === "processing") {
    if (process.status === "completed") return `${process.title} — done`
    if (process.status === "error") return `${process.title} — failed`
    return process.title
  }
  const completed = process.items.filter(
    (i) => i.status === "completed" || i.status === "skipped",
  ).length
  const total = process.items.length
  if (process.status === "completed") return `Completed ${total} file(s)`
  if (process.status === "error") return `Error — ${completed}/${total} done`
  return `${completed} of ${total} file(s)`
}

function processProgress(process: Process) {
  if (process.progress !== undefined) return process.progress
  if (process.items.length === 0) return 0
  const done = process.items.filter(
    (i) => i.status !== "pending" && i.status !== "running",
  ).length
  return Math.round((done / process.items.length) * 100)
}

function formatTime(date: Date) {
  return new Date(date).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })
}

function CollapsibleProcess({
  process,
  defaultOpen = false,
}: {
  process: Process
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const doneCount = process.items.filter(
    (i) => i.status === "completed" || i.status === "skipped",
  ).length

  // Processing type has no items — show a simple progress row instead
  if (process.type === "processing") {
    const pct = process.progress ?? (process.status === "completed" ? 100 : 0)
    const statusColor =
      process.status === "completed"
        ? "text-green-600"
        : process.status === "error"
          ? "text-red-500"
          : "text-muted-foreground"
    return (
      <div className="px-3 py-1.5">
        <div className="flex items-center gap-1.5">
          <span className="min-w-0 flex-1 truncate text-xs font-medium">
            {process.title}
          </span>
          <span className={`shrink-0 text-xs ${statusColor}`}>
            {process.status === "completed"
              ? "done"
              : process.status === "error"
                ? "failed"
                : `${pct}%`}
          </span>
          {process.completedAt && (
            <span className="text-muted-foreground shrink-0 text-xs">
              {formatTime(process.completedAt)}
            </span>
          )}
        </div>
        {process.message && process.status !== "completed" && (
          <p className="text-muted-foreground mt-0.5 truncate text-xs">
            {process.message}
          </p>
        )}
        {process.status === "running" && (
          <Progress value={pct} className="mt-1 h-1" />
        )}
      </div>
    )
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="hover:bg-muted/50 flex w-full items-center gap-1.5 px-3 py-1.5 text-left">
        {open ? (
          <ChevronDown className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
        ) : (
          <ChevronRight className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
        )}
        <span className="min-w-0 flex-1 truncate text-xs font-medium">
          {process.title}
        </span>
        <span className="text-muted-foreground shrink-0 text-xs">
          {doneCount}/{process.items.length}
        </span>
        {process.completedAt && (
          <span className="text-muted-foreground shrink-0 text-xs">
            {formatTime(process.completedAt)}
          </span>
        )}
      </CollapsibleTrigger>
      <CollapsibleContent>
        {process.items.map((item) => (
          <ProcessItemRow key={item.id} item={item} />
        ))}
      </CollapsibleContent>
    </Collapsible>
  )
}

function ProcessList({
  processes,
  defaultOpen = false,
}: {
  processes: Process[]
  defaultOpen?: boolean
}) {
  return (
    <div className="max-h-56 overflow-y-auto">
      {processes.map((process) => (
        <CollapsibleProcess
          key={process.id}
          process={process}
          defaultOpen={defaultOpen}
        />
      ))}
    </div>
  )
}

export function ProcessPanel() {
  const {
    processes,
    history,
    hasBeenActive,
    clearCompleted,
    removeProcess,
    clearHistory,
  } = useProcess()
  const navigate = useNavigate()
  const [isOpen, setIsOpen] = useState(true)
  const [showHistory, setShowHistory] = useState(false)

  // Never shown anything yet
  if (!hasBeenActive) return null

  const hasActive = processes.length > 0

  // No active processes — show the history button (always, even if history is empty)
  if (!hasActive && !showHistory) {
    return (
      <div className="fixed right-4 bottom-4 z-50">
        <Button
          variant="outline"
          size="sm"
          className="shadow-md"
          onClick={() => setShowHistory(true)}
        >
          <History className="mr-1.5 h-4 w-4" />
          {history.length > 0
            ? `${history.length} completed`
            : "No recent processes"}
        </Button>
      </div>
    )
  }

  // History panel (no active processes)
  if (!hasActive && showHistory) {
    return (
      <div className="fixed right-4 bottom-4 z-50 w-96">
        <Card className="shadow-lg">
          <CardHeader className="p-3">
            <div className="flex items-center justify-between">
              <p className="text-foreground text-sm font-medium">
                Recent processes
              </p>
              <div className="flex items-center gap-1">
                {history.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={clearHistory}
                  >
                    Clear all
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => setShowHistory(false)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="px-0 pt-0 pb-2">
            {history.length > 0 ? (
              <ProcessList processes={history} defaultOpen={false} />
            ) : (
              <p className="text-muted-foreground px-3 py-2 text-center text-sm">
                No recent processes
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    )
  }

  // Active processes view
  const multi = processes.length > 1
  const activeProcess = processes[processes.length - 1]
  const runningCount = processes.filter(
    (p) => p.status === "running" || p.status === "pending",
  ).length
  const allDone = processes.every(
    (p) => p.status === "completed" || p.status === "error",
  )

  // Combined progress: average across all active processes
  const combinedProgress = Math.round(
    processes.reduce((sum, p) => sum + processProgress(p), 0) / processes.length,
  )

  const headerTitle = multi
    ? runningCount > 0
      ? `${runningCount} of ${processes.length} running`
      : `${processes.length} processes`
    : processSummary(activeProcess)

  const headerProgress = multi ? combinedProgress : processProgress(activeProcess)

  // Minimized pill — shown when user collapses the panel
  if (!isOpen) {
    return (
      <div className="fixed right-4 bottom-4 z-50 flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          className="shadow-md"
          onClick={() => setIsOpen(true)}
        >
          <ChevronUp className="mr-1.5 h-4 w-4" />
          {headerTitle}
        </Button>
        {!multi && activeProcess.link && (
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8 shadow-md"
            title="Go to run"
            onClick={() => navigate({ to: activeProcess.link! as any })}
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    )
  }

  return (
    <div className="fixed right-4 bottom-4 z-50 w-96">
      <Card className="shadow-lg">
        <CardHeader className="p-3">
          <div className="flex items-center justify-between">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <p className="text-foreground truncate text-sm font-medium">
                  {headerTitle}
                </p>
                {!multi && activeProcess.link && (
                  <button
                    className="text-muted-foreground hover:text-foreground shrink-0"
                    title="View logs"
                    onClick={() => navigate({ to: activeProcess.link! as any })}
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              {!multi && activeProcess.message && (
                <p className="text-muted-foreground truncate text-xs">
                  {activeProcess.message}
                </p>
              )}
              <Progress value={Math.min(100, Math.max(0, headerProgress))} className="mt-2 h-1.5" />
            </div>
            <div className="ml-2 flex shrink-0 items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => setIsOpen(false)}
              >
                <ChevronDown className="h-4 w-4" />
              </Button>
              {((!multi && (activeProcess.status === "completed" || activeProcess.status === "error")) ||
                (multi && allDone)) && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() =>
                    multi
                      ? processes.forEach((p) => removeProcess(p.id))
                      : removeProcess(activeProcess.id)
                  }
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </CardHeader>

        <CardContent className="px-0 pt-0 pb-2">
          <ProcessList processes={processes} defaultOpen={true} />

          {processes.some(
            (p) => p.status === "completed" || p.status === "error",
          ) && (
            <div className="mt-1 px-3">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={clearCompleted}
              >
                Clear completed
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
