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
  Layers, Clock, Diff, Columns2, AlignJustify
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import type { GitCommit as GitCommitType } from "@shared/schema";

function formatRelativeTime(dateInput: string | Date | null | undefined): string {
  if (!dateInput) return "";
  const date = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  if (isNaN(date.getTime())) return "";
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 4) return `${weeks}w ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(days / 365);
  return `${years}y ago`;
}

interface GitPanelProps {
  projectId: string;
}

type GitTab = "changes" | "history" | "diff";
type DiffViewMode = "unified" | "split";

interface DiffLine {
  type: "header" | "file" | "hunk" | "add" | "remove" | "context" | "index";
  content: string;
  oldLineNum?: number;
  newLineNum?: number;
}

interface DiffFile {
  header: string;
  fileName: string;
  hunks: DiffHunk[];
}

interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

function parseDiff(raw: string): DiffFile[] {
  const files: DiffFile[] = [];
  const rawLines = raw.split("\n");
  let currentFile: DiffFile | null = null;
  let currentHunk: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  for (const line of rawLines) {
    if (line.startsWith("diff --git")) {
      const match = line.match(/diff --git a\/(.+?) b\/(.+)/);
      currentFile = {
        header: line,
        fileName: match ? match[2] : line,
        hunks: [],
      };
      files.push(currentFile);
      currentHunk = null;
    } else if (line.startsWith("index ") || line.startsWith("---") || line.startsWith("+++")) {
      continue;
    } else if (line.startsWith("@@")) {
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      oldLine = match ? parseInt(match[1], 10) : 1;
      newLine = match ? parseInt(match[2], 10) : 1;
      currentHunk = { header: line, lines: [] };
      if (currentFile) currentFile.hunks.push(currentHunk);
    } else if (currentHunk) {
      if (line.startsWith("+")) {
        currentHunk.lines.push({ type: "add", content: line.substring(1), newLineNum: newLine });
        newLine++;
      } else if (line.startsWith("-")) {
        currentHunk.lines.push({ type: "remove", content: line.substring(1), oldLineNum: oldLine });
        oldLine++;
      } else {
        const text = line.startsWith(" ") ? line.substring(1) : line;
        currentHunk.lines.push({ type: "context", content: text, oldLineNum: oldLine, newLineNum: newLine });
        oldLine++;
        newLine++;
      }
    }
  }
  return files;
}

function UnifiedDiffView({ files }: { files: DiffFile[] }) {
  return (
    <div className="space-y-3">
      {files.map((file, fi) => (
        <div key={fi} className="border rounded overflow-hidden">
          <div className="px-3 py-1.5 bg-muted/50 border-b flex items-center gap-2">
            <FileCode className="w-3 h-3 text-muted-foreground shrink-0" />
            <span className="text-xs font-medium font-mono truncate">{file.fileName}</span>
          </div>
          <div className="overflow-x-auto">
            {file.hunks.map((hunk, hi) => (
              <div key={hi}>
                <div className="px-3 py-0.5 bg-blue-500/10 text-blue-400 text-[10px] font-mono border-b border-blue-500/10">
                  {hunk.header}
                </div>
                {hunk.lines.map((line, li) => {
                  const bgClass =
                    line.type === "add" ? "bg-green-500/10" :
                    line.type === "remove" ? "bg-red-500/10" : "";
                  const textClass =
                    line.type === "add" ? "text-green-400" :
                    line.type === "remove" ? "text-red-400" : "text-muted-foreground";
                  const prefix =
                    line.type === "add" ? "+" :
                    line.type === "remove" ? "-" : " ";
                  return (
                    <div key={li} className={`flex font-mono text-[10px] leading-5 ${bgClass} border-b border-transparent hover:bg-muted/30`}>
                      <span className="w-10 shrink-0 text-right pr-1.5 text-muted-foreground/50 select-none border-r border-border/30">
                        {line.oldLineNum ?? ""}
                      </span>
                      <span className="w-10 shrink-0 text-right pr-1.5 text-muted-foreground/50 select-none border-r border-border/30">
                        {line.newLineNum ?? ""}
                      </span>
                      <span className={`w-4 shrink-0 text-center select-none ${textClass}`}>{prefix}</span>
                      <span className={`whitespace-pre flex-1 pr-2 ${textClass}`}>{line.content || " "}</span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function SplitDiffView({ files }: { files: DiffFile[] }) {
  return (
    <div className="space-y-3">
      {files.map((file, fi) => (
        <div key={fi} className="border rounded overflow-hidden">
          <div className="px-3 py-1.5 bg-muted/50 border-b flex items-center gap-2">
            <FileCode className="w-3 h-3 text-muted-foreground shrink-0" />
            <span className="text-xs font-medium font-mono truncate">{file.fileName}</span>
          </div>
          <div className="overflow-x-auto">
            {file.hunks.map((hunk, hi) => {
              const leftLines: (DiffLine | null)[] = [];
              const rightLines: (DiffLine | null)[] = [];
              let i = 0;
              const lines = hunk.lines;
              while (i < lines.length) {
                if (lines[i].type === "context") {
                  leftLines.push(lines[i]);
                  rightLines.push(lines[i]);
                  i++;
                } else {
                  const removes: DiffLine[] = [];
                  const adds: DiffLine[] = [];
                  while (i < lines.length && lines[i].type === "remove") {
                    removes.push(lines[i]);
                    i++;
                  }
                  while (i < lines.length && lines[i].type === "add") {
                    adds.push(lines[i]);
                    i++;
                  }
                  const maxLen = Math.max(removes.length, adds.length);
                  for (let j = 0; j < maxLen; j++) {
                    leftLines.push(j < removes.length ? removes[j] : null);
                    rightLines.push(j < adds.length ? adds[j] : null);
                  }
                }
              }

              return (
                <div key={hi}>
                  <div className="px-3 py-0.5 bg-blue-500/10 text-blue-400 text-[10px] font-mono border-b border-blue-500/10">
                    {hunk.header}
                  </div>
                  {leftLines.map((left, li) => {
                    const right = rightLines[li];
                    return (
                      <div key={li} className="flex font-mono text-[10px] leading-5">
                        <div className={`flex-1 flex min-w-0 border-r border-border/30 ${
                          left?.type === "remove" ? "bg-red-500/10" : left === null ? "bg-muted/20" : ""
                        }`}>
                          <span className="w-8 shrink-0 text-right pr-1 text-muted-foreground/50 select-none border-r border-border/30">
                            {left?.oldLineNum ?? left?.newLineNum ?? ""}
                          </span>
                          <span className={`whitespace-pre flex-1 px-1 truncate ${
                            left?.type === "remove" ? "text-red-400" : left === null ? "" : "text-muted-foreground"
                          }`}>
                            {left?.content || " "}
                          </span>
                        </div>
                        <div className={`flex-1 flex min-w-0 ${
                          right?.type === "add" ? "bg-green-500/10" : right === null ? "bg-muted/20" : ""
                        }`}>
                          <span className="w-8 shrink-0 text-right pr-1 text-muted-foreground/50 select-none border-r border-border/30">
                            {right?.newLineNum ?? right?.oldLineNum ?? ""}
                          </span>
                          <span className={`whitespace-pre flex-1 px-1 truncate ${
                            right?.type === "add" ? "text-green-400" : right === null ? "" : "text-muted-foreground"
                          }`}>
                            {right?.content || " "}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function DiffViewer({ diff }: { diff: string }) {
  const [viewMode, setViewMode] = useState<DiffViewMode>("unified");

  if (!diff) return <p className="text-xs text-muted-foreground italic px-1">No diff available</p>;

  const files = parseDiff(diff);

  if (files.length === 0) {
    return <p className="text-xs text-muted-foreground italic px-1">No parseable diff content</p>;
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between px-1">
        <span className="text-[10px] text-muted-foreground">
          {files.length} file{files.length !== 1 ? "s" : ""} changed
        </span>
        <div className="flex items-center gap-0.5 border rounded p-0.5">
          <button
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] transition-colors ${
              viewMode === "unified" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setViewMode("unified")}
            title="Unified view"
          >
            <AlignJustify className="w-3 h-3" />
            Unified
          </button>
          <button
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] transition-colors ${
              viewMode === "split" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setViewMode("split")}
            title="Split view"
          >
            <Columns2 className="w-3 h-3" />
            Split
          </button>
        </div>
      </div>
      {viewMode === "unified" ? (
        <UnifiedDiffView files={files} />
      ) : (
        <SplitDiffView files={files} />
      )}
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
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-2 px-1">
                    <Skeleton className="h-3 w-4 shrink-0" />
                    <Skeleton className="h-3 w-3 shrink-0" />
                    <Skeleton className="h-3" style={{ width: `${Math.random() * 30 + 50}%` }} />
                  </div>
                ))}
                <div className="pt-3 border-t space-y-2">
                  <Skeleton className="h-7 w-full" />
                  <div className="flex gap-2">
                    <Skeleton className="h-7 flex-1" />
                    <Skeleton className="h-7 w-16" />
                  </div>
                </div>
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
              <div className="p-2 space-y-2">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-3 w-32" />
                </div>
                {Array.from({ length: 12 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Skeleton className="h-3 w-6 shrink-0" />
                    <Skeleton className="h-3" style={{ width: `${Math.random() * 50 + 25}%` }} />
                  </div>
                ))}
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
          <div className="p-3">
            {logQuery.isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="relative pl-5 pb-3">
                    <Skeleton className="absolute left-0 top-1 w-3.5 h-3.5 rounded-full" />
                    {i < 3 && <div className="absolute left-[6px] top-4 bottom-0 w-px bg-border" />}
                    <div className="space-y-1.5">
                      <Skeleton className="h-3 w-3/4" />
                      <div className="flex items-center gap-2">
                        <Skeleton className="h-2.5 w-14" />
                        <Skeleton className="h-2.5 w-16" />
                        <Skeleton className="h-2.5 w-20" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (logQuery.data?.commits?.length ?? 0) === 0 ? (
              <div className="text-center py-8">
                <div className="w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center mx-auto mb-3">
                  <GitCommit className="w-6 h-6 text-muted-foreground/40" />
                </div>
                <p className="text-sm text-muted-foreground font-medium">No checkpoints yet</p>
                <p className="text-[11px] text-muted-foreground/60 mt-1">Switch to Changes tab to create your first checkpoint</p>
              </div>
            ) : (
              <div className="relative">
                <div className="absolute left-[11px] top-3 bottom-3 w-[2px] bg-gradient-to-b from-primary/40 via-border to-border/30 rounded-full" />

                {logQuery.data?.commits?.map((commit, i) => {
                  const isExpanded = expandedCommit === commit.id;
                  const isFirst = i === 0;
                  const isLast = i === (logQuery.data?.commits?.length || 0) - 1;
                  const relTime = formatRelativeTime(commit.createdAt);

                  return (
                    <div
                      key={commit.id || i}
                      className={`relative pl-8 ${isLast ? "" : "pb-4"}`}
                      data-testid={`item-commit-${commit.id || i}`}
                    >
                      <div className={`absolute left-0 top-0.5 w-6 h-6 rounded-full flex items-center justify-center z-10 transition-colors ${
                        isFirst
                          ? "bg-primary text-primary-foreground shadow-md shadow-primary/25"
                          : "bg-background border-2 border-primary/30 text-primary/60"
                      }`}>
                        <GitCommit className={`${isFirst ? "w-3 h-3" : "w-2.5 h-2.5"}`} />
                      </div>

                      <div
                        className={`rounded-lg border p-2.5 transition-all cursor-pointer group ${
                          isFirst
                            ? "border-primary/20 bg-primary/5 hover:bg-primary/10"
                            : "border-transparent hover:border-border hover:bg-muted/40"
                        }`}
                        onClick={() => setExpandedCommit(isExpanded ? null : (commit.id || `${i}`))}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="text-xs font-medium group-hover:text-primary transition-colors leading-tight truncate">
                                {commit.message}
                              </p>
                              {isFirst && (
                                <Badge variant="outline" className="text-[9px] px-1.5 py-0 shrink-0 text-green-500 border-green-500/30 bg-green-500/5">
                                  HEAD
                                </Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-2 mt-1">
                              <code className="text-[10px] text-primary/60 font-mono bg-primary/5 px-1 rounded">
                                {commit.hash?.substring(0, 7)}
                              </code>
                              {commit.author && (
                                <span className="text-[10px] text-muted-foreground truncate">{commit.author}</span>
                              )}
                              {relTime && (
                                <span className="text-[10px] text-muted-foreground/70 shrink-0 flex items-center gap-0.5">
                                  <Clock className="w-2.5 h-2.5" />
                                  {relTime}
                                </span>
                              )}
                              <ChevronRight className={`w-3 h-3 text-muted-foreground/50 transition-transform ml-auto shrink-0 ${isExpanded ? "rotate-90" : ""}`} />
                            </div>
                          </div>
                        </div>

                        {!isFirst && !isExpanded && (
                          <div className="mt-1.5">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-5 px-2 text-[10px] text-muted-foreground hover:text-primary"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (window.confirm(`Restore to checkpoint "${commit.message}"? This will undo all changes after this point.`)) {
                                  resetMutation.mutate(commit.hash || "");
                                }
                              }}
                              disabled={resetMutation.isPending}
                              data-testid={`button-restore-${commit.id || i}`}
                            >
                              <RotateCcw className="w-2.5 h-2.5 mr-1" />
                              Restore
                            </Button>
                          </div>
                        )}

                        {isExpanded && (
                          <div className="mt-2 pt-2 border-t border-border/50 space-y-2">
                            {commit.createdAt && (
                              <div className="text-[10px] text-muted-foreground">
                                {new Date(commit.createdAt).toLocaleString()}
                              </div>
                            )}
                            {commit.files && (
                              <div className="space-y-0.5">
                                <p className="text-[10px] text-muted-foreground/70 uppercase tracking-wide font-medium">Changed files</p>
                                <div className="text-[10px] text-muted-foreground font-mono">
                                  {commit.files.split(", ").slice(0, 8).map((f, j) => (
                                    <div key={j} className="flex items-center gap-1.5 py-0.5">
                                      <FileCode className="w-2.5 h-2.5 shrink-0 text-primary/50" /> {f}
                                    </div>
                                  ))}
                                  {commit.files.split(", ").length > 8 && (
                                    <p className="text-muted-foreground/50 italic mt-0.5">+{commit.files.split(", ").length - 8} more files</p>
                                  )}
                                </div>
                              </div>
                            )}
                            {!isFirst && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 px-3 text-[11px] text-destructive border-destructive/30 hover:bg-destructive/10 w-full"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (window.confirm(`Restore to checkpoint "${commit.message}"? This will undo all changes after this point.`)) {
                                    resetMutation.mutate(commit.hash || "");
                                  }
                                }}
                                disabled={resetMutation.isPending}
                                data-testid={`button-rollback-${commit.id || i}`}
                              >
                                <RotateCcw className="w-3 h-3 mr-1.5" />
                                Restore to this checkpoint
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
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
