import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query"
import { RefreshCw, Search } from "lucide-react"
import { Suspense } from "react"

import { FilesService } from "@/client"
import { DataTable } from "@/components/Common/DataTable"
import PendingItems from "@/components/Pending/PendingItems"
import { LoadingButton } from "@/components/ui/loading-button"
import useCustomToast from "@/hooks/useCustomToast"
import { columns } from "../components/columns"

function getFilesQueryOptions() {
  return {
    queryFn: () => FilesService.readFiles({ skip: 0, limit: 100 }),
    queryKey: ["files"],
  }
}

function ManageDataTableContent() {
  const { data: files } = useSuspenseQuery(getFilesQueryOptions())

  if (files.data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center text-center py-12">
        <div className="rounded-full bg-muted p-4 mb-4">
          <Search className="h-8 w-8 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-semibold">No upload records yet</h3>
        <p className="text-muted-foreground">
          Upload data first, then manage it here
        </p>
      </div>
    )
  }

  return <DataTable columns={columns} data={files.data} />
}

function ManageDataTable() {
  return (
    <Suspense fallback={<PendingItems />}>
      <ManageDataTableContent />
    </Suspense>
  )
}

function SyncButton() {
  const queryClient = useQueryClient()
  const { showSuccessToast } = useCustomToast()

  const mutation = useMutation({
    mutationFn: () => FilesService.syncFiles(),
    onSuccess: (data: { synced: number; removed: number }) => {
      showSuccessToast(
        `Sync complete: ${data.synced} updated, ${data.removed} removed`,
      )
      queryClient.invalidateQueries({ queryKey: ["files"] })
    },
  })

  return (
    <LoadingButton
      variant="outline"
      loading={mutation.isPending}
      onClick={() => mutation.mutate()}
    >
      <RefreshCw className="h-4 w-4" />
      Sync
    </LoadingButton>
  )
}

export function ManageData() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Manage Data</h1>
          <p className="text-muted-foreground">
            View and manage your uploaded data
          </p>
        </div>
        <SyncButton />
      </div>
      <ManageDataTable />
    </div>
  )
}
