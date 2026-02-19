import { File, X, ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";
import { UploadZone } from "./UploadZone";
import { Button } from "@/components/ui/button";
import { FilesService } from "@/client";
import { dataLocations } from "@/config/dataLocations";
import { toast } from "sonner";

interface UploadListProps {
  dataType: string | null;
  formValues: Record<string, string>;
}

export function UploadList({ dataType, formValues }: UploadListProps) {
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  const [isExpanded, setIsExpanded] = useState(false);

  const addFiles = (files: FileList | File[]) => {
    setUploadedFiles((prev) => [...prev, ...Array.from(files)]);
  };

  const removeFile = (index: number) => {
    setUploadedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleUploadClick = async () => {
    console.log("Selected dataType: ", dataType);

    if (!dataType) return;

    // check if dataType is available in dataLocations
    const selectedDataType =
      dataLocations["File Upload"][dataType as keyof typeof dataLocations];
    console.log(selectedDataType);

    if (!selectedDataType) {
      console.error(
        "Cannot access data type config or selecting data type error."
      );
      toast.error(
        "Cannot access data type config or selecting data type error."
      );
      return;
    }

    // add Year to formValues given date
    if (formValues["date"]) {
      formValues["year"] = formValues["date"].split("-")[0];
    }

    // setup directory structure
    const dirList = selectedDataType.directory;
    console.log("Defined directory list: ", dirList);
    console.log("Defined input values: ", formValues);

    const targetRootDir = dirList
      .map((field) => formValues[field.toLowerCase()] || field)
      .join("/");
    console.log("Joined directory: ", targetRootDir);

    await FilesService.uploadFiles({
      dataType: dataType, // pull data type
      targetRootDir: "uploads", // pull from predefined config
      formData: { files: uploadedFiles },
    });
  };

  return (
    <div className="space-y-6">
      <UploadZone onFilesAdded={addFiles} />

      {uploadedFiles.length > 0 && (
        <div className="border-border bg-card rounded-lg border p-6">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex w-full items-center justify-between text-left"
          >
            <h3 className="text-foreground">
              Selected Files ({uploadedFiles.length})
            </h3>
            {isExpanded ? (
              <ChevronUp className="text-muted-foreground h-5 w-5" />
            ) : (
              <ChevronDown className="text-muted-foreground h-5 w-5" />
            )}
          </button>

          {isExpanded && (
            <div className="mt-4 max-h-64 space-y-2 overflow-y-auto">
              {uploadedFiles.map((file, index) => (
                <div
                  key={index}
                  className="border-border bg-muted flex items-center justify-between rounded border p-2"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <File className="text-muted-foreground h-4 w-4 flex-shrink-0" />
                    <span className="text-foreground truncate">
                      {file.name}
                    </span>
                    <span className="text-muted-foreground flex-shrink-0 text-sm">
                      ({(file.size / 1024 / 1024).toFixed(2)} MB)
                    </span>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeFile(index);
                    }}
                    className="hover:bg-accent ml-2 flex-shrink-0 rounded p-1"
                  >
                    <X className="text-muted-foreground h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <Button
            variant="outline"
            className="mt-4"
            onClick={handleUploadClick}
          >
            Upload {uploadedFiles.length} file(s)
          </Button>
        </div>
      )}
    </div>
  );
}
