import { DataStructureForm } from "../components";
import { UploadList } from "../components";
import { DataTypes } from "../components";

export function UploadData() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-5xl p-8">
        <div className="space-y-6">
          <DataTypes />
          <DataStructureForm />
          <UploadList />
        </div>
      </div>
    </div>
  );
}
