import { Link as RouterLink, useRouterState } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import { ChevronRight } from "lucide-react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@radix-ui/react-collapsible";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuSub,
  SidebarMenuSubItem,
  SidebarMenuSubButton,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

export type SubItem = {
  title: string;
  path: string;
};
export type Item = {
  icon: LucideIcon;
  title: string;
  path: string;
  subItems?: SubItem[];
};

interface MainProps {
  items: Item[];
}

export function Main({ items }: MainProps) {
  const { isMobile, setOpenMobile } = useSidebar();
  const router = useRouterState();
  const currentPath = router.location.pathname;

  const handleMenuClick = () => {
    if (isMobile) {
      setOpenMobile(false);
    }
  };

  return (
    <SidebarGroup>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => {
            const isActive = currentPath === item.path;

            return (
              <Collapsible
                asChild
                defaultOpen={false}
                className="group/collapsible"
                key={item.title}
              >
                <SidebarMenuItem>
                  <CollapsibleTrigger asChild>
                    <SidebarMenuButton
                      tooltip={item.title}
                      isActive={isActive}
                      asChild
                    >
                      <RouterLink to={item.path} onClick={handleMenuClick}>
                        <item.icon />
                        <span>{item.title}</span>
                        {item.subItems && (
                          <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                        )}
                      </RouterLink>
                    </SidebarMenuButton>
                  </CollapsibleTrigger>
                  {item.subItems && (
                    <CollapsibleContent>
                      <SidebarMenuSub>
                        {item.subItems.map((subItem) => (
                          <SidebarMenuSubItem key={subItem.title}>
                            <SidebarMenuSubButton asChild>
                              <RouterLink
                                to={subItem.path}
                                onClick={handleMenuClick}
                              >
                                {subItem.title}
                              </RouterLink>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        ))}
                      </SidebarMenuSub>
                    </CollapsibleContent>
                  )}
                </SidebarMenuItem>
              </Collapsible>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
