import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Trash2, RefreshCw, Square, RotateCcw, Play, ChevronDown } from "lucide-react";
import type { BuildLog } from "@shared/schema";

interface ProcessInfo {
  label: string;
  status: string;
  port: number | null;
  command: string;
  startedAt: string;
  restartCount: number;
  uptime: number;
}

interface ConsolePanelProps {
  projectId: string;
}

const TYPE_COLORS: Record<string, string> = {
  success: "text-[#3fb950]",
  error: "text-[#f85149]",
  warning: "text-[#e3b341]",
  info: "text-[#79c0ff]",
  system: "text-[#8b949e]",
  shell: "text-[#d2a8ff]",
};

const TYPE_PREFIX: Record<string, string> = {
  success: "✓",
  error: "✗",
  warning: "⚠",
  info: "ℹ",
  system: "•",
  shell: "$",
};

const LABEL_COLORS: Record<string, string> = {
  main: "text-[#58a6ff]",
  frontend: "text-[#f778ba]",
  backend: "text-[#7ee787]",
  worker: "text-[#d2a8ff]",
  database: "text-[#e3b341]",
};

function getLabelColor(label: string): string {
  return LABEL_COLORS[label] || "text-[#79c0ff]";
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

const STATUS_COLORS: Record<string, string> = {
  starting: "bg-[#e3b341]",
  running: "bg-[#3fb950]",
  crashed: "bg-[#f85149]",
  stopped: "bg-[#484f58]",
};

export default function ConsolePanel({ projectId }: ConsolePanelProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [filterLabel, setFilterLabel] = useState<string | null>(null);
  const [showAddService, setShowAddService] = useState(false);
  const [newServiceLabel, setNewServiceLabel] = useState("");
  const [newServiceCommand, setNewServiceCommand] = useState("");

  const logsQuery = useQuery<BuildLog[]>({
    queryKey: ["/api/projects", projectId, "logs"],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/logs`);
      return res.json();
    },
    refetchInterval: 3000,
  });

  const processesQuery = useQuery<ProcessInfo[]>({
    queryKey: ["/api/projects", projectId, "processes"],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/processes`);
      return res.json();
    },
    refetchInterval: 5000,
  });

  const clearMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/projects/${projectId}/logs`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "logs"] });
    },
  });

  const stopMutation = useMutation({
    mutationFn: async (label: string) => {
      await apiRequest("POST", `/api/projects/${projectId}/stop`, { label });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "processes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "logs"] });
    },
  });

  const restartMutation = useMutation({
    mutationFn: async (label: string) => {
      await apiRequest("POST", `/api/projects/${projectId}/restart-service`, { label });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "processes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "logs"] });
    },
  });

  const runServiceMutation = useMutation({
    mutationFn: async ({ command, label }: { command: string; label: string }) => {
      await apiRequest("POST", `/api/projects/${projectId}/run-service`, { command, label });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "processes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "logs"] });
      setShowAddService(false);
      setNewServiceLabel("");
      setNewServiceCommand("");
    },
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logsQuery.data]);

  const logs = logsQuery.data || [];
  const processes = processesQuery.data || [];

  const filteredLogs = filterLabel
    ? logs.filter((log: any) => log.processLabel === filterLabel)
    : logs;

  const uniqueLabels = Array.from(new Set(logs.map((log: any) => log.processLabel || "main")));

  return (
    <div className="h-full flex flex-col bg-[#0d1117]" data-testid="panel-console">
      {processes.length > 0 && (
        <div className="px-3 py-1.5 border-b border-[#30363d] shrink-0">
          <div className="flex flex-wrap gap-2">
            {processes.map((proc) => (
              <div
                key={proc.label}
                className="flex items-center gap-1.5 bg-[#161b22] rounded px-2 py-1 text-xs border border-[#30363d]"
              >
                <span className={`w-1.5 h-1.5 rounded-full ${STATUS_COLORS[proc.status] || "bg-[#484f58]"}`} />
                <span className={`font-medium ${getLabelColor(proc.label)}`}>{proc.label}</span>
                <span className="text-[#484f58]">·</span>
                <span className="text-[#8b949e]">{formatUptime(proc.uptime)}</span>
                {proc.restartCount > 0 && (
                  <>
                    <span className="text-[#484f58]">·</span>
                    <span className="text-[#e3b341] text-[10px]">↻{proc.restartCount}</span>
                  </>
                )}
                <div className="flex items-center gap-0.5 ml-1">
                  <button
                    onClick={() => restartMutation.mutate(proc.label)}
                    className="p-0.5 rounded hover:bg-[#30363d] text-[#8b949e] hover:text-[#e6edf3]"
                    title={`Restart ${proc.label}`}
                  >
                    <RotateCcw className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => stopMutation.mutate(proc.label)}
                    className="p-0.5 rounded hover:bg-[#30363d] text-[#8b949e] hover:text-[#f85149]"
                    title={`Stop ${proc.label}`}
                  >
                    <Square className="w-3 h-3" />
                  </button>
                </div>
              </div>
            ))}
            <button
              onClick={() => setShowAddService(!showAddService)}
              className="flex items-center gap-1 text-xs text-[#8b949e] hover:text-[#e6edf3] px-2 py-1 rounded hover:bg-[#161b22] border border-transparent hover:border-[#30363d]"
            >
              <Play className="w-3 h-3" /> Add Service
            </button>
          </div>
          {showAddService && (
            <div className="flex items-center gap-2 mt-2">
              <input
                type="text"
                placeholder="Label (e.g. worker)"
                value={newServiceLabel}
                onChange={(e) => setNewServiceLabel(e.target.value)}
                className="bg-[#0d1117] border border-[#30363d] rounded px-2 py-1 text-xs text-[#e6edf3] w-28 focus:outline-none focus:border-[#58a6ff]"
              />
              <input
                type="text"
                placeholder="Command (e.g. npm run worker)"
                value={newServiceCommand}
                onChange={(e) => setNewServiceCommand(e.target.value)}
                className="bg-[#0d1117] border border-[#30363d] rounded px-2 py-1 text-xs text-[#e6edf3] flex-1 focus:outline-none focus:border-[#58a6ff]"
              />
              <button
                onClick={() => {
                  if (newServiceLabel && newServiceCommand) {
                    runServiceMutation.mutate({ command: newServiceCommand, label: newServiceLabel });
                  }
                }}
                disabled={!newServiceLabel || !newServiceCommand}
                className="px-2 py-1 text-xs bg-[#238636] text-white rounded hover:bg-[#2ea043] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Start
              </button>
            </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-between px-3 py-1.5 border-b border-[#30363d] shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-[#8b949e] text-xs">{filteredLogs.length} log{filteredLogs.length !== 1 ? "s" : ""}</span>
          {uniqueLabels.length > 1 && (
            <div className="flex items-center gap-1">
              <button
                onClick={() => setFilterLabel(null)}
                className={`px-1.5 py-0.5 rounded text-[10px] ${!filterLabel ? "bg-[#30363d] text-[#e6edf3]" : "text-[#8b949e] hover:text-[#e6edf3]"}`}
              >
                All
              </button>
              {uniqueLabels.map((label) => (
                <button
                  key={label}
                  onClick={() => setFilterLabel(label)}
                  className={`px-1.5 py-0.5 rounded text-[10px] ${filterLabel === label ? "bg-[#30363d] text-[#e6edf3]" : `${getLabelColor(label)} hover:opacity-80`}`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => logsQuery.refetch()}
            className="p-1 rounded hover:bg-[#30363d] text-[#8b949e]"
            data-testid="button-refresh-logs"
          >
            <RefreshCw className="w-3 h-3" />
          </button>
          <button
            onClick={() => clearMutation.mutate()}
            className="p-1 rounded hover:bg-[#30363d] text-[#8b949e]"
            data-testid="button-clear-logs"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-2 font-mono text-xs space-y-0.5">
        {filteredLogs.length === 0 ? (
          <p className="text-[#484f58] py-4 text-center">No output yet. Run your project to see logs.</p>
        ) : (
          filteredLogs.map((log) => {
            const label = (log as any).processLabel || "main";
            const showLabel = uniqueLabels.length > 1 && !filterLabel;
            return (
              <div key={log.id} className="flex items-start gap-2 group" data-testid={`log-entry-${log.id}`}>
                {showLabel && (
                  <span className={`shrink-0 text-[10px] font-medium w-16 truncate mt-0.5 ${getLabelColor(label)}`}>
                    [{label}]
                  </span>
                )}
                <span className={`shrink-0 mt-0.5 ${TYPE_COLORS[log.type] || "text-[#e6edf3]"}`}>
                  {TYPE_PREFIX[log.type] || "•"}
                </span>
                <div className="flex-1 min-w-0">
                  <span className={`${TYPE_COLORS[log.type] || "text-[#e6edf3]"}`} style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                    {log.message}
                  </span>
                </div>
                <span className="text-[#484f58] shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-[10px]">
                  {new Date(log.createdAt).toLocaleTimeString()}
                </span>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
