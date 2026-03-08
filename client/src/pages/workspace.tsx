import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useParams, useLocation } from "wouter";
import type { Project, ProjectFile } from "@shared/schema";
import { FileExplorer } from "@/components/file-explorer";
import { CodeEditor, type EditorContext } from "@/components/code-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import ShellPanel from "@/components/shell-panel";
import SecretsPanel from "@/components/secrets-panel";
import GitPanel from "@/components/git-panel";
import ConsolePanel from "@/components/console-panel";
import AgentPanel from "@/components/agent-panel";
import DatabasePanel from "@/components/database-panel";
import PackagePanel from "@/components/package-panel";
import {
  Files, GitBranch, KeyRound, Rocket, Play, Eye,
  RefreshCw, Loader2, Terminal, Cpu, Square,
  Home, ExternalLink, Globe, Plus, X, Search,
  Database, Lock, Code2, Settings2, RotateCcw, ScrollText,
  Folder, HelpCircle, Sun, Moon, Package
} from "lucide-react";
import { useTheme } from "@/components/theme-provider";
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Sheet, SheetContent, SheetTrigger,
} from "@/components/ui/sheet";
import { Menu, MessageSquare, PanelRight, Monitor, Tablet, Smartphone, ArrowLeft, ArrowRight, ChevronRight } from "lucide-react";
import { GlobalSearch } from "@/components/global-search";

type CenterTabKind = "file" | "preview" | "console" | "shell" | "newtab" | "secrets" | "git" | "deploy" | "database" | "packages";

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
  { kind: "database" as CenterTabKind, icon: Database, label: "Database", desc: "View tables and run queries" },
  { kind: "packages" as CenterTabKind, icon: Package, label: "Packages", desc: "Manage npm dependencies" },
  { kind: "deploy" as CenterTabKind, icon: Rocket, label: "Deploy", desc: "Publish your app" },
];

