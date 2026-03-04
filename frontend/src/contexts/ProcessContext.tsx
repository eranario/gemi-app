import { createContext, useCallback, useContext, useState } from "react"
import type { Process, ProcessItem } from "@/types/process"

type ProcessContextState = {
  processes: Process[]
  history: Process[]
  hasBeenActive: boolean
  addProcess: (process: Omit<Process, "id" | "createdAt">) => string
  updateProcess: (id: string, updates: Partial<Process>) => void
  updateProcessItem: (
    processId: string,
    itemId: string,
    updates: Partial<ProcessItem>,
  ) => void
  removeProcess: (id: string) => void
  clearCompleted: () => void
  clearHistory: () => void
}

const ProcessContext = createContext<ProcessContextState | undefined>(undefined)

export function ProcessProvider({ children }: { children: React.ReactNode }) {
  const [processes, setProcesses] = useState<Process[]>([])
  const [history, setHistory] = useState<Process[]>([])
  const [hasBeenActive, setHasBeenActive] = useState(false)

  const addProcess = useCallback(
    (process: Omit<Process, "id" | "createdAt">) => {
      const id = crypto.randomUUID()
      const newProcess: Process = {
        ...process,
        id,
        createdAt: new Date(),
      }
      setProcesses((prev) => [...prev, newProcess])
      setHasBeenActive(true)
      return id
    },
    [],
  )

  const updateProcess = useCallback(
    (id: string, updates: Partial<Process>) => {
      setProcesses((prev) =>
        prev.map((p) => {
          if (p.id !== id) return p
          return { ...p, ...updates }
        }),
      )
    },
    [],
  )

  const updateProcessItem = useCallback(
    (processId: string, itemId: string, updates: Partial<ProcessItem>) => {
      setProcesses((prev) =>
        prev.map((p) => {
          if (p.id !== processId) return p
          return {
            ...p,
            items: p.items.map((item) =>
              item.id === itemId ? { ...item, ...updates } : item,
            ),
          }
        }),
      )
    },
    [],
  )

  const removeProcess = useCallback((id: string) => {
    setProcesses((prev) => {
      const process = prev.find((p) => p.id === id)
      if (process) {
        setHistory((h) =>
          h.some((hp) => hp.id === id) ? h : [process, ...h],
        )
      }
      return prev.filter((p) => p.id !== id)
    })
  }, [])

  const clearCompleted = useCallback(() => {
    setProcesses((prev) => {
      const completed = prev.filter(
        (p) => p.status === "completed" || p.status === "error",
      )
      if (completed.length > 0) {
        setHistory((h) => {
          const existingIds = new Set(h.map((hp) => hp.id))
          const newItems = completed.filter((c) => !existingIds.has(c.id))
          return [...newItems, ...h]
        })
      }
      return prev.filter(
        (p) => p.status !== "completed" && p.status !== "error",
      )
    })
  }, [])

  const clearHistory = useCallback(() => {
    setHistory([])
  }, [])

  return (
    <ProcessContext.Provider
      value={{
        processes,
        history,
        hasBeenActive,
        addProcess,
        updateProcess,
        updateProcessItem,
        removeProcess,
        clearCompleted,
        clearHistory,
      }}
    >
      {children}
    </ProcessContext.Provider>
  )
}

export function useProcess() {
  const context = useContext(ProcessContext)
  if (context === undefined)
    throw new Error("useProcess must be used within a ProcessProvider")
  return context
}
