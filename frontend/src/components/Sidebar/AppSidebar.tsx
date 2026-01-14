import { Folder, Home, Play, ChartSpline, Users } from "lucide-react";

import { SidebarAppearance } from "@/components/Common/Appearance";
import { Logo } from "@/components/Common/Logo";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
} from "@/components/ui/sidebar";
import useAuth from "@/hooks/useAuth";
import { type Item, Main } from "./Main";
import { User } from "./User";

const baseItems: Item[] = [
  { icon: Home, title: "Home", path: "/" },
  {
    icon: Folder,
    title: "Files",
    path: "/files",
    subItems: [
      { title: "Upload Data", path: "/files/upload_data" },
      { title: "Manage Data", path: "/files/managa_data" },
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
      { title: "Map View", path: "/process/map_view" },
      { title: "Image Query", path: "/process/image_query" },
    ],
  },
];

export function AppSidebar() {
  const { user: currentUser } = useAuth();

  const items = currentUser?.is_superuser
    ? [...baseItems, { icon: Users, title: "Admin", path: "/admin" }]
    : baseItems;

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="px-4 py-6 group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:items-center">
        <Logo variant="responsive" />
      </SidebarHeader>
      <SidebarContent>
        <Main items={items} />
      </SidebarContent>
      <SidebarFooter>
        <SidebarAppearance />
        <User user={currentUser} />
      </SidebarFooter>
    </Sidebar>
  );
}

export default AppSidebar;
