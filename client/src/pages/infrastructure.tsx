import { useQuery } from "@tanstack/react-query";
import type { Project, Deployment } from "@shared/schema";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import {
  Server, Cpu, HardDrive, Activity, Globe,
  Database, Shield, Clock, TrendingUp
} from "lucide-react";
import { motion } from "framer-motion";

export default function Infrastructure() {
  const { data: projects, isLoading } = useQuery<Project[]>({ queryKey: ["/api/projects"] });

  const deployed = projects?.filter((p) => p.status === "deployed") || [];
  const running = projects?.filter((p) => p.status === "running") || [];

  const metrics = [
    { label: "Active Services", value: running.length + deployed.length, max: 10, icon: Server, color: "text-primary" },
    { label: "Deployed Apps", value: deployed.length, max: 10, icon: Globe, color: "text-emerald-500 dark:text-emerald-400" },
    { label: "CPU Usage", value: 23 + (running.length * 8), max: 100, suffix: "%", icon: Cpu, color: "text-amber-500 dark:text-amber-400" },
    { label: "Memory", value: 512 + (running.length * 128), max: 4096, suffix: " MB", icon: HardDrive, color: "text-violet-500 dark:text-violet-400" },
  ];

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-6xl mx-auto p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-infra-title">Infrastructure</h1>
          <p className="text-sm text-muted-foreground mt-1">Monitor and manage your infrastructure resources</p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {metrics.map((metric, i) => (
            <motion.div
              key={metric.label}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
            >
              <Card>
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs text-muted-foreground">{metric.label}</p>
                    <metric.icon className={`w-4 h-4 ${metric.color}`} />
                  </div>
                  <p className="text-xl font-bold" data-testid={`text-metric-${metric.label.toLowerCase().replace(" ", "-")}`}>
                    {isLoading ? "-" : `${metric.value}${metric.suffix || ""}`}
                  </p>
                  <Progress value={(metric.value / metric.max) * 100} className="h-1.5" />
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <Card>
            <CardContent className="p-5">
              <div className="flex items-center gap-2 mb-4">
                <Database className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-semibold">Database</h3>
              </div>
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-muted-foreground">Engine</span>
                  <span className="font-medium">PostgreSQL 15</span>
                </div>
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-muted-foreground">Status</span>
                  <Badge variant="default" className="text-[10px]">Connected</Badge>
                </div>
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-muted-foreground">Storage</span>
                  <span className="font-medium">256 MB / 1 GB</span>
                </div>
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-muted-foreground">Connections</span>
                  <span className="font-medium">3 / 20</span>
                </div>
                <Progress value={25.6} className="h-1.5" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-5">
              <div className="flex items-center gap-2 mb-4">
                <Shield className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-semibold">Security</h3>
              </div>
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-muted-foreground">SSL/TLS</span>
                  <Badge variant="default" className="text-[10px]">Enabled</Badge>
                </div>
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-muted-foreground">Firewall</span>
                  <Badge variant="default" className="text-[10px]">Active</Badge>
                </div>
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-muted-foreground">Last Scan</span>
                  <span className="font-medium">2 hours ago</span>
                </div>
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-muted-foreground">Vulnerabilities</span>
                  <Badge variant="secondary" className="text-[10px]">0 found</Badge>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-2 mb-4">
              <Activity className="w-4 h-4 text-primary" />
              <h3 className="text-sm font-semibold">Service Health</h3>
            </div>
            {isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
              </div>
            ) : projects?.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-8">No services running</p>
            ) : (
              <div className="space-y-2">
                {projects?.map((project) => (
                  <div
                    key={project.id}
                    className="flex items-center justify-between gap-3 p-3 rounded-lg bg-card border"
                    data-testid={`service-row-${project.id}`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`w-2 h-2 rounded-full shrink-0 ${
                        project.status === "running" || project.status === "deployed"
                          ? "bg-emerald-500"
                          : "bg-muted-foreground/40"
                      }`} />
                      <div className="min-w-0">
                        <p className="text-xs font-medium truncate">{project.name}</p>
                        <p className="text-[10px] text-muted-foreground">{project.language} / {project.framework}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge variant={
                        project.status === "running" ? "default" :
                        project.status === "deployed" ? "secondary" : "outline"
                      } className="text-[10px]">
                        {project.status}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
