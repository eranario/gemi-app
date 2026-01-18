import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";

interface DataTypesProps {
  onChange?: (value: string) => void;
}

export function DataTypes({ onChange }: DataTypesProps) {
  const fileTypes = [
    "Image Data",
    "Platform Logs",
    "Farm-ng Binary File",
    "Orthomosaic",
    "Weather Data",
  ];
  const [selectedFileType, setSelectedFileType] = useState<string | null>(null);

  const handleSelect = (type: string) => {
    setSelectedFileType(type);
    onChange?.(type);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">
          {selectedFileType ?? "Select File Type"}
          <ChevronDown className="ml-2 h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {fileTypes.map((type) => (
          <DropdownMenuItem key={type} onClick={() => handleSelect(type)}>
            {type}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
