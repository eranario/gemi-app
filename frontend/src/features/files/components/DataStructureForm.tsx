import { FolderTree } from "lucide-react";
import { TextField } from "./TextField";
import { uploadDataTypes } from "./uploadDataTypes";

interface DataStructureFormProps {
  fileType?: string | null;
  values?: {
    experiment?: string;
    location?: string;
    population?: string;
    date?: string;
    platform?: string;
    sensor?: string;
  };
  onChange?: (field: string, value: string) => void;
}

export function DataStructureForm({
  fileType,
  values = {},
  onChange,
}: DataStructureFormProps) {
  // if no file type is selected show this message
  if (!fileType) {
    return (
      <div className="border-border bg-card rounded-lg border p-6">
        <p className="text-muted-foreground">Please select a file type.</p>
      </div>
    );
  }

  // fields for file type
  const config = uploadDataTypes[fileType as keyof typeof uploadDataTypes];
  const fields = config?.fields || [];

  const handleChange = (field: string) => (value: string) => {
    onChange?.(field, value);
  };

  return (
    <div className="border-border bg-card rounded-lg border p-6">
      <div className="mb-4 flex items-center gap-2">
        <FolderTree className="text-card-foreground h-5 w-5" />
        <h2 className="text-foreground">Data Structure</h2>
      </div>

      <div className="space-y-4">
        {fields.map((field) => (
          <TextField
            key={field}
            id={field}
            label={field.charAt(0).toUpperCase() + field.slice(1)}
            type={field === "date" ? "date" : "text"}
            placeholder={`${field}`}
            value={values[field as keyof typeof values]}
            onChange={handleChange(field)}
          />
        ))}
      </div>
    </div>
  );
}
