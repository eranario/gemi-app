import { useCallback, useState } from "react";
import { FilesService } from "@/client";
import { DataStructureForm, DataTypes, UploadList } from "../components";
import { GeoTiffValidationDialog } from "../components/GeoTiffValidationDialog";

export function UploadData() {
  const [selectedFileType, setSelectedFileType] = useState<string | null>(null);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [pendingValidation, setPendingValidation] = useState<string[]>([]);

  const handleFormChange = (field: string, value: string) => {
    setFormValues((prev) => ({ ...prev, [field]: value }));
  };

  const handleFilesSelected = useCallback(
    async (paths: string[]) => {
      // Only try the first file, and only fill in empty fields
      const firstPath = paths[0];
      if (!firstPath) return;

      try {
        const meta = await FilesService.extractMetadata({
          requestBody: { file_path: firstPath },
        }) as { date?: string; platform?: string; sensor?: string };

        setFormValues((prev) => {
          const next = { ...prev };
          if (meta.date && !next.date) next.date = meta.date;
          if (meta.platform && !next.platform) next.platform = meta.platform;
          if (meta.sensor && !next.sensor) next.sensor = meta.sensor;
          return next;
        });
      } catch {
        // No EXIF available — that's fine, user fills in manually
      }
    },
    [],
  );

  const handleUploadComplete = useCallback(
    (destPaths: string[]) => {
      if (selectedFileType !== "Orthomosaic") return;
      const tifs = destPaths.filter((p) => /\.(tif|tiff)$/i.test(p));
      if (tifs.length > 0) setPendingValidation(tifs);
    },
    [selectedFileType],
  );

  return (
    <div className="bg-background min-h-screen">
      <div className="mx-auto max-w-5xl p-8">
        <div className="space-y-6">
          <DataTypes onChange={setSelectedFileType} />
          <DataStructureForm
            fileType={selectedFileType}
            values={formValues}
            onChange={handleFormChange}
          />
          <UploadList
            dataType={selectedFileType}
            formValues={formValues}
            onFilesSelected={handleFilesSelected}
            onUploadComplete={handleUploadComplete}
          />
        </div>
      </div>

      {pendingValidation.length > 0 && (
        <GeoTiffValidationDialog
          destPaths={pendingValidation}
          onClose={() => setPendingValidation([])}
        />
      )}
    </div>
  );
}
