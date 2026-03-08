import type { Project, Deployment } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Hammer, TestTube2, Rocket, CheckCircle2, XCircle,
  Loader2, Circle, ArrowRight, ExternalLink
} from "lucide-react";
import { motion } from "framer-motion";

interface PipelinePanelProps {
  project: Project;
  deployments: Deployment[];
  onBuild: () => void;
  onTest: () => void;
  onDeploy: () => void;
  isBuildPending: boolean;
  isTestPending: boolean;
  isDeployPending: boolean;
}

const stages = [
  { key: "build", label: "Build", icon: Hammer },
  { key: "test", label: "Test", icon: TestTube2 },
  { key: "deploy", label: "Deploy", icon: Rocket },
] as const;

function StageStatus({ status }: { status: string }) {
  if (status === "running") {
    return <Loader2 className="w-4 h-4 text-primary animate-spin" />;
  }
  if (status === "success") {
    return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
  }
  if (status === "error") {
    return <XCircle className="w-4 h-4 text-red-500" />;
  }
  return <Circle className="w-4 h-4 text-muted-foreground/40" />;
}

export function PipelinePanel({
  project, deployments, onBuild, onTest, onDeploy,
  isBuildPending, isTestPending, isDeployPending
}: PipelinePanelProps) {
  const buildStatus = project.buildStatus || "none";
  const latestDeployment = deployments[0];
  const anyPending = isBuildPending || isTestPending || isDeployPending;

  const stageStatuses: Record<string, string> = {
    build: isBuildPending ? "running" : (buildStatus === "built" || buildStatus === "tested" || buildStatus === "deployed") ? "success" : buildStatus === "error" ? "error" : "none",
    test: isTestPending ? "running" : (buildStatus === "tested" || buildStatus === "deployed") ? "success" : "none",
    deploy: isDeployPending ? "running" : buildStatus === "deployed" ? "success" : "none",
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-2 px-3 py-2 border-b">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Pipeline</span>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-4">
        <div className="flex items-center justify-center gap-2">
          {stages.map((stage, i) => (
            <div key={stage.key} className="flex items-center gap-2">
              <motion.div
                initial={{ scale: 0.9 }}
                animate={{ scale: 1 }}
                className={`flex flex-col items-center gap-1.5 p-3 rounded-lg border min-w-[80px] ${
                  stageStatuses[stage.key] === "running" ? "border-primary bg-primary/5" :
                  stageStatuses[stage.key] === "success" ? "border-emerald-500/30 bg-emerald-500/5" :
                  stageStatuses[stage.key] === "error" ? "border-red-500/30 bg-red-500/5" :
                  "border-border"
                }`}
              >
                <StageStatus status={stageStatuses[stage.key]} />
                <span className="text-[10px] font-medium">{stage.label}</span>
              </motion.div>
              {i < stages.length - 1 && (
                <ArrowRight className="w-4 h-4 text-muted-foreground/40" />
              )}
            </div>
          ))}
        </div>

        <div className="space-y-2">
          <Button
            className="w-full"
            variant={stageStatuses.build === "success" ? "secondary" : "default"}
            onClick={onBuild}
            disabled={anyPending}
            data-testid="button-build"
          >
            {isBuildPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Hammer className="w-4 h-4 mr-2" />}
            {isBuildPending ? "Building..." : stageStatuses.build === "success" ? "Rebuild" : "Build"}
          </Button>
          <Button
            className="w-full"
            variant={stageStatuses.test === "success" ? "secondary" : "default"}
            onClick={onTest}
            disabled={anyPending || stageStatuses.build !== "success"}
            data-testid="button-test"
          >
            {isTestPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <TestTube2 className="w-4 h-4 mr-2" />}
            {isTestPending ? "Testing..." : stageStatuses.test === "success" ? "Re-test" : "Run Tests"}
          </Button>
          <Button
            className="w-full"
            variant={stageStatuses.deploy === "success" ? "secondary" : "default"}
            onClick={onDeploy}
            disabled={anyPending || stageStatuses.test !== "success"}
            data-testid="button-deploy"
          >
            {isDeployPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Rocket className="w-4 h-4 mr-2" />}
            {isDeployPending ? "Deploying..." : stageStatuses.deploy === "success" ? "Redeploy" : "Deploy"}
          </Button>
        </div>

        {latestDeployment && (
          <div className="rounded-lg border p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium">Latest Deployment</span>
              <Badge variant={
                latestDeployment.status === "live" ? "default" :
                latestDeployment.status === "failed" ? "destructive" : "secondary"
              } className="text-[10px]">
                {latestDeployment.status}
              </Badge>
            </div>
            <div className="text-[10px] text-muted-foreground space-y-1">
              <p>Version: {latestDeployment.version}</p>
              <p>{new Date(latestDeployment.createdAt).toLocaleString()}</p>
              {latestDeployment.url && (
                <a
                  href={latestDeployment.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-primary hover:underline"
                  data-testid="link-deployment-url"
                >
                  <ExternalLink className="w-3 h-3" />
                  {latestDeployment.url}
                </a>
              )}
            </div>
          </div>
        )}

        {deployments.length > 1 && (
          <div className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">History</span>
            {deployments.slice(1, 5).map((d) => (
              <div key={d.id} className="flex items-center justify-between gap-2 text-[10px] py-1 px-2 rounded bg-card">
                <span>v{d.version}</span>
                <Badge variant={d.status === "live" ? "default" : "outline"} className="text-[9px]">{d.status}</Badge>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
