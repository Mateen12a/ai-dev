import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { LayoutDashboard, FolderGit2, Settings, Terminal, Cpu, Rocket, Plus } from "lucide-react";
import { useLocation, Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import type { Project } from "@shared/schema";

const navItems = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Infrastructure", url: "/infrastructure", icon: Cpu },
  { title: "Settings", url: "/settings", icon: Settings },
];

export function AppSidebar() {
  const [location] = useLocation();
  const { data: projects } = useQuery<Project[]>({ queryKey: ["/api/projects"] });

  return (
    <Sidebar>
      <SidebarHeader className="p-4">
        <Link href="/">
          <div className="flex items-center gap-2 cursor-pointer">
            <div className="w-8 h-8 rounded-md bg-primary flex items-center justify-center">
              <Terminal className="w-4 h-4 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-sm font-semibold tracking-tight" data-testid="text-app-name">DevForge AI</h1>
              <p className="text-[10px] text-muted-foreground">AI Development Platform</p>
            </div>
          </div>
        </Link>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild data-active={location === item.url}>
                    <Link href={item.url}>
                      <item.icon className="w-4 h-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <div className="flex items-center justify-between gap-1 px-2">
            <SidebarGroupLabel className="p-0">Projects</SidebarGroupLabel>
            <Link href="/?new=true">
              <Button size="icon" variant="ghost" data-testid="button-new-project-sidebar">
                <Plus className="w-3.5 h-3.5" />
              </Button>
            </Link>
          </div>
          <SidebarGroupContent>
            <SidebarMenu>
              {projects?.map((project) => (
                <SidebarMenuItem key={project.id}>
                  <SidebarMenuButton asChild data-active={location === `/workspace/${project.id}`}>
                    <Link href={`/workspace/${project.id}`}>
                      <FolderGit2 className="w-4 h-4" />
                      <span className="truncate flex-1">{project.name}</span>
                      <Badge variant={
                        project.status === "running" ? "default" :
                        project.status === "deployed" ? "secondary" : "outline"
                      } className="text-[10px] ml-auto">
                        {project.status}
                      </Badge>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-3">
        <div className="flex items-center gap-2 p-2 rounded-md bg-card">
          <Rocket className="w-4 h-4 text-primary" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium">DevForge AI v1.0</p>
            <p className="text-[10px] text-muted-foreground">Build. Test. Deploy.</p>
          </div>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
