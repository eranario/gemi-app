import { File, X, ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";
import { UploadZone } from "./UploadZone";
import { Button } from "@/components/ui/button";
import { FilesService } from "@/client";
import { dataTypes } from "@/config/dataTypes";
import { toast } from "sonner";

interface UploadListProps {
  dataType: string | null;
  formValues: Record<string, string>;
}

function fileNameFromPath(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

export function UploadList({ dataType, formValues }: UploadListProps) {
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [isExpanded, setIsExpanded] = useState(false);

  const addFiles = (paths: string[]) => {
    setSelectedPaths((prev) => [...prev, ...paths]);
  };

  const removeFile = (index: number) => {
    setSelectedPaths((prev) => prev.filter((_, i) => i !== index));
  };

  const handleUploadClick = async () => {
    console.log("Selected dataType: ", dataType);

    if (!dataType) return;

    const selectedDataType =
      dataTypes[dataType as keyof typeof dataTypes];
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

    try {
      const values = { ...formValues };

      if (values["date"]) {
        values["year"] = values["date"].split("-")[0];
      }

      const dirList = selectedDataType.directory;
      console.log("Defined directory list: ", dirList);
      console.log("Defined input values: ", values);

      const targetRootDir = dirList
        .map((field) => values[field.toLowerCase()] || field)
        .join("/");
      console.log("Joined directory: ", targetRootDir);

      await FilesService.copyLocalFiles({
        requestBody: {
          file_paths: selectedPaths,
          data_type: dataType,
          target_root_dir: targetRootDir,
        },
      });

      toast.success(`Copied ${selectedPaths.length} file(s) successfully`);
      setSelectedPaths([]);
    } catch (error) {
      console.error("Upload failed:", error);
      toast.error(`Upload failed: ${error instanceof Error ? error.message : error}`)
    }

  };

  return (
    <div className="space-y-6">
      <UploadZone onFilesAdded={addFiles} />

      {selectedPaths.length > 0 && (
        <div className="border-border bg-card rounded-lg border p-6">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex w-full items-center justify-between text-left"
          >
            <h3 className="text-foreground">
              Selected Files ({selectedPaths.length})
            </h3>
            {isExpanded ? (
              <ChevronUp className="text-muted-foreground h-5 w-5" />
            ) : (
              <ChevronDown className="text-muted-foreground h-5 w-5" />
            )}
          </button>

          {isExpanded && (
            <div className="mt-4 max-h-64 space-y-2 overflow-y-auto">
              {selectedPaths.map((filePath, index) => (
                <div
                  key={index}
                  className="border-border bg-muted flex items-center justify-between rounded border p-2"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <File className="text-muted-foreground h-4 w-4 flex-shrink-0" />
                    <span className="text-foreground truncate">
                      {fileNameFromPath(filePath)}
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
            Upload {selectedPaths.length} file(s)
          </Button>
        </div>
      )}
    </div>
  );
}
