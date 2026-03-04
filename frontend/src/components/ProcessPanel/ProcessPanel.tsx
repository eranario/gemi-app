import { useState } from "react"
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  History,
  X,
} from "lucide-react"
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
  const completed = process.items.filter(
    (i) => i.status === "completed" || i.status === "skipped",
  ).length
  const total = process.items.length

  if (process.status === "completed") return `Completed ${total} file(s)`
  if (process.status === "error") return `Error — ${completed}/${total} done`
  return `${completed} of ${total} file(s)`
}

function processProgress(process: Process) {
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
  const activeProcess = processes[processes.length - 1]
  const progress = processProgress(activeProcess)

  return (
    <div className="fixed right-4 bottom-4 z-50 w-96">
      <Card className="shadow-lg">
        <Collapsible open={isOpen} onOpenChange={setIsOpen}>
          <CardHeader className="p-3">
            <div className="flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <p className="text-foreground truncate text-sm font-medium">
                  {processSummary(activeProcess)}
                </p>
                <Progress value={progress} className="mt-2 h-1.5" />
              </div>
              <div className="ml-2 flex shrink-0 items-center gap-1">
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7">
                    {isOpen ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronUp className="h-4 w-4" />
                    )}
                  </Button>
                </CollapsibleTrigger>
                {activeProcess.status === "completed" ||
                activeProcess.status === "error" ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => removeProcess(activeProcess.id)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                ) : null}
              </div>
            </div>
          </CardHeader>

          <CollapsibleContent>
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
          </CollapsibleContent>
        </Collapsible>
      </Card>
    </div>
  )
}
