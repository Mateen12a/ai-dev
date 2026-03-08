import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  GitBranch, GitCommit, Loader2, RefreshCw, Check,
  Plus, RotateCcw, ChevronDown, ChevronRight, FileCode,
  Layers, Clock, Diff
} from "lucide-react";
import type { GitCommit as GitCommitType } from "@shared/schema";

interface GitPanelProps {
  projectId: string;
}

type GitTab = "changes" | "history" | "diff";

function DiffViewer({ diff }: { diff: string }) {
  if (!diff) return <p className="text-xs text-muted-foreground italic px-1">No diff available</p>;
  const lines = diff.split("\n");
  return (
    <div className="font-mono text-[10px] leading-5 overflow-x-auto">
      {lines.map((line, i) => {
        let cls = "text-muted-foreground";
        if (line.startsWith("+++") || line.startsWith("---")) cls = "text-muted-foreground font-semibold";
        else if (line.startsWith("+")) cls = "text-green-400 bg-green-500/10";
        else if (line.startsWith("-")) cls = "text-red-400 bg-red-500/10";
        else if (line.startsWith("@@")) cls = "text-blue-400 bg-blue-500/10";
        else if (line.startsWith("diff ") || line.startsWith("index ")) cls = "text-primary/70";
        return (
          <div key={i} className={`px-2 whitespace-pre ${cls}`}>{line || " "}</div>
        );
      })}
    </div>
  );
}

