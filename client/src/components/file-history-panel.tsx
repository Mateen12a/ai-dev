import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { FileVersion, ProjectFile } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { History, RotateCcw, Clock, FileText, X, ChevronDown, ChevronRight } from "lucide-react";

interface FileHistoryPanelProps {
  projectId: string;
  file: ProjectFile;
  onClose: () => void;
  onRestored: () => void;
}

function formatTimeAgo(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FileHistoryPanel({ projectId, file, onClose, onRestored }: FileHistoryPanelProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data: versions = [], isLoading } = useQuery<FileVersion[]>({
    queryKey: ["/api/projects", projectId, "files", file.id, "history"],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/files/${file.id}/history`);
      return res.json();
    },
  });

  const restoreMutation = useMutation({
    mutationFn: async (versionId: string) => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/files/${file.id}/history/${versionId}/restore`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "files"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "files", file.id, "history"] });
      onRestored();
    },
  });

  const currentSize = new Blob([file.content]).size;

  return (
    <div className="flex flex-col h-full border-l bg-card">
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <div className="flex items-center gap-2">
          <History className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-medium">History</span>
          <Badge variant="outline" className="text-[10px]">{file.name}</Badge>
        </div>
        <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={onClose}>
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2">
          <div className="flex items-center gap-2 px-2 py-1.5 rounded bg-primary/10 border border-primary/20 mb-2">
            <FileText className="w-3.5 h-3.5 text-primary" />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium">Current version</div>
              <div className="text-[10px] text-muted-foreground">{formatBytes(currentSize)}</div>
            </div>
          </div>

          {isLoading ? (
            <div className="text-xs text-muted-foreground text-center py-4">Loading history...</div>
          ) : versions.length === 0 ? (
            <div className="text-xs text-muted-foreground text-center py-4">No previous versions</div>
          ) : (
            <div className="space-y-1">
              {versions.map((version, idx) => {
                const isExpanded = expandedId === version.id;
                const versionDate = new Date(version.createdAt);
                const versionSize = parseInt(version.size) || 0;
                const sizeDiff = currentSize - versionSize;

                return (
                  <div key={version.id} className="rounded border bg-background">
                    <button
                      className="w-full flex items-center gap-2 px-2 py-1.5 text-left hover:bg-muted/50 transition-colors"
                      onClick={() => setExpandedId(isExpanded ? null : version.id)}
                    >
                      {isExpanded ? (
                        <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" />
                      ) : (
                        <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />
                      )}
                      <Clock className="w-3 h-3 text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs truncate">v{versions.length - idx}</div>
                        <div className="text-[10px] text-muted-foreground">{formatTimeAgo(versionDate)}</div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <span className="text-[10px] text-muted-foreground">{formatBytes(versionSize)}</span>
                        {sizeDiff !== 0 && (
                          <span className={`text-[10px] ${sizeDiff > 0 ? "text-green-500" : "text-red-500"}`}>
                            {sizeDiff > 0 ? "+" : ""}{formatBytes(Math.abs(sizeDiff))}
                          </span>
                        )}
                      </div>
                    </button>
                    {isExpanded && (
                      <div className="px-2 pb-2 border-t">
                        <div className="text-[10px] text-muted-foreground py-1">
                          {versionDate.toLocaleString()}
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 text-xs gap-1 w-full"
                          onClick={() => restoreMutation.mutate(version.id)}
                          disabled={restoreMutation.isPending}
                        >
                          <RotateCcw className="w-3 h-3" />
                          {restoreMutation.isPending ? "Restoring..." : "Restore this version"}
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
