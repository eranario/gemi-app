import { useState } from "react";
import { DataStructureForm, DataTypes, UploadList } from "../components";

export function UploadData() {
  const [selectedFileType, setSelectedFileType] = useState<string | null>(null);

  return (
    <div className="bg-background min-h-screen">
      <div className="mx-auto max-w-5xl p-8">
        <div className="space-y-6">
          <DataTypes onChange={setSelectedFileType} />
          <DataStructureForm fileType={selectedFileType} />
          <UploadList />
        </div>
      </div>
    </div>
  );
}
