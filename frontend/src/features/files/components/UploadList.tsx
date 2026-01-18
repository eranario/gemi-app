import { File, X } from "lucide-react";
import { useState } from "react";
import { UploadZone } from "./UploadZone";
import { Button } from "@/components/ui/button";

export function UploadList() {
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);

  const addFiles = (files: FileList | File[]) => {
    setUploadedFiles((prev) => [...prev, ...Array.from(files)]);
  };

  const removeFile = (index: number) => {
    setUploadedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-6">
      <UploadZone onFilesAdded={addFiles} />

      {uploadedFiles.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white p-6">
          <h3 className="mb-4 text-gray-900">
            Selected Files ({uploadedFiles.length})
          </h3>
          <div className="max-h-64 space-y-2 overflow-y-auto">
            {uploadedFiles.map((file, index) => (
              <div
                key={index}
                className="flex items-center justify-between rounded border border-gray-200 bg-gray-50 p-2"
              >
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <File className="h-4 w-4 flex-shrink-0 text-gray-500" />
                  <span className="truncate text-gray-700">{file.name}</span>
                  <span className="flex-shrink-0 text-sm text-gray-500">
                    ({(file.size / 1024 / 1024).toFixed(2)} MB)
                  </span>
                </div>
                <button
                  onClick={() => removeFile(index)}
                  className="ml-2 flex-shrink-0 rounded p-1 hover:bg-gray-200"
                >
                  <X className="h-4 w-4 text-gray-600" />
                </button>
              </div>
            ))}
            <Button variant="outline" className="mt-4">
              Upload {uploadedFiles.length} files(s)
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
