import { FolderTree } from "lucide-react";
import { TextField } from "./TextField";

interface DataStructureFormProps {
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
  values = {},
  onChange,
}: DataStructureFormProps) {
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
        <TextField
          id="experiment"
          label="Experiment"
          placeholder="e.g., Experiment1"
          value={values.experiment}
          onChange={handleChange("experiment")}
        />

        <TextField
          id="location"
          label="Location"
          placeholder="e.g., Davis"
          value={values.location}
          onChange={handleChange("location")}
        />

        <TextField
          id="population"
          label="Population"
          placeholder="e.g., Cowpea"
          value={values.population}
          onChange={handleChange("population")}
        />

        <TextField
          id="date"
          label="Date"
          type="date"
          value={values.date}
          onChange={handleChange("date")}
        />

        <TextField
          id="platform"
          label="Platform"
          placeholder="e.g., DJI Mavic 4"
          value={values.platform}
          onChange={handleChange("platform")}
        />

        <TextField
          id="sensor"
          label="Sensor"
          placeholder="e.g., Hasselblad"
          value={values.sensor}
          onChange={handleChange("sensor")}
        />
      </div>
    </div>
  );
}
