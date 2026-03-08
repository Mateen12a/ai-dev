import { useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Trash2, RefreshCw } from "lucide-react";
import type { BuildLog } from "@shared/schema";

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

export default function ConsolePanel({ projectId }: ConsolePanelProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  const logsQuery = useQuery<BuildLog[]>({
    queryKey: ["/api/projects", projectId, "logs"],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/logs`);
      return res.json();
    },
    refetchInterval: 3000,
  });

  const clearMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/projects/${projectId}/logs`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "logs"] });
    },
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logsQuery.data]);

  const logs = logsQuery.data || [];

  return (
    <div className="h-full flex flex-col bg-[#0d1117]" data-testid="panel-console">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-[#30363d] shrink-0">
        <span className="text-[#8b949e] text-xs">{logs.length} log{logs.length !== 1 ? "s" : ""}</span>
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
        {logs.length === 0 ? (
          <p className="text-[#484f58] py-4 text-center">No output yet. Run your project to see logs.</p>
        ) : (
          logs.map((log) => (
            <div key={log.id} className="flex items-start gap-2 group" data-testid={`log-entry-${log.id}`}>
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
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
