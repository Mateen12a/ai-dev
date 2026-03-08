import { useEffect, useRef } from "react";
import type { BuildLog } from "@shared/schema";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Trash2, Download } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface TerminalPanelProps {
  logs: BuildLog[];
  onClear: () => void;
}

function LogLine({ log }: { log: BuildLog }) {
  const colorClass =
    log.type === "error" ? "text-red-400" :
    log.type === "warning" ? "text-amber-400" :
    log.type === "success" ? "text-emerald-400" :
    log.type === "system" ? "text-blue-400" :
    "text-foreground/80";

  const prefix =
    log.type === "error" ? "[ERR]" :
    log.type === "warning" ? "[WRN]" :
    log.type === "success" ? "[OK]" :
    log.type === "system" ? "[SYS]" :
    "[LOG]";

  return (
    <div className={`font-mono text-xs leading-5 flex gap-2 px-3 ${colorClass}`} data-testid={`log-entry-${log.id}`}>
      <span className="text-muted-foreground/50 shrink-0 w-16 text-right">
        {new Date(log.createdAt).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })}
      </span>
      <span className="shrink-0 w-10 font-semibold">{prefix}</span>
      <span className="break-all whitespace-pre-wrap">{log.message}</span>
    </div>
  );
}

export function TerminalPanel({ logs, onClear }: TerminalPanelProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const buildLogs = logs.filter(l => l.stage === "build");
  const testLogs = logs.filter(l => l.stage === "test");
  const deployLogs = logs.filter(l => l.stage === "deploy");
  const allLogs = logs;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs.length]);

  const renderLogs = (filteredLogs: BuildLog[]) => (
    <ScrollArea className="h-full">
      <div className="py-2 min-h-full">
        {filteredLogs.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-muted-foreground text-xs">
            No logs yet
          </div>
        ) : (
          filteredLogs.map((log) => <LogLine key={log.id} log={log} />)
        )}
        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  );

  return (
    <div className="h-full flex flex-col bg-background">
      <Tabs defaultValue="all" className="h-full flex flex-col">
        <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-b">
          <TabsList className="h-7 p-0.5">
            <TabsTrigger value="all" className="text-[10px] px-2 h-6" data-testid="tab-all-logs">
              All
              {allLogs.length > 0 && <Badge variant="secondary" className="ml-1 text-[9px] px-1">{allLogs.length}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="build" className="text-[10px] px-2 h-6" data-testid="tab-build-logs">Build</TabsTrigger>
            <TabsTrigger value="test" className="text-[10px] px-2 h-6" data-testid="tab-test-logs">Test</TabsTrigger>
            <TabsTrigger value="deploy" className="text-[10px] px-2 h-6" data-testid="tab-deploy-logs">Deploy</TabsTrigger>
          </TabsList>
          <div className="flex items-center gap-1">
            <Button size="icon" variant="ghost" onClick={onClear} data-testid="button-clear-logs">
              <Trash2 className="w-3 h-3" />
            </Button>
          </div>
        </div>
        <TabsContent value="all" className="flex-1 m-0 overflow-hidden">{renderLogs(allLogs)}</TabsContent>
        <TabsContent value="build" className="flex-1 m-0 overflow-hidden">{renderLogs(buildLogs)}</TabsContent>
        <TabsContent value="test" className="flex-1 m-0 overflow-hidden">{renderLogs(testLogs)}</TabsContent>
        <TabsContent value="deploy" className="flex-1 m-0 overflow-hidden">{renderLogs(deployLogs)}</TabsContent>
      </Tabs>
    </div>
  );
}
