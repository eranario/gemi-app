import {
  Folder,
  Home,
  Play,
  ChartSpline,
  Users,
  type LucideIcon,
} from "lucide-react";

export type SubItem = {
  title: string;
  path: string;
};

export type NavItem = {
  icon: LucideIcon;
  title: string;
  path: string;
  subItems?: SubItem[];
};

export const sidebarItems: NavItem[] = [
  { icon: Home, title: "Home", path: "/" },
  {
    icon: Folder,
    title: "Files",
    path: "/files",
    subItems: [
      { title: "Upload Data", path: "/files/upload_data" },
      { title: "Manage Data", path: "/files/manage_data" },
    ],
  },
  {
    icon: Play,
    title: "Process",
    path: "/process",
    subItems: [
      { title: "Generate Mosaic", path: "/process/generate_mosaic" },
      { title: "Set Plots", path: "/process/set_plots" },
      { title: "Extract Traits", path: "/process/extract_traits" },
    ],
  },
  {
    icon: ChartSpline,
    title: "Analyze",
    path: "/analyze",
    subItems: [
      { title: "Statistics", path: "/analyze/statistics" },
      { title: "Map View", path: "/analyze/map_view" },
      { title: "Image Query", path: "/analyze/image_query" },
    ],
  },
];

export const adminItems: NavItem[] = [
  { icon: Users, title: "Admin", path: "/admin" },
];
