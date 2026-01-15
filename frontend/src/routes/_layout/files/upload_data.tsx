import { createFileRoute } from "@tanstack/react-router";

import { UploadData } from "@/features/files/pages/upload-data";

export const Route = createFileRoute("/_layout/files/upload_data")({
  component: UploadData,
  head: () => ({
    meta: [
      {
        title: "Upload Data - GEMI",
      },
    ],
  }),
});
