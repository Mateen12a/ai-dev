import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Database, Table2, Play, Loader2, AlertCircle,
  CheckCircle2, RefreshCw, ChevronRight, Plus
} from "lucide-react";

interface TableInfo {
  table_name: string;
  row_count: number;
  columns: Array<{ name: string; type: string; nullable: boolean }>;
}

interface QueryResult {
  rows: Record<string, unknown>[];
  fields: string[];
  rowCount: number;
  duration: number;
}

export default function DatabasePanel({ projectId }: { projectId: string }) {
  const [query, setQuery] = useState("SELECT 1;");
  const [expandedTable, setExpandedTable] = useState<string | null>(null);

  const { data: tablesData, isLoading: tablesLoading, error: tablesError, refetch: refetchTables } = useQuery<{
    connected: boolean;
    tables: TableInfo[];
    error?: string;
  }>({
    queryKey: ["/api/projects", projectId, "database", "tables"],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/database/tables`);
      return res.json();
    },
    refetchInterval: 30000,
  });

  const queryMutation = useMutation<QueryResult, Error, string>({
    mutationFn: async (sql: string) => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/database/query`, { query: sql });
      return res.json();
    },
  });

  const connected = tablesData?.connected ?? false;
  const tables = tablesData?.tables ?? [];

  const handleRunQuery = () => {
    if (query.trim()) {
      queryMutation.mutate(query.trim());
    }
  };

  const provisionMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/database/provision`);
      return res.json();
    },
    onSuccess: () => {
      refetchTables();
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "secrets"] });
    },
  });

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      handleRunQuery();
    }
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="px-3 py-2 border-b bg-card/50 shrink-0 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Database className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-medium">Database</span>
          {connected ? (
            <Badge variant="outline" className="text-[10px] gap-1 text-green-600 border-green-500/30">
              <CheckCircle2 className="w-2.5 h-2.5" />Connected
            </Badge>
          ) : (
            <Badge variant="outline" className="text-[10px] gap-1 text-red-500 border-red-500/30">
              <AlertCircle className="w-2.5 h-2.5" />Disconnected
            </Badge>
          )}
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 w-6 p-0"
          onClick={() => refetchTables()}
        >
          <RefreshCw className={`w-3 h-3 ${tablesLoading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="border-b shrink-0">
          <div className="px-3 py-1.5 flex items-center gap-2">
            <Table2 className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Tables</span>
          </div>
          <ScrollArea className="max-h-[200px]">
            <div className="px-2 pb-2 space-y-0.5">
              {tablesLoading && (
                <div className="flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground">
                  <Loader2 className="w-3 h-3 animate-spin" />Loading tables...
                </div>
              )}
              {tablesError && (
                <div className="px-2 py-2 text-xs text-red-500">
                  Failed to load tables
                </div>
              )}
              {!connected && !tablesLoading && (
                <div className="px-2 py-3 space-y-2">
                  <p className="text-xs text-muted-foreground">
                    No DATABASE_URL secret found.
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full text-xs h-7 gap-1.5"
                    onClick={() => provisionMutation.mutate()}
                    disabled={provisionMutation.isPending}
                  >
                    {provisionMutation.isPending ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Plus className="w-3 h-3" />
                    )}
                    Create Database
                  </Button>
                  {provisionMutation.isError && (
                    <p className="text-[10px] text-red-500">{provisionMutation.error?.message}</p>
                  )}
                </div>
              )}
              {connected && tables.length === 0 && !tablesLoading && (
                <div className="px-2 py-3 text-xs text-muted-foreground">
                  No tables found in database.
                </div>
              )}
              {tables.map(table => (
                <div key={table.table_name}>
                  <button
                    className="w-full flex items-center gap-1.5 px-2 py-1 rounded text-xs hover:bg-muted transition-colors"
                    onClick={() => {
                      setExpandedTable(expandedTable === table.table_name ? null : table.table_name);
                      setQuery(`SELECT * FROM "${table.table_name}" LIMIT 50;`);
                    }}
                  >
                    <ChevronRight className={`w-3 h-3 shrink-0 transition-transform ${expandedTable === table.table_name ? "rotate-90" : ""}`} />
                    <Table2 className="w-3 h-3 shrink-0 text-blue-400" />
                    <span className="truncate font-mono">{table.table_name}</span>
                    <Badge variant="outline" className="ml-auto text-[9px] shrink-0">{table.row_count}</Badge>
                  </button>
                  {expandedTable === table.table_name && table.columns && (
                    <div className="ml-6 pl-2 border-l border-border/50 space-y-0.5 py-1">
                      {table.columns.map(col => (
                        <div key={col.name} className="flex items-center gap-1.5 text-[11px] text-muted-foreground px-1 py-0.5">
                          <span className="font-mono truncate">{col.name}</span>
                          <span className="text-[10px] text-blue-400/70 ml-auto shrink-0">{col.type}</span>
                          {col.nullable && <span className="text-[9px] text-yellow-500/60">null</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>

        <div className="flex flex-col flex-1 overflow-hidden">
          <div className="px-3 py-1.5 flex items-center justify-between shrink-0">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Query</span>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-muted-foreground">⌘+Enter</span>
              <Button
                size="sm"
                className="h-6 gap-1 text-[11px] px-2"
                onClick={handleRunQuery}
                disabled={queryMutation.isPending || !query.trim()}
              >
                {queryMutation.isPending ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Play className="w-3 h-3" />
                )}
                Run
              </Button>
            </div>
          </div>
          <div className="px-3 shrink-0">
            <textarea
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              className="w-full h-20 p-2 bg-muted/40 border border-border rounded text-xs font-mono resize-none outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20"
              placeholder="Enter SQL query..."
              spellCheck={false}
            />
          </div>

          <div className="flex-1 overflow-hidden mt-1">
            {queryMutation.isPending && (
              <div className="flex items-center gap-2 px-3 py-4 text-xs text-muted-foreground">
                <Loader2 className="w-3 h-3 animate-spin" />Running query...
              </div>
            )}
            {queryMutation.error && (
              <div className="mx-3 p-2 bg-red-500/10 border border-red-500/20 rounded text-xs text-red-500">
                <div className="flex items-center gap-1.5 font-medium mb-1">
                  <AlertCircle className="w-3 h-3" />Error
                </div>
                <pre className="whitespace-pre-wrap font-mono text-[11px] opacity-80">{queryMutation.error.message}</pre>
              </div>
            )}
            {queryMutation.data && (
              <div className="h-full flex flex-col px-3">
                <div className="flex items-center gap-2 py-1 shrink-0">
                  <Badge variant="outline" className="text-[10px]">{queryMutation.data.rowCount} rows</Badge>
                  <span className="text-[10px] text-muted-foreground">{queryMutation.data.duration}ms</span>
                </div>
                <ScrollArea className="flex-1 border border-border rounded overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-muted/50 border-b">
                          {queryMutation.data.fields.map(field => (
                            <th key={field} className="text-left px-2 py-1.5 font-medium text-muted-foreground whitespace-nowrap border-r last:border-r-0">
                              {field}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {queryMutation.data.rows.map((row, i) => (
                          <tr key={i} className="border-b last:border-b-0 hover:bg-muted/30">
                            {queryMutation.data!.fields.map(field => (
                              <td key={field} className="px-2 py-1 font-mono text-[11px] whitespace-nowrap border-r last:border-r-0 max-w-[200px] truncate">
                                {row[field] === null ? (
                                  <span className="text-muted-foreground italic">null</span>
                                ) : (
                                  String(row[field])
                                )}
                              </td>
                            ))}
                          </tr>
                        ))}
                        {queryMutation.data.rows.length === 0 && (
                          <tr>
                            <td colSpan={queryMutation.data.fields.length || 1} className="px-2 py-4 text-center text-muted-foreground">
                              No rows returned
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </ScrollArea>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
