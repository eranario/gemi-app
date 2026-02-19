import { useState } from "react";
import { DataStructureForm, DataTypes, UploadList } from "../components";

export function UploadData() {
  const [selectedFileType, setSelectedFileType] = useState<string | null>(null);
  const [formValues, setFormValues] = useState<Record<string, string>>({});

  const handleFormChange = (field: string, value: string) => {
    setFormValues((prev) => ({ ...prev, [field]: value }));
  };

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
          <UploadList dataType={selectedFileType} formValues={formValues} />
        </div>
      </div>
    </div>
  );
}
