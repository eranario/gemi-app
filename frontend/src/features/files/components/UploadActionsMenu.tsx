import { EllipsisVertical, Pencil } from "lucide-react"
import { useState } from "react"

import type { FileUploadPublic } from "@/client"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import DeleteUpload from "./DeleteUpload"
import { EditUploadDialog } from "./EditUploadDialog"

interface UploadActionsMenuProps {
  upload: FileUploadPublic
}

export const UploadActionsMenu = ({ upload }: UploadActionsMenuProps) => {
  const [menuOpen, setMenuOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)

  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon">
            <EllipsisVertical />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onClick={() => {
              setMenuOpen(false)
              setEditOpen(true)
            }}
          >
            <Pencil className="mr-2 h-4 w-4" />
            Edit fields
          </DropdownMenuItem>
          <DeleteUpload id={upload.id} onSuccess={() => setMenuOpen(false)} />
        </DropdownMenuContent>
      </DropdownMenu>

      <EditUploadDialog
        upload={upload}
        open={editOpen}
        onClose={() => setEditOpen(false)}
      />
    </>
  )
}
