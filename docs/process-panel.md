# Process Panel

A Google Drive-style progress panel fixed in the bottom-right corner that shows real-time progress for background processes.

## Architecture

```
ProcessProvider (React Context — wraps app in main.tsx)
  └── _layout.tsx renders <ProcessPanel />
        └── Shows active/recent processes with per-item status

Backend: SSE endpoint streams per-file progress events
Frontend: fetch() + ReadableStream consumes SSE, updates ProcessContext
```

## Key Files

| File | Purpose |
|------|---------|
| `src/types/process.ts` | Shared type definitions |
| `src/contexts/ProcessContext.tsx` | Global process state management |
| `src/components/ProcessPanel/ProcessPanel.tsx` | Floating panel UI |
| `src/components/ProcessPanel/ProcessItemRow.tsx` | Individual item row |
| `src/features/files/hooks/useFileUpload.ts` | SSE-based upload hook |
| `backend/app/api/routes/files.py` | SSE endpoint (`/copy-local-stream`) |

## Adding a New Process Type

1. Add the type to `ProcessType` in `src/types/process.ts`
2. Create a hook (similar to `useFileUpload.ts`) that:
   - Calls `addProcess()` with items
   - Updates items via `updateProcessItem()` as work progresses
   - Marks the process completed/error via `updateProcess()`
3. The ProcessPanel automatically displays all processes from context

## ProcessContext API

| Method | Description |
|--------|-------------|
| `addProcess(process)` | Add a new process, returns generated ID |
| `updateProcess(id, updates)` | Update process status/title/error |
| `updateProcessItem(processId, itemId, updates)` | Update individual item status |
| `removeProcess(id)` | Immediately remove a process |
| `clearCompleted()` | Remove all completed/errored processes |

Completed/errored processes auto-dismiss after 5 seconds.

## SSE Event Format

The `/api/v1/files/copy-local-stream` endpoint streams `text/event-stream` with:

```
data: {"event": "start", "total": 5, "files": ["a.jpg", ...]}
data: {"event": "progress", "file": "a.jpg", "status": "completed", "index": 0}
data: {"event": "progress", "file": "b.jpg", "status": "skipped", "index": 1}
data: {"event": "error", "file": "c.jpg", "message": "...", "index": 2}
data: {"event": "complete", "uploaded": [...], "skipped": [...], "count": 3}
```
