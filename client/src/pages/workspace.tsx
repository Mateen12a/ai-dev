import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useParams, useLocation } from "wouter";
import type { Project, ProjectFile } from "@shared/schema";
import { FileExplorer } from "@/components/file-explorer";
import { CodeEditor } from "@/components/code-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import ShellPanel from "@/components/shell-panel";
import SecretsPanel from "@/components/secrets-panel";
import GitPanel from "@/components/git-panel";
import ConsolePanel from "@/components/console-panel";
import AgentPanel from "@/components/agent-panel";
import {
  Files, GitBranch, KeyRound, Rocket, Play, Eye,
  RefreshCw, Loader2, Terminal, Cpu, Square,
  Home, ExternalLink, Globe, Plus, X, Search,
  Database, Lock, Code2, Settings2
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";

type CenterTabKind = "file" | "preview" | "console" | "shell" | "newtab" | "secrets" | "git" | "deploy";

interface CenterTab {
  id: string;
  kind: CenterTabKind;
  label: string;
  fileId?: string;
}

const STATUS_COLORS: Record<string, string> = {
  running: "bg-green-500",
  deployed: "bg-blue-500",
  building: "bg-yellow-500",
  idle: "bg-muted-foreground",
  error: "bg-red-500",
};

const NEW_TAB_TOOLS = [
  { kind: "preview" as CenterTabKind, icon: Globe, label: "Preview", desc: "Preview your running app" },
  { kind: "console" as CenterTabKind, icon: Cpu, label: "Console", desc: "View app logs and output" },
  { kind: "shell" as CenterTabKind, icon: Terminal, label: "Shell", desc: "Run bash commands" },
  { kind: "git" as CenterTabKind, icon: GitBranch, label: "Git", desc: "Source control and commits" },
  { kind: "secrets" as CenterTabKind, icon: Lock, label: "Secrets", desc: "Manage environment variables" },
  { kind: "deploy" as CenterTabKind, icon: Rocket, label: "Deploy", desc: "Publish your app" },
];

export default function Workspace() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const [tabs, setTabs] = useState<CenterTab[]>([{ id: "newtab", kind: "newtab", label: "New tab" }]);
  const [activeTabId, setActiveTabId] = useState<string>("newtab");
  const [previewKey, setPreviewKey] = useState(0);
  const [isEditingName, setIsEditingName] = useState(false);
  const [editNameValue, setEditNameValue] = useState("");
  const [newTabSearch, setNewTabSearch] = useState("");
  const [fileSearch, setFileSearch] = useState("");
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Draggable panel widths
  const [agentWidth, setAgentWidth] = useState(300);
  const [explorerWidth, setExplorerWidth] = useState(260);
  const resizingRef = useRef<{ panel: "agent" | "explorer"; startX: number; startW: number } | null>(null);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!resizingRef.current) return;
      const { panel, startX, startW } = resizingRef.current;
      const delta = e.clientX - startX;
      if (panel === "agent") {
        setAgentWidth(Math.max(220, Math.min(520, startW + delta)));
      } else {
        setExplorerWidth(Math.max(180, Math.min(440, startW - delta)));
      }
    };
    const onUp = () => { resizingRef.current = null; document.body.style.cursor = ""; document.body.style.userSelect = ""; };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
  }, []);

  const { data: project, isLoading } = useQuery<Project>({
    queryKey: ["/api/projects", id],
    refetchInterval: 5000,
  });

  const { data: files = [] } = useQuery<ProjectFile[]>({
    queryKey: ["/api/projects", id, "files"],
  });

  const activeTab = tabs.find(t => t.id === activeTabId) ?? tabs[0];

  const openTab = useCallback((tab: CenterTab) => {
    setTabs(prev => {
      const exists = prev.find(t => t.id === tab.id);
      if (exists) return prev;
      return [...prev.filter(t => t.kind !== "newtab"), tab];
    });
    setActiveTabId(tab.id);
  }, []);

  const openFile = useCallback((file: ProjectFile) => {
    openTab({ id: `file-${file.id}`, kind: "file", label: file.name, fileId: file.id });
  }, [openTab]);

  const openTool = useCallback((kind: CenterTabKind) => {
    const tool = NEW_TAB_TOOLS.find(t => t.kind === kind);
    const label = tool?.label ?? kind;
    openTab({ id: kind, kind, label });
  }, [openTab]);

  const handleOpenAgentConfig = useCallback(async () => {
    const existing = files.find(f => f.name === ".agent.json" || f.path === ".agent.json");
    if (existing) {
      openFile(existing);
      return;
    }
    const defaultConfig = JSON.stringify({ run: "", install: "", description: "" }, null, 2);
    try {
      const res = await apiRequest("POST", `/api/projects/${id}/files`, {
        name: ".agent.json", path: ".agent.json", type: "file", content: defaultConfig, language: "json",
      });
      const created = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/projects", id, "files"] });
      openFile(created);
    } catch (_) {}
  }, [files, id, openFile]);

  const closeTab = useCallback((tabId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setTabs(prev => {
      const next = prev.filter(t => t.id !== tabId);
      if (next.length === 0) return [{ id: "newtab", kind: "newtab", label: "New tab" }];
      return next;
    });
    setActiveTabId(prev => {
      if (prev !== tabId) return prev;
      const idx = tabs.findIndex(t => t.id === tabId);
      const remaining = tabs.filter(t => t.id !== tabId);
      if (remaining.length === 0) return "newtab";
      return remaining[Math.max(0, idx - 1)]?.id ?? remaining[0].id;
    });
  }, [tabs]);

  const openNewTab = useCallback(() => {
    const existing = tabs.find(t => t.kind === "newtab");
    if (existing) {
      setActiveTabId("newtab");
    } else {
      const tab = { id: "newtab", kind: "newtab" as CenterTabKind, label: "New tab" };
      setTabs(prev => [...prev, tab]);
      setActiveTabId("newtab");
    }
    setNewTabSearch("");
  }, [tabs]);

  useEffect(() => {
    if (files.length > 0 && tabs.every(t => t.kind === "newtab")) {
      const first = files.find(f => f.type === "file" && (f.name.includes("index") || f.name.includes("main"))) || files.find(f => f.type === "file");
      if (first) openFile(first);
    }
  }, [files]);

  const saveMutation = useMutation({
    mutationFn: async ({ fileId, content }: { fileId: string; content: string }) => {
      await apiRequest("PATCH", `/api/projects/${id}/files/${fileId}`, { content });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", id, "files"] });
      setPreviewKey(k => k + 1);
    },
  });

  const createFileMutation = useMutation({
    mutationFn: async ({ name, type }: { name: string; type: "file" | "folder" }) => {
      const ext = name.split(".").pop()?.toLowerCase() || "";
      const langMap: Record<string, string> = { ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript", py: "python", go: "go", rs: "rust", json: "json", css: "css", html: "html", md: "markdown" };
      const res = await apiRequest("POST", `/api/projects/${id}/files`, { name: name.split("/").pop()!, path: name, type, content: "", language: langMap[ext] || "plaintext" });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", id, "files"] });
      if (data.type === "file") openFile(data);
    },
  });

  const deleteFileMutation = useMutation({
    mutationFn: async (fileId: string) => {
      await apiRequest("DELETE", `/api/projects/${id}/files/${fileId}`);
    },
    onSuccess: (_, fileId) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", id, "files"] });
      closeTab(`file-${fileId}`);
      toast({ title: "File deleted" });
    },
    onError: () => toast({ title: "Delete failed", variant: "destructive" }),
  });

  const renameFileMutation = useMutation({
    mutationFn: async ({ fileId, newName, oldPath }: { fileId: string; newName: string; oldPath: string }) => {
      const parts = oldPath.split("/");
      parts[parts.length - 1] = newName;
      const newPath = parts.join("/");
      const res = await apiRequest("PATCH", `/api/projects/${id}/files/${fileId}/rename`, { name: newName, path: newPath });
      return res.json();
    },
    onSuccess: (data, { fileId }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", id, "files"] });
      setTabs(prev => prev.map(t => t.fileId === fileId ? { ...t, label: data.name } : t));
    },
    onError: () => toast({ title: "Rename failed", variant: "destructive" }),
  });

  const renameMutation = useMutation({
    mutationFn: async (name: string) => {
      await apiRequest("PATCH", `/api/projects/${id}`, { name });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      setIsEditingName(false);
    },
    onError: () => setIsEditingName(false),
  });

  useEffect(() => {
    if (isEditingName) nameInputRef.current?.select();
  }, [isEditingName]);

  const startEditingName = () => {
    if (!project) return;
    setEditNameValue(project.name);
    setIsEditingName(true);
  };

  const commitNameEdit = () => {
    const trimmed = editNameValue.trim();
    if (!trimmed || trimmed === project?.name) { setIsEditingName(false); return; }
    renameMutation.mutate(trimmed);
  };

  const { data: appStatus } = useQuery<{ running: boolean; status: string; port: number | null }>({
    queryKey: ["/api/projects", id, "status"],
    queryFn: async () => { const res = await fetch(`/api/projects/${id}/status`); return res.json(); },
    refetchInterval: 2000,
    enabled: !!id,
  });

  const buildMutation = useMutation({
    mutationFn: async () => { const res = await apiRequest("POST", `/api/projects/${id}/run`); return res.json(); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", id, "logs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", id, "status"] });
      openTool("console");
    },
    onError: (err: Error) => toast({ title: "Run failed", description: err.message, variant: "destructive" }),
  });

  const stopMutation = useMutation({
    mutationFn: async () => { const res = await apiRequest("POST", `/api/projects/${id}/stop`); return res.json(); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", id, "logs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", id, "status"] });
      setPreviewKey(k => k + 1);
    },
  });

  const deployMutation = useMutation({
    mutationFn: async () => { const res = await apiRequest("POST", `/api/projects/${id}/deploy`); return res.json(); },
    onSuccess: (d) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", id, "logs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      openTool("console");
      toast({ title: "Deployed!", description: d.url });
    },
    onError: (err: Error) => toast({ title: "Deploy failed", description: err.message, variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Loading workspace...</p>
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground">Project not found</p>
        <Button variant="outline" onClick={() => navigate("/")}><Home className="w-4 h-4 mr-2" />Go Home</Button>
      </div>
    );
  }

  const isLaunching = buildMutation.isPending;
  const isAppRunning = appStatus?.running && appStatus?.status === "running";
  const appPort = appStatus?.port;
  const statusDot = isAppRunning ? "bg-green-500 animate-pulse" : (STATUS_COLORS[project.status] || STATUS_COLORS.idle);

  const selectedFileId = activeTab?.kind === "file" ? activeTab.fileId ?? null : null;
  const openFiles = tabs.filter(t => t.kind === "file" && t.fileId).map(t => files.find(f => f.id === t.fileId)).filter(Boolean) as ProjectFile[];
  const selectedFile = selectedFileId ? files.find(f => f.id === selectedFileId) ?? null : null;

  const filteredFiles = fileSearch.trim()
    ? files.filter(f => f.name.toLowerCase().includes(fileSearch.toLowerCase()) || f.path.toLowerCase().includes(fileSearch.toLowerCase()))
    : files;

  const filteredNewTabItems = newTabSearch.trim()
    ? [
        ...NEW_TAB_TOOLS.filter(t => t.label.toLowerCase().includes(newTabSearch.toLowerCase())),
        ...files.filter(f => f.type === "file" && (f.name.toLowerCase().includes(newTabSearch.toLowerCase()) || f.path.toLowerCase().includes(newTabSearch.toLowerCase()))).slice(0, 8).map(f => ({
          kind: "file" as CenterTabKind,
          icon: Code2,
          label: f.name,
          desc: f.path,
          file: f,
        })),
      ]
    : [];

  return (
    <div className="h-full flex flex-col bg-background overflow-hidden" data-testid="workspace">
      {/* TOP BAR */}
      <div className="h-10 flex items-center gap-2 px-3 border-b bg-card/60 backdrop-blur shrink-0">
        <Tooltip>
          <TooltipTrigger asChild>
            <button onClick={() => navigate("/")} className="p-1.5 rounded hover:bg-muted text-muted-foreground" data-testid="button-go-home">
              <Home className="w-4 h-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Home</TooltipContent>
        </Tooltip>

        <span className="text-xs text-muted-foreground">/</span>

        <div className="flex items-center gap-2 min-w-0">
          <div className={`w-2 h-2 rounded-full shrink-0 ${statusDot}`} />
          {isEditingName ? (
            <input
              ref={nameInputRef}
              value={editNameValue}
              onChange={e => setEditNameValue(e.target.value)}
              onBlur={commitNameEdit}
              onKeyDown={e => { if (e.key === "Enter") commitNameEdit(); if (e.key === "Escape") setIsEditingName(false); }}
              className="text-sm font-semibold bg-muted border border-primary rounded px-1.5 py-0.5 outline-none w-40"
              data-testid="input-project-name"
            />
          ) : (
            <span
              className="text-sm font-semibold truncate max-w-[180px] cursor-pointer hover:text-primary/80 transition-colors"
              onClick={startEditingName}
              data-testid="text-workspace-project-name"
            >
              {project.name}
            </span>
          )}
          <Badge variant="outline" className="text-[10px] hidden sm:flex">{project.language}</Badge>
          <Badge variant="outline" className="text-[10px] hidden md:flex">{project.framework}</Badge>
        </div>

        <div className="flex-1" />

        <div className="flex items-center gap-1.5 shrink-0">
          {appPort && (
            <a
              href={`/api/projects/${id}/proxy/`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 px-2 h-7 rounded bg-green-500/15 text-green-500 text-xs font-mono border border-green-500/25 hover:bg-green-500/25 transition-colors"
              data-testid="badge-app-port"
            >
              <Globe className="w-3 h-3" />:{appPort}
            </a>
          )}

          {isAppRunning ? (
            <Button size="sm" variant="destructive" className="h-7 gap-1.5 text-xs" onClick={() => stopMutation.mutate()} disabled={stopMutation.isPending} data-testid="button-stop">
              {stopMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Square className="w-3.5 h-3.5 fill-current" />}
              <span className="hidden sm:inline">Stop</span>
            </Button>
          ) : (
            <Button size="sm" variant="default" className="h-7 gap-1.5 text-xs" onClick={() => buildMutation.mutate()} disabled={isLaunching} data-testid="button-run">
              {isLaunching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
              <span className="hidden sm:inline">{isLaunching ? "Starting..." : "Run"}</span>
            </Button>
          )}

          <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={() => openTool("preview")} data-testid="button-toggle-preview">
            <Eye className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Preview</span>
          </Button>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0"
                onClick={handleOpenAgentConfig}
                data-testid="button-agent-config"
              >
                <Settings2 className="w-3.5 h-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Run config (.agent.json)</TooltipContent>
          </Tooltip>

          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 text-xs"
            onClick={() => { deployMutation.mutate(); }}
            disabled={deployMutation.isPending}
            data-testid="button-deploy"
          >
            <Rocket className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Deploy</span>
          </Button>
        </div>
      </div>

      {/* MAIN AREA — Agent | Center | File Explorer */}
      <div className="flex-1 flex overflow-hidden">

        {/* LEFT: AI Agent */}
        <div
          className="shrink-0 border-r bg-card/20 flex flex-col overflow-hidden"
          style={{ width: agentWidth }}
          data-testid="panel-agent"
        >
          <AgentPanel projectId={id!} />
        </div>

        {/* DRAG HANDLE: Agent | Center */}
        <div
          className="w-1 shrink-0 bg-border/40 hover:bg-primary/50 cursor-col-resize transition-colors group relative z-10"
          onMouseDown={e => {
            resizingRef.current = { panel: "agent", startX: e.clientX, startW: agentWidth };
            document.body.style.cursor = "col-resize";
            document.body.style.userSelect = "none";
            e.preventDefault();
          }}
          data-testid="drag-handle-agent"
          title="Drag to resize"
        />

        {/* CENTER: Tabbed workspace */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          {/* Tab bar */}
          <div className="flex items-center border-b bg-card/30 shrink-0 overflow-x-auto scrollbar-none min-h-[36px]">
            {tabs.map(tab => (
              <div
                key={tab.id}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs border-r border-border/40 cursor-pointer select-none shrink-0 group transition-colors ${
                  tab.id === activeTabId
                    ? "bg-background text-foreground border-b-2 border-b-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                }`}
                onClick={() => setActiveTabId(tab.id)}
                data-testid={`tab-${tab.id}`}
              >
                <TabIcon kind={tab.kind} />
                <span className="max-w-[120px] truncate">{tab.label}</span>
                {tab.kind !== "newtab" && (
                  <button
                    className="opacity-0 group-hover:opacity-100 hover:bg-muted rounded p-0.5 transition-opacity"
                    onClick={e => closeTab(tab.id, e)}
                    data-testid={`close-tab-${tab.id}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            ))}
            <button
              className="px-2.5 py-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors shrink-0"
              onClick={openNewTab}
              data-testid="button-new-tab"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-hidden">
            {activeTab?.kind === "file" && (
              <CodeEditor
                file={selectedFile}
                openFiles={openFiles}
                onSave={(fileId, content) => saveMutation.mutate({ fileId, content })}
                onSelectFile={openFile}
                onCloseFile={(fileId) => closeTab(`file-${fileId}`)}
              />
            )}

            {activeTab?.kind === "newtab" && (
              <NewTabPage
                search={newTabSearch}
                onSearchChange={setNewTabSearch}
                onOpenTool={openTool}
                onOpenFile={openFile}
                filteredItems={filteredNewTabItems}
                tabs={tabs}
                onSwitchTab={setActiveTabId}
              />
            )}

            {activeTab?.kind === "preview" && (
              <div className="h-full flex flex-col bg-background" data-testid="panel-preview">
                <div className="flex items-center gap-2 px-3 py-1.5 border-b bg-card/50 shrink-0">
                  <div className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]" />
                    <div className="w-2.5 h-2.5 rounded-full bg-[#febc2e]" />
                    <div className={`w-2.5 h-2.5 rounded-full ${isAppRunning ? "bg-[#28c840]" : "bg-muted"}`} />
                  </div>
                  <div className="flex-1 mx-2">
                    <div className="bg-muted/60 rounded text-xs text-muted-foreground px-2 py-0.5 font-mono truncate flex items-center gap-1.5">
                      {isAppRunning && appPort ? (
                        <><span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0 animate-pulse" />localhost:{appPort}</>
                      ) : "Not running — click Run ▶"}
                    </div>
                  </div>
                  <button className="p-1 rounded hover:bg-muted text-muted-foreground" onClick={() => setPreviewKey(k => k + 1)} data-testid="button-refresh-preview">
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                  <button className="p-1 rounded hover:bg-muted text-muted-foreground" onClick={() => window.open(`/api/projects/${id}/proxy/`, "_blank")} data-testid="button-open-preview">
                    <ExternalLink className="w-3.5 h-3.5" />
                  </button>
                </div>
                <iframe key={previewKey} src={`/api/projects/${id}/preview`} className="flex-1 w-full border-0" title="App Preview" data-testid="iframe-preview" />
              </div>
            )}

            {activeTab?.kind === "console" && (
              <div className="h-full" data-testid="panel-console">
                <ConsolePanel projectId={id!} />
              </div>
            )}

            {activeTab?.kind === "shell" && (
              <div className="h-full" data-testid="panel-shell">
                <ShellPanel projectId={id!} project={project} />
              </div>
            )}

            {activeTab?.kind === "secrets" && (
              <div className="h-full" data-testid="panel-secrets">
                <SecretsPanel projectId={id!} />
              </div>
            )}

            {activeTab?.kind === "git" && (
              <div className="h-full" data-testid="panel-git">
                <GitPanel projectId={id!} />
              </div>
            )}

            {activeTab?.kind === "deploy" && (
              <div className="h-full" data-testid="panel-deploy-tab">
                <DeployPanel project={project} onDeploy={() => deployMutation.mutate()} isPending={deployMutation.isPending} />
              </div>
            )}
          </div>
        </div>

        {/* DRAG HANDLE: Center | Explorer */}
        <div
          className="w-1 shrink-0 bg-border/40 hover:bg-primary/50 cursor-col-resize transition-colors relative z-10"
          onMouseDown={e => {
            resizingRef.current = { panel: "explorer", startX: e.clientX, startW: explorerWidth };
            document.body.style.cursor = "col-resize";
            document.body.style.userSelect = "none";
            e.preventDefault();
          }}
          data-testid="drag-handle-explorer"
          title="Drag to resize"
        />

        {/* RIGHT: File Explorer with search */}
        <div
          className="shrink-0 border-l bg-card/20 flex flex-col overflow-hidden"
          style={{ width: explorerWidth }}
          data-testid="panel-file-explorer"
        >
          <div className="px-2 py-1.5 border-b bg-card/30 shrink-0">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
              <Input
                value={fileSearch}
                onChange={e => setFileSearch(e.target.value)}
                placeholder="Search files..."
                className="h-7 pl-7 text-xs bg-muted/40 border-0 focus-visible:ring-1"
                data-testid="input-file-search"
              />
            </div>
          </div>
          <div className="flex-1 overflow-hidden">
            {fileSearch.trim() ? (
              <ScrollArea className="h-full">
                <div className="p-2 space-y-0.5">
                  {filteredFiles.filter(f => f.type === "file").map(f => (
                    <button
                      key={f.id}
                      className="w-full text-left flex items-center gap-1.5 px-2 py-1 rounded text-xs hover:bg-muted transition-colors truncate"
                      onClick={() => openFile(f)}
                      data-testid={`file-search-result-${f.id}`}
                    >
                      <Code2 className="w-3 h-3 shrink-0 text-muted-foreground" />
                      <span className="truncate">{f.path}</span>
                    </button>
                  ))}
                  {filteredFiles.filter(f => f.type === "file").length === 0 && (
                    <p className="text-xs text-muted-foreground px-2 py-4 text-center">No files match</p>
                  )}
                </div>
              </ScrollArea>
            ) : (
              <FileExplorer
                files={files}
                selectedFile={selectedFileId}
                onSelectFile={openFile}
                onCreateFile={(path, type) => createFileMutation.mutate({ name: path, type })}
                onDeleteFile={(file) => deleteFileMutation.mutate(file.id)}
                onRenameFile={(file, newName) => renameFileMutation.mutate({ fileId: file.id, newName, oldPath: file.path })}
                onOpenShellAt={(dirPath) => {
                  openTool("shell");
                  setTimeout(() => {
                    window.dispatchEvent(new CustomEvent("shell:cd", { detail: dirPath }));
                  }, 200);
                }}
                projectId={id!}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function TabIcon({ kind }: { kind: CenterTabKind }) {
  switch (kind) {
    case "preview": return <Globe className="w-3 h-3 shrink-0" />;
    case "console": return <Cpu className="w-3 h-3 shrink-0" />;
    case "shell": return <Terminal className="w-3 h-3 shrink-0" />;
    case "git": return <GitBranch className="w-3 h-3 shrink-0" />;
    case "secrets": return <Lock className="w-3 h-3 shrink-0" />;
    case "deploy": return <Rocket className="w-3 h-3 shrink-0" />;
    case "newtab": return <Plus className="w-3 h-3 shrink-0" />;
    default: return <Files className="w-3 h-3 shrink-0" />;
  }
}

function NewTabPage({
  search, onSearchChange, onOpenTool, onOpenFile, filteredItems, tabs, onSwitchTab
}: {
  search: string;
  onSearchChange: (v: string) => void;
  onOpenTool: (kind: CenterTabKind) => void;
  onOpenFile: (f: ProjectFile) => void;
  filteredItems: any[];
  tabs: CenterTab[];
  onSwitchTab: (id: string) => void;
}) {
  const openTabs = tabs.filter(t => t.kind !== "newtab");

  return (
    <div className="h-full flex flex-col bg-background" data-testid="panel-newtab">
      <ScrollArea className="flex-1">
        <div className="max-w-xl mx-auto px-6 py-8 space-y-8">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <input
              value={search}
              onChange={e => onSearchChange(e.target.value)}
              placeholder="Search for tools & files..."
              className="w-full h-10 pl-10 pr-4 rounded-lg bg-muted/50 border border-border text-sm outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-colors"
              autoFocus
              data-testid="input-newtab-search"
            />
          </div>

          {search.trim() ? (
            <div className="space-y-1">
              {filteredItems.map((item: any, i: number) => (
                <button
                  key={i}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-muted/60 transition-colors text-left"
                  onClick={() => {
                    if (item.file) onOpenFile(item.file);
                    else onOpenTool(item.kind);
                  }}
                  data-testid={`newtab-result-${i}`}
                >
                  <div className="w-8 h-8 rounded-md bg-muted flex items-center justify-center shrink-0">
                    <item.icon className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{item.label}</p>
                    <p className="text-xs text-muted-foreground truncate">{item.desc}</p>
                  </div>
                </button>
              ))}
              {filteredItems.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-8">Nothing found</p>
              )}
            </div>
          ) : (
            <>
              {openTabs.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-3 uppercase tracking-wide">Jump to existing tab</p>
                  <div className="space-y-1">
                    {openTabs.map(tab => (
                      <button
                        key={tab.id}
                        className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted/60 transition-colors text-left"
                        onClick={() => onSwitchTab(tab.id)}
                        data-testid={`newtab-jump-${tab.id}`}
                      >
                        <TabIcon kind={tab.kind} />
                        <span className="text-sm truncate">{tab.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <p className="text-xs font-medium text-muted-foreground mb-3 uppercase tracking-wide">Open tool</p>
                <div className="space-y-1">
                  {NEW_TAB_TOOLS.map(tool => (
                    <button
                      key={tool.kind}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-muted/60 transition-colors text-left"
                      onClick={() => onOpenTool(tool.kind)}
                      data-testid={`newtab-tool-${tool.kind}`}
                    >
                      <div className="w-8 h-8 rounded-md bg-muted flex items-center justify-center shrink-0">
                        <tool.icon className="w-4 h-4 text-muted-foreground" />
                      </div>
                      <div>
                        <p className="text-sm font-medium">{tool.label}</p>
                        <p className="text-xs text-muted-foreground">{tool.desc}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function DeployPanel({ project, onDeploy, isPending }: { project: Project; onDeploy: () => void; isPending: boolean }) {
  return (
    <div className="h-full flex flex-col p-4 space-y-4 overflow-y-auto" data-testid="panel-deploy">
      <div>
        <h3 className="text-sm font-semibold">Deploy</h3>
        <p className="text-xs text-muted-foreground mt-1">Publish your app to production</p>
      </div>
      <div className="space-y-2">
        {[
          { label: "Language", value: project.language },
          { label: "Framework", value: project.framework },
          { label: "Status", value: project.buildStatus },
        ].map(({ label, value }) => (
          <div key={label} className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">{label}</span>
            <Badge variant="outline" className="text-[10px]">{value}</Badge>
          </div>
        ))}
      </div>
      {project.deployUrl && (
        <div className="p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
          <p className="text-xs font-medium text-green-600 dark:text-green-400 mb-1">Live URL</p>
          <a href={project.deployUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline break-all font-mono flex items-center gap-1">
            {project.deployUrl}
            <ExternalLink className="w-3 h-3 shrink-0" />
          </a>
        </div>
      )}
      <Button className="w-full" onClick={onDeploy} disabled={isPending} data-testid="button-do-deploy">
        {isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Rocket className="w-4 h-4 mr-2" />}
        {isPending ? "Deploying..." : "Deploy to Production"}
      </Button>
    </div>
  );
}