export default function Workspace() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const [tabs, setTabs] = useState<CenterTab[]>(() => {
    try {
      const saved = localStorage.getItem(`workspace-tabs-${id}`);
      if (saved) {
        const parsed = JSON.parse(saved) as CenterTab[];
        if (Array.isArray(parsed) && parsed.length > 0 && parsed.every(t => t.id && t.kind && t.label)) return parsed;
      }
    } catch (_) {}
    return [{ id: "newtab", kind: "newtab", label: "New tab" }];
  });
  const [activeTabId, setActiveTabId] = useState<string>(() => {
    try {
      const saved = localStorage.getItem(`workspace-activeTab-${id}`);
      const tabsSaved = localStorage.getItem(`workspace-tabs-${id}`);
      if (saved && tabsSaved) {
        const parsed = JSON.parse(tabsSaved) as CenterTab[];
        if (Array.isArray(parsed) && parsed.some(t => t.id === saved)) return saved;
      }
    } catch (_) {}
    return "newtab";
  });
  const [previewKey, setPreviewKey] = useState(0);
  const [isRestarting, setIsRestarting] = useState(false);
  const prevRunningRef = useRef<boolean | undefined>(undefined);
  const [isEditingName, setIsEditingName] = useState(false);
  const [editNameValue, setEditNameValue] = useState("");
  const [newTabSearch, setNewTabSearch] = useState("");
  const [fileSearch, setFileSearch] = useState("");
  const nameInputRef = useRef<HTMLInputElement>(null);
  const { theme, toggleTheme } = useTheme();
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [mobileAgentOpen, setMobileAgentOpen] = useState(false);
  const [mobileFilesOpen, setMobileFilesOpen] = useState(false);
  const [editorContext, setEditorContext] = useState<EditorContext>({
    activeFile: null,
    activeFilePath: null,
    selection: null,
    cursorLine: null,
    fileContent: null,
  });
  const agentInputRef = useRef<{ setInput: (text: string) => void } | null>(null);
  const [autoReloadPreview, setAutoReloadPreview] = useState(true);
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
      if (e.key === "?" && !isInput) {
        e.preventDefault();
        setShowShortcuts(true);
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "F") {
        e.preventDefault();
        setGlobalSearchOpen(true);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

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

  const { data: files = [], isLoading: filesLoading } = useQuery<ProjectFile[]>({
    queryKey: ["/api/projects", id, "files"],
  });

  const { data: runtimeInfo } = useQuery<{
    language: string;
    framework: string;
    version: string | null;
    runCommand: string;
    installCommand: string | null;
    entryPoint: string | null;
    icon: string;
  }>({
    queryKey: ["/api/projects", id, "runtime"],
    enabled: !!id,
    staleTime: 30000,
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

  useEffect(() => {
    try {
      localStorage.setItem(`workspace-tabs-${id}`, JSON.stringify(tabs));
      localStorage.setItem(`workspace-activeTab-${id}`, activeTabId);
    } catch (_) {}
  }, [tabs, activeTabId, id]);

  const saveMutation = useMutation({
    mutationFn: async ({ fileId, content }: { fileId: string; content: string }) => {
      await apiRequest("PATCH", `/api/projects/${id}/files/${fileId}`, { content });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", id, "files"] });
      if (autoReloadPreview) {
        setPreviewKey(k => k + 1);
      }
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

  useEffect(() => {
    const isNowRunning = appStatus?.running && appStatus?.status === "running" && !!appStatus?.port;
    const wasRunning = prevRunningRef.current;
    prevRunningRef.current = !!isNowRunning;

    if (isNowRunning && wasRunning === false) {
      openTool("preview");
      const timer = setTimeout(() => setPreviewKey(k => k + 1), 800);
      return () => clearTimeout(timer);
    }
  }, [appStatus, openTool]);

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

  const handleRestartServer = useCallback(async () => {
    setIsRestarting(true);
    try {
      await apiRequest("POST", `/api/projects/${id}/stop`);
      await new Promise(resolve => setTimeout(resolve, 500));
      await apiRequest("POST", `/api/projects/${id}/run`);
      queryClient.invalidateQueries({ queryKey: ["/api/projects", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", id, "logs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", id, "status"] });
      setTimeout(() => {
        setPreviewKey(k => k + 1);
        setIsRestarting(false);
      }, 1500);
    } catch (err: any) {
      toast({ title: "Restart failed", description: err.message, variant: "destructive" });
      setIsRestarting(false);
    }
  }, [id, toast]);

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
      <div className="h-10 flex items-center gap-2 px-2 md:px-3 border-b bg-card/60 backdrop-blur shrink-0">
        <button
          onClick={() => setMobileAgentOpen(true)}
          className="p-1.5 rounded hover:bg-muted text-muted-foreground md:hidden"
          data-testid="button-mobile-agent"
        >
          <MessageSquare className="w-4 h-4" />
        </button>

        <Tooltip>
          <TooltipTrigger asChild>
            <button onClick={() => navigate("/")} className="p-1.5 rounded hover:bg-muted text-muted-foreground hidden md:flex" data-testid="button-go-home">
              <Home className="w-4 h-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Home</TooltipContent>
        </Tooltip>

        <span className="text-xs text-muted-foreground hidden md:inline">/</span>

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
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="outline" className="text-[10px] hidden sm:flex gap-1">
                {runtimeInfo?.icon || ""} {runtimeInfo?.language || project.language}
              </Badge>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <div className="text-xs space-y-0.5">
                <div>Runtime: {runtimeInfo?.language || project.language}/{runtimeInfo?.framework || project.framework}</div>
                {runtimeInfo?.version && <div>Version: {runtimeInfo.version}</div>}
                {runtimeInfo?.entryPoint && <div>Entry: {runtimeInfo.entryPoint}</div>}
                {runtimeInfo?.runCommand && <div>Run: {runtimeInfo.runCommand}</div>}
              </div>
            </TooltipContent>
          </Tooltip>
          <Badge variant="outline" className="text-[10px] hidden md:flex">{runtimeInfo?.framework || project.framework}</Badge>
        </div>

        <div className="flex-1" />

        <div className="flex items-center gap-1.5 shrink-0">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="p-1.5 rounded hover:bg-muted text-muted-foreground transition-colors"
                onClick={() => setGlobalSearchOpen(true)}
                data-testid="button-global-search"
              >
                <Search className="w-3.5 h-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Search across files (Ctrl+Shift+F)</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="p-1.5 rounded hover:bg-muted text-muted-foreground transition-colors"
                onClick={toggleTheme}
                data-testid="button-toggle-theme"
              >
                {theme === "dark" ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{theme === "dark" ? "Light mode" : "Dark mode"}</TooltipContent>
          </Tooltip>

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

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0"
                onClick={() => setShowShortcuts(true)}
                data-testid="button-keyboard-shortcuts"
              >
                <HelpCircle className="w-3.5 h-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Keyboard shortcuts (?)</TooltipContent>
          </Tooltip>

          <button
            onClick={() => setMobileFilesOpen(true)}
            className="p-1.5 rounded hover:bg-muted text-muted-foreground md:hidden"
            data-testid="button-mobile-files"
          >
            <PanelRight className="w-4 h-4" />
          </button>

          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 text-xs hidden md:flex"
            onClick={() => { deployMutation.mutate(); }}
            disabled={deployMutation.isPending}
            data-testid="button-deploy"
          >
            <Rocket className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Deploy</span>
          </Button>
        </div>
      </div>

      {/* Mobile Agent Sheet */}
      <Sheet open={mobileAgentOpen} onOpenChange={setMobileAgentOpen}>
        <SheetContent side="left" className="w-[85vw] max-w-[360px] p-0 md:hidden">
          <AgentPanel projectId={id!} editorContext={editorContext} ref={agentInputRef} />
        </SheetContent>
      </Sheet>

      {/* Mobile File Explorer Sheet */}
      <Sheet open={mobileFilesOpen} onOpenChange={setMobileFilesOpen}>
        <SheetContent side="right" className="w-[85vw] max-w-[320px] p-0 md:hidden">
          <div className="flex flex-col h-full">
            <div className="px-2 py-1.5 border-b bg-card/30 shrink-0">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                <Input
                  value={fileSearch}
                  onChange={e => setFileSearch(e.target.value)}
                  placeholder="Search files..."
                  className="h-7 pl-7 text-xs bg-muted/40 border-0 focus-visible:ring-1"
                />
              </div>
            </div>
            <div className="flex-1 overflow-hidden">
              <FileExplorer
                files={files}
                selectedFile={selectedFileId}
                onSelectFile={(f) => { openFile(f); setMobileFilesOpen(false); }}
                onCreateFile={(path, type) => createFileMutation.mutate({ name: path, type })}
                onDeleteFile={(file) => deleteFileMutation.mutate(file.id)}
                onRenameFile={(file, newName) => renameFileMutation.mutate({ fileId: file.id, newName, oldPath: file.path })}
                onOpenShellAt={(dirPath) => {
                  openTool("shell");
                  setMobileFilesOpen(false);
                }}
                projectId={id!}
              />
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* MAIN AREA — Agent | Center | File Explorer */}
      <div className="flex-1 flex overflow-hidden">

        {/* LEFT: AI Agent (hidden on mobile) */}
        <div
          className="shrink-0 border-r bg-card/20 flex-col overflow-hidden hidden md:flex"
          style={{ width: agentWidth }}
          data-testid="panel-agent"
        >
          <AgentPanel projectId={id!} editorContext={editorContext} ref={agentInputRef} />
        </div>

        {/* DRAG HANDLE: Agent | Center (hidden on mobile) */}
        <div
          className="w-1 shrink-0 bg-border/40 hover:bg-primary/50 cursor-col-resize transition-colors group relative z-10 hidden md:block"
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

          {activeTab?.kind === "file" && selectedFile && (
            <div className="flex items-center px-3 py-1 border-b bg-card/20 shrink-0 min-h-[28px]">
              <Breadcrumb>
                <BreadcrumbList className="text-xs gap-1 sm:gap-1.5">
                  {(() => {
                    const filePath = selectedFile.path || selectedFile.name;
                    const segments = filePath.split("/").filter(Boolean);
                    return segments.flatMap((segment, index) => {
                      const isLast = index === segments.length - 1;
                      const partialPath = segments.slice(0, index + 1).join("/");
                      const items: React.ReactNode[] = [];
                      if (index > 0) {
                        items.push(<BreadcrumbSeparator key={`sep-${partialPath}`} className="[&>svg]:w-3 [&>svg]:h-3" />);
                      }
                      items.push(
                        <BreadcrumbItem key={partialPath}>
                          {isLast ? (
                            <BreadcrumbPage className="text-xs flex items-center gap-1">
                              <Code2 className="w-3 h-3" />
                              {segment}
                            </BreadcrumbPage>
                          ) : (
                            <BreadcrumbLink
                              className="text-xs cursor-pointer flex items-center gap-1 hover:text-foreground"
                              onClick={() => {
                                const dirFile = files.find(
                                  f => f.type === "folder" && (f.path === partialPath || f.name === segment)
                                );
                                if (dirFile) {
                                  openFile(dirFile);
                                }
                              }}
                            >
                              <Folder className="w-3 h-3" />
                              {segment}
                            </BreadcrumbLink>
                          )}
                        </BreadcrumbItem>
                      );
                      return items;
                    });
                  })()}
                </BreadcrumbList>
              </Breadcrumb>
            </div>
          )}

          {/* Tab content */}
          <div className="flex-1 overflow-hidden">
            {activeTab?.kind === "file" && filesLoading && (
              <div className="p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-4 w-4" />
                  <Skeleton className="h-4 w-48" />
                </div>
                {Array.from({ length: 18 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <Skeleton className="h-3 w-8 shrink-0" />
                    <Skeleton className="h-3" style={{ width: `${Math.random() * 50 + 30}%` }} />
                  </div>
                ))}
              </div>
            )}
            {activeTab?.kind === "file" && !filesLoading && (
              <CodeEditor
                file={selectedFile}
                openFiles={openFiles}
                allFiles={files}
                projectId={id}
                onSave={(fileId, content) => saveMutation.mutate({ fileId, content })}
                onSelectFile={openFile}
                onCloseFile={(fileId) => closeTab(`file-${fileId}`)}
                onEditorContext={setEditorContext}
                onAskAI={(question) => {
                  agentInputRef.current?.setInput(question);
                }}
                theme={theme}
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
              <PreviewPanel
                projectId={id!}
                isAppRunning={!!isAppRunning}
                appPort={appPort}
                isRestarting={isRestarting}
                previewKey={previewKey}
                onRefresh={() => setPreviewKey(k => k + 1)}
                onRestart={handleRestartServer}
                onOpenLogs={() => openTool("console")}
                autoReloadEnabled={autoReloadPreview}
                onToggleAutoReload={() => setAutoReloadPreview(v => !v)}
              />
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

            {activeTab?.kind === "database" && (
              <div className="h-full" data-testid="panel-database">
                <DatabasePanel projectId={id!} />
              </div>
            )}

            {activeTab?.kind === "packages" && (
              <div className="h-full" data-testid="panel-packages-tab">
                <PackagePanel projectId={id!} />
              </div>
            )}

            {activeTab?.kind === "deploy" && (
              <div className="h-full" data-testid="panel-deploy-tab">
                <DeployPanel project={project} onDeploy={() => deployMutation.mutate()} isPending={deployMutation.isPending} />
              </div>
            )}
          </div>
        </div>

        {/* DRAG HANDLE: Center | Explorer (hidden on mobile) */}
        <div
          className="w-1 shrink-0 bg-border/40 hover:bg-primary/50 cursor-col-resize transition-colors relative z-10 hidden md:block"
          onMouseDown={e => {
            resizingRef.current = { panel: "explorer", startX: e.clientX, startW: explorerWidth };
            document.body.style.cursor = "col-resize";
            document.body.style.userSelect = "none";
            e.preventDefault();
          }}
          data-testid="drag-handle-explorer"
          title="Drag to resize"
        />

        {/* RIGHT: File Explorer with search (hidden on mobile) */}
        <div
          className="shrink-0 border-l bg-card/20 flex-col overflow-hidden hidden md:flex"
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
            {filesLoading ? (
              <div className="p-3 space-y-2">
                <div className="flex items-center gap-1.5 px-1">
                  <Skeleton className="h-3 w-3" />
                  <Skeleton className="h-3 w-3.5" />
                  <Skeleton className="h-3 w-20" />
                </div>
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-1.5" style={{ paddingLeft: `${(i % 3 > 0 ? 16 : 4)}px` }}>
                    <Skeleton className="h-3 w-3.5" />
                    <Skeleton className="h-3" style={{ width: `${Math.random() * 40 + 40}%` }} />
                  </div>
                ))}
              </div>
            ) : fileSearch.trim() ? (
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

      <div className="h-6 flex items-center px-2 md:px-3 border-t bg-card/60 text-[10px] text-muted-foreground shrink-0 gap-2 md:gap-4">
        <div className="flex items-center gap-1.5">
          <div className={`w-1.5 h-1.5 rounded-full ${isAppRunning ? "bg-green-500" : appStatus?.status === "starting" ? "bg-yellow-500 animate-pulse" : "bg-muted-foreground/40"}`} />
          <span>{isAppRunning ? "Running" : appStatus?.status === "starting" ? "Starting..." : "Stopped"}</span>
        </div>
        {selectedFile && (
          <>
            <span className="text-muted-foreground/40 hidden sm:inline">|</span>
            <span className="hidden sm:inline truncate max-w-[120px] md:max-w-none">{selectedFile.path}</span>
            <span className="text-muted-foreground/40 hidden md:inline">|</span>
            <span className="hidden md:inline">{selectedFile.content.split("\n").length} lines</span>
            <span className="text-muted-foreground/40 hidden md:inline">|</span>
            <span className="hidden md:inline">{getLanguageLabel(selectedFile.name)}</span>
          </>
        )}
        <div className="ml-auto flex items-center gap-3">
          <span className="hidden sm:inline">{project?.language}/{project?.framework}</span>
          <span className="hidden md:inline">UTF-8</span>
        </div>
      </div>

      <KeyboardShortcutsDialog open={showShortcuts} onOpenChange={setShowShortcuts} />
      <GlobalSearch
        open={globalSearchOpen}
        onOpenChange={setGlobalSearchOpen}
        files={files}
        onOpenFileAtLine={(file, _line) => {
          openFile(file);
        }}
        onReplaceInFile={(fileId, content) => {
          saveMutation.mutate({ fileId, content });
        }}
      />
    </div>
  );
}

function getLanguageLabel(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "ts": return "TypeScript";
    case "tsx": return "TypeScript JSX";
    case "js": return "JavaScript";
    case "jsx": return "JavaScript JSX";
    case "json": return "JSON";
    case "css": return "CSS";
    case "scss": return "SCSS";
    case "html": return "HTML";
    case "py": return "Python";
    case "go": return "Go";
    case "rs": return "Rust";
    case "md": return "Markdown";
    case "yml": case "yaml": return "YAML";
    case "sql": return "SQL";
    case "sh": return "Shell";
    default: return ext?.toUpperCase() || "Plain Text";
  }
}

function TabIcon({ kind }: { kind: CenterTabKind }) {
  switch (kind) {
    case "preview": return <Globe className="w-3 h-3 shrink-0" />;
    case "console": return <Cpu className="w-3 h-3 shrink-0" />;
    case "shell": return <Terminal className="w-3 h-3 shrink-0" />;
    case "git": return <GitBranch className="w-3 h-3 shrink-0" />;
    case "secrets": return <Lock className="w-3 h-3 shrink-0" />;
    case "database": return <Database className="w-3 h-3 shrink-0" />;
    case "packages": return <Package className="w-3 h-3 shrink-0" />;
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

const SHORTCUT_GROUPS = [
  {
    category: "General",
    shortcuts: [
      { keys: ["?"], description: "Show keyboard shortcuts" },
      { keys: ["Ctrl", "S"], description: "Save current file" },
      { keys: ["Ctrl", "Z"], description: "Undo" },
      { keys: ["Ctrl", "Shift", "Z"], description: "Redo" },
    ],
  },
  {
    category: "Editor",
    shortcuts: [
      { keys: ["Ctrl", "Shift", "F"], description: "Search across files" },
      { keys: ["Ctrl", "F"], description: "Find in file" },
      { keys: ["Ctrl", "H"], description: "Find and replace" },
      { keys: ["Ctrl", "G"], description: "Go to line" },
      { keys: ["Ctrl", "D"], description: "Select next occurrence" },
      { keys: ["Ctrl", "/"], description: "Toggle line comment" },
      { keys: ["Tab"], description: "Indent selection" },
      { keys: ["Shift", "Tab"], description: "Outdent selection" },
      { keys: ["Alt", "↑"], description: "Move line up" },
      { keys: ["Alt", "↓"], description: "Move line down" },
    ],
  },
  {
    category: "Navigation",
    shortcuts: [
      { keys: ["Ctrl", "P"], description: "Quick file search" },
      { keys: ["Ctrl", "Tab"], description: "Switch to next tab" },
      { keys: ["Ctrl", "Shift", "Tab"], description: "Switch to previous tab" },
      { keys: ["Ctrl", "W"], description: "Close current tab" },
      { keys: ["Ctrl", "T"], description: "Open new tab" },
    ],
  },
  {
    category: "Terminal",
    shortcuts: [
      { keys: ["Ctrl", "C"], description: "Cancel running command" },
      { keys: ["Ctrl", "L"], description: "Clear terminal" },
      { keys: ["↑"], description: "Previous command" },
      { keys: ["↓"], description: "Next command" },
    ],
  },
];

const VIEWPORT_MODES = [
  { id: "desktop", icon: Monitor, label: "Desktop", width: "100%" },
  { id: "tablet", icon: Tablet, label: "Tablet", width: "768px" },
  { id: "mobile", icon: Smartphone, label: "Mobile", width: "375px" },
] as const;

function PreviewPanel({
  projectId, isAppRunning, appPort, isRestarting, previewKey,
  onRefresh, onRestart, onOpenLogs, autoReloadEnabled, onToggleAutoReload,
}: {
  projectId: string; isAppRunning: boolean; appPort?: number; isRestarting: boolean;
  previewKey: number; onRefresh: () => void; onRestart: () => void; onOpenLogs: () => void;
  autoReloadEnabled: boolean; onToggleAutoReload: () => void;
}) {
  const [previewPath, setPreviewPath] = useState("/");
  const [viewportMode, setViewportMode] = useState<"desktop" | "tablet" | "mobile">("desktop");
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const baseUrl = `/api/projects/${projectId}/proxy`;
  const currentSrc = `${baseUrl}${previewPath}`;

  return (
    <div className="h-full flex flex-col bg-background" data-testid="panel-preview">
      <div className="flex items-center gap-1.5 px-2 py-1 border-b bg-card/50 shrink-0">
        <div className="flex items-center gap-1 shrink-0">
          <div className="w-2 h-2 rounded-full bg-[#ff5f57]" />
          <div className="w-2 h-2 rounded-full bg-[#febc2e]" />
          <div className={`w-2 h-2 rounded-full ${isAppRunning ? "bg-[#28c840]" : "bg-muted"}`} />
        </div>

        <Tooltip>
          <TooltipTrigger asChild>
            <button className="p-1 rounded hover:bg-muted text-muted-foreground" onClick={() => setPreviewPath(p => { const parts = p.split("/").filter(Boolean); parts.pop(); return "/" + parts.join("/") || "/"; })} data-testid="button-preview-back">
              <ArrowLeft className="w-3 h-3" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Back</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button className="p-1 rounded hover:bg-muted text-muted-foreground" onClick={onRefresh} data-testid="button-refresh-preview">
              <RefreshCw className="w-3 h-3" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Refresh</TooltipContent>
        </Tooltip>

        <div className="flex-1 mx-1">
          <div className="relative">
            <input
              value={previewPath}
              onChange={e => setPreviewPath(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") onRefresh(); }}
              className="w-full bg-muted/60 rounded text-[11px] text-muted-foreground px-2 py-1 font-mono focus:outline-none focus:ring-1 focus:ring-primary/50"
              data-testid="input-preview-url"
            />
          </div>
        </div>

        <div className="flex items-center gap-0.5 border-l pl-1.5 shrink-0">
          {VIEWPORT_MODES.map(vm => (
            <Tooltip key={vm.id}>
              <TooltipTrigger asChild>
                <button
                  className={`p-1 rounded transition-colors ${viewportMode === vm.id ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted"}`}
                  onClick={() => setViewportMode(vm.id as typeof viewportMode)}
                  data-testid={`button-viewport-${vm.id}`}
                >
                  <vm.icon className="w-3 h-3" />
                </button>
              </TooltipTrigger>
              <TooltipContent>{vm.label}</TooltipContent>
            </Tooltip>
          ))}
        </div>

        <div className="flex items-center gap-0.5 border-l pl-1.5 shrink-0">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className={`p-1 rounded transition-colors ${autoReloadEnabled ? "bg-green-500/15 text-green-500" : "text-muted-foreground hover:bg-muted"}`}
                onClick={onToggleAutoReload}
                data-testid="button-toggle-autoreload"
              >
                <RefreshCw className="w-3 h-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent>{autoReloadEnabled ? "Auto-reload ON" : "Auto-reload OFF"}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button className="p-1 rounded hover:bg-muted text-muted-foreground disabled:opacity-50" onClick={onRestart} disabled={isRestarting} data-testid="button-restart-server">
                {isRestarting ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
              </button>
            </TooltipTrigger>
            <TooltipContent>Restart Server</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button className="p-1 rounded hover:bg-muted text-muted-foreground" onClick={onOpenLogs} data-testid="button-view-logs">
                <ScrollText className="w-3 h-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent>View Logs</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button className="p-1 rounded hover:bg-muted text-muted-foreground" onClick={() => window.open(`/api/projects/${projectId}/proxy/`, "_blank")} data-testid="button-open-preview">
                <ExternalLink className="w-3 h-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Open External</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <div className="flex-1 relative flex items-start justify-center overflow-auto bg-muted/20">
        {isRestarting && (
          <div className="absolute inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-10">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Restarting server...</p>
            </div>
          </div>
        )}
        <iframe
          ref={iframeRef}
          key={previewKey}
          src={isAppRunning ? currentSrc : `/api/projects/${projectId}/preview`}
          className="h-full border-0 bg-white transition-all"
          style={{ width: VIEWPORT_MODES.find(v => v.id === viewportMode)?.width || "100%", maxWidth: "100%" }}
          title="App Preview"
          data-testid="iframe-preview"
        />
      </div>
    </div>
  );
}

function KeyboardShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-hidden flex flex-col" data-testid="keyboard-shortcuts-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="w-5 h-5" />
            Keyboard Shortcuts
          </DialogTitle>
          <DialogDescription>
            Available keyboard shortcuts for the workspace
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="flex-1 -mx-6 px-6">
          <div className="space-y-6 pb-2">
            {SHORTCUT_GROUPS.map((group) => (
              <div key={group.category}>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                  {group.category}
                </h4>
                <div className="space-y-1">
                  {group.shortcuts.map((shortcut, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-muted/50 transition-colors"
                    >
                      <span className="text-sm">{shortcut.description}</span>
                      <div className="flex items-center gap-1 shrink-0 ml-4">
                        {shortcut.keys.map((key, ki) => (
                          <kbd
                            key={ki}
                            className="inline-flex items-center justify-center min-w-[24px] h-6 px-1.5 rounded border bg-muted text-[11px] font-mono font-medium text-muted-foreground shadow-sm"
                          >
                            {key}
                          </kbd>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