export default function GitPanel({ projectId }: GitPanelProps) {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<GitTab>("changes");
  const [commitMessage, setCommitMessage] = useState("");
  const [newBranch, setNewBranch] = useState("");
  const [showBranchInput, setShowBranchInput] = useState(false);
  const [expandedCommit, setExpandedCommit] = useState<string | null>(null);

  const statusQuery = useQuery({
    queryKey: ["/api/projects", projectId, "git", "status"],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/git/status`);
      return res.json() as Promise<{ status: string }>;
    },
    refetchInterval: 8000,
  });

  const logQuery = useQuery({
    queryKey: ["/api/projects", projectId, "git", "log"],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/git/log`);
      return res.json() as Promise<{ commits: GitCommitType[] }>;
    },
  });

  const diffQuery = useQuery({
    queryKey: ["/api/projects", projectId, "git", "diff"],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/git/diff`);
      return res.json() as Promise<{ diff: string }>;
    },
    enabled: activeTab === "diff",
  });

  const branchesQuery = useQuery({
    queryKey: ["/api/projects", projectId, "git", "branches"],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/git/branches`);
      return res.json() as Promise<{ current: string; branches: string[] }>;
    },
  });

  const commitMutation = useMutation({
    mutationFn: async (message: string) => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/git/commit`, { message });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "git"] });
      setCommitMessage("");
      toast({ title: "Committed", description: "Changes saved to history" });
    },
    onError: (err: Error) => toast({ title: "Commit failed", description: err.message, variant: "destructive" }),
  });

  const resetMutation = useMutation({
    mutationFn: async (hash: string) => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/git/reset`, { hash });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "git"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "files"] });
      toast({ title: "Rolled back", description: "Project restored to checkpoint" });
    },
    onError: (err: Error) => toast({ title: "Rollback failed", description: err.message, variant: "destructive" }),
  });

  const branchMutation = useMutation({
    mutationFn: async ({ name, action }: { name: string; action: "create" | "checkout" }) => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/git/branch`, { name, action });
      return res.json();
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "git", "branches"] });
      setNewBranch("");
      setShowBranchInput(false);
      toast({ title: vars.action === "create" ? "Branch created" : `Switched to ${vars.name}` });
    },
    onError: (err: Error) => toast({ title: "Branch action failed", description: err.message, variant: "destructive" }),
  });

  const stashMutation = useMutation({
    mutationFn: async (action: "push" | "pop") => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/git/stash`, { action });
      return res.json();
    },
    onSuccess: (_, action) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "git"] });
      toast({ title: action === "push" ? "Changes stashed" : "Stash popped" });
    },
    onError: (err: Error) => toast({ title: "Stash failed", description: err.message, variant: "destructive" }),
  });

  const statusLines = (statusQuery.data?.status || "").split("\n").filter(Boolean);
  const hasChanges = statusLines.length > 0 && !statusLines[0]?.includes("nothing to commit");
  const changedFiles = statusLines.filter(l => l.trim() && !l.includes("On branch") && !l.includes("nothing to commit"));
  const currentBranch = branchesQuery.data?.current || "main";

  const refreshAll = () => {
    statusQuery.refetch();
    logQuery.refetch();
    diffQuery.refetch();
    branchesQuery.refetch();
  };

  return (
    <div className="h-full flex flex-col" data-testid="panel-git">
      {/* Header */}
      <div className="px-4 py-2 border-b flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <GitBranch className="w-4 h-4 text-primary shrink-0" />
          <span className="text-sm font-semibold">Source Control</span>
          <Badge
            variant="outline"
            className="text-[10px] cursor-pointer hover:bg-muted transition-colors"
            onClick={() => setShowBranchInput(!showBranchInput)}
            data-testid="badge-current-branch"
          >
            {currentBranch}
            <ChevronDown className="w-2.5 h-2.5 ml-1" />
          </Badge>
        </div>
        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={refreshAll} data-testid="button-git-refresh">
          <RefreshCw className="w-3 h-3" />
        </Button>
      </div>

      {/* Branch management */}
      {showBranchInput && (
        <div className="px-4 py-2 border-b bg-muted/30 space-y-2 shrink-0">
          {branchesQuery.data && branchesQuery.data.branches.length > 1 && (
            <div className="space-y-1">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Switch branch</p>
              {branchesQuery.data.branches.filter(b => b !== currentBranch).map(branch => (
                <button
                  key={branch}
                  className="w-full text-left flex items-center gap-2 text-xs px-2 py-1 rounded hover:bg-muted transition-colors"
                  onClick={() => branchMutation.mutate({ name: branch, action: "checkout" })}
                  data-testid={`button-checkout-${branch}`}
                >
                  <GitBranch className="w-3 h-3 text-muted-foreground" /> {branch}
                </button>
              ))}
            </div>
          )}
          <div className="flex gap-1.5">
            <Input
              value={newBranch}
              onChange={e => setNewBranch(e.target.value)}
              placeholder="new-branch-name"
              className="h-6 text-xs flex-1"
              onKeyDown={e => { if (e.key === "Enter" && newBranch.trim()) branchMutation.mutate({ name: newBranch.trim(), action: "create" }); }}
              data-testid="input-new-branch"
            />
            <Button
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={() => newBranch.trim() && branchMutation.mutate({ name: newBranch.trim(), action: "create" })}
              disabled={!newBranch.trim() || branchMutation.isPending}
              data-testid="button-create-branch"
            >
              <Plus className="w-3 h-3" />
            </Button>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b shrink-0">
        {([
          { id: "changes", icon: Layers, label: "Changes", badge: hasChanges ? changedFiles.length : 0 },
          { id: "diff", icon: Diff, label: "Diff" },
          { id: "history", icon: Clock, label: "History", badge: logQuery.data?.commits?.length ?? 0 },
        ] as const).map(tab => (
          <button
            key={tab.id}
            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs font-medium transition-colors border-b-2 ${
              activeTab === tab.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setActiveTab(tab.id)}
            data-testid={`tab-git-${tab.id}`}
          >
            <tab.icon className="w-3 h-3" />
            {tab.label}
            {"badge" in tab && tab.badge > 0 && (
              <span className="min-w-[16px] h-4 rounded-full bg-primary/20 text-primary text-[10px] px-1 flex items-center justify-center">
                {tab.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">

        {/* CHANGES TAB */}
        {activeTab === "changes" && (
          <div className="p-3 space-y-3">
            {statusQuery.isLoading ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Checking status...
              </div>
            ) : !hasChanges ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                <Check className="w-4 h-4 text-green-500" />
                <span>Working tree clean — nothing to commit</span>
              </div>
            ) : (
              <div className="space-y-0.5">
                {changedFiles.slice(0, 20).map((line, i) => {
                  const statusCode = line.substring(0, 2).trim();
                  const filePath = line.substring(3).trim();
                  const color = statusCode.includes("M") ? "text-yellow-400" : statusCode.includes("?") || statusCode.includes("A") ? "text-green-400" : statusCode.includes("D") ? "text-red-400" : "text-muted-foreground";
                  const label = statusCode.includes("M") ? "M" : statusCode.includes("?") ? "U" : statusCode.includes("A") ? "A" : statusCode.includes("D") ? "D" : "?";
                  return (
                    <div key={i} className="flex items-center gap-2 px-1 py-0.5 rounded hover:bg-muted/50 group text-xs">
                      <span className={`font-mono text-[10px] w-4 shrink-0 ${color}`}>{label}</span>
                      <FileCode className="w-3 h-3 shrink-0 text-muted-foreground" />
                      <span className="font-mono truncate flex-1 text-muted-foreground">{filePath}</span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Commit area */}
            <div className="pt-2 border-t space-y-2">
              <Input
                placeholder="Commit message..."
                value={commitMessage}
                onChange={e => setCommitMessage(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && commitMessage.trim()) commitMutation.mutate(commitMessage.trim()); }}
                className="h-7 text-xs"
                data-testid="input-commit-message"
              />
              <div className="flex gap-2">
                <Button
                  className="flex-1 h-7 text-xs"
                  onClick={() => commitMutation.mutate(commitMessage.trim())}
                  disabled={!commitMessage.trim() || commitMutation.isPending}
                  data-testid="button-commit"
                >
                  {commitMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <GitCommit className="w-3 h-3 mr-1" />}
                  Commit
                </Button>
                <Button
                  variant="outline"
                  className="h-7 text-xs px-2"
                  onClick={() => stashMutation.mutate("push")}
                  disabled={stashMutation.isPending}
                  title="Stash changes"
                  data-testid="button-stash"
                >
                  Stash
                </Button>
              </div>
              {stashMutation.isSuccess && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full h-7 text-xs"
                  onClick={() => stashMutation.mutate("pop")}
                  data-testid="button-stash-pop"
                >
                  Pop stash
                </Button>
              )}
            </div>
          </div>
        )}

        {/* DIFF TAB */}
        {activeTab === "diff" && (
          <div className="p-2">
            {diffQuery.isLoading ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground p-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading diff...
              </div>
            ) : !diffQuery.data?.diff ? (
              <p className="text-xs text-muted-foreground p-2 italic">No uncommitted changes to diff</p>
            ) : (
              <DiffViewer diff={diffQuery.data.diff} />
            )}
          </div>
        )}

        {/* HISTORY TAB */}
        {activeTab === "history" && (
          <div className="p-3 space-y-2">
            {logQuery.isLoading ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading history...
              </div>
            ) : (logQuery.data?.commits?.length ?? 0) === 0 ? (
              <div className="text-center py-6">
                <GitCommit className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
                <p className="text-xs text-muted-foreground">No commits yet</p>
                <p className="text-[10px] text-muted-foreground/60 mt-0.5">Switch to Changes tab and commit</p>
              </div>
            ) : (
              <div>
                {logQuery.data?.commits?.map((commit, i) => {
                  const isExpanded = expandedCommit === commit.id;
                  const isFirst = i === 0;
                  return (
                    <div
                      key={commit.id || i}
                      className="relative pl-5 pb-3"
                      data-testid={`item-commit-${commit.id || i}`}
                    >
                      {/* Timeline dot + line */}
                      <div className="absolute left-0 top-1 w-3.5 h-3.5 rounded-full bg-primary/20 border border-primary/40 flex items-center justify-center">
                        <GitCommit className="w-2 h-2 text-primary" />
                      </div>
                      {i < (logQuery.data?.commits?.length || 0) - 1 && (
                        <div className="absolute left-[6px] top-4 bottom-0 w-px bg-border" />
                      )}

                      <div
                        className="cursor-pointer group"
                        onClick={() => setExpandedCommit(isExpanded ? null : (commit.id || `${i}`))}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-xs font-medium group-hover:text-primary transition-colors leading-tight">{commit.message}</p>
                          {isFirst && (
                            <Badge variant="outline" className="text-[9px] px-1 py-0 shrink-0 text-green-500 border-green-500/30">HEAD</Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <code className="text-[10px] text-muted-foreground font-mono">{commit.hash?.substring(0, 7)}</code>
                          <span className="text-[10px] text-muted-foreground">{commit.author}</span>
                          {commit.createdAt && (
                            <span className="text-[10px] text-muted-foreground">{new Date(commit.createdAt).toLocaleDateString()}</span>
                          )}
                          <ChevronRight className={`w-3 h-3 text-muted-foreground transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                        </div>
                      </div>

                      {isExpanded && (
                        <div className="mt-2 pl-1 space-y-1">
                          {commit.files && (
                            <div className="text-[10px] text-muted-foreground font-mono">
                              {commit.files.split(", ").slice(0, 6).map((f, j) => (
                                <div key={j} className="flex items-center gap-1">
                                  <FileCode className="w-2.5 h-2.5 shrink-0" /> {f}
                                </div>
                              ))}
                            </div>
                          )}
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-6 px-2 text-[10px] text-destructive border-destructive/30 hover:bg-destructive/10 w-full"
                            onClick={() => {
                              if (window.confirm(`Roll back to commit "${commit.message}"? This will undo all changes after this point.`)) {
                                resetMutation.mutate(commit.hash || "");
                              }
                            }}
                            disabled={resetMutation.isPending}
                            data-testid={`button-rollback-${commit.id || i}`}
                          >
                            <RotateCcw className="w-2.5 h-2.5 mr-1" />
                            Roll back to this checkpoint
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
