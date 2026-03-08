import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Search, Replace, X, ChevronDown, ChevronRight,
  FileText, CaseSensitive, Regex, Loader2,
} from "lucide-react";
import type { ProjectFile } from "@shared/schema";

interface SearchMatch {
  lineNumber: number;
  lineContent: string;
  matchStart: number;
  matchEnd: number;
}

interface FileResult {
  file: ProjectFile;
  matches: SearchMatch[];
}

interface GlobalSearchProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  files: ProjectFile[];
  onOpenFileAtLine: (file: ProjectFile, line: number) => void;
  onReplaceInFile: (fileId: string, content: string) => void;
}

export function GlobalSearch({ open, onOpenChange, files, onOpenFileAtLine, onReplaceInFile }: GlobalSearchProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [replaceQuery, setReplaceQuery] = useState("");
  const [showReplace, setShowReplace] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set());
  const [replacing, setReplacing] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setTimeout(() => searchInputRef.current?.focus(), 100);
    } else {
      setSearchQuery("");
      setReplaceQuery("");
      setShowReplace(false);
      setCollapsedFiles(new Set());
    }
  }, [open]);

  const results = useMemo<FileResult[]>(() => {
    const query = searchQuery.trim();
    if (!query) return [];

    const textFiles = files.filter(f => f.type === "file" && f.content);
    const fileResults: FileResult[] = [];

    for (const file of textFiles) {
      const lines = file.content.split("\n");
      const matches: SearchMatch[] = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        try {
          let regex: RegExp;
          if (useRegex) {
            regex = new RegExp(query, caseSensitive ? "g" : "gi");
          } else {
            const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            regex = new RegExp(escaped, caseSensitive ? "g" : "gi");
          }

          let match: RegExpExecArray | null;
          while ((match = regex.exec(line)) !== null) {
            matches.push({
              lineNumber: i + 1,
              lineContent: line,
              matchStart: match.index,
              matchEnd: match.index + match[0].length,
            });
            if (match[0].length === 0) break;
          }
        } catch {
          break;
        }
      }

      if (matches.length > 0) {
        fileResults.push({ file, matches });
      }
    }

    return fileResults;
  }, [searchQuery, files, useRegex, caseSensitive]);

  const totalMatches = useMemo(() => results.reduce((sum, r) => sum + r.matches.length, 0), [results]);

  const toggleFileCollapse = useCallback((fileId: string) => {
    setCollapsedFiles(prev => {
      const next = new Set(prev);
      if (next.has(fileId)) next.delete(fileId);
      else next.add(fileId);
      return next;
    });
  }, []);

  const handleReplaceInFile = useCallback((fileResult: FileResult) => {
    const query = searchQuery.trim();
    if (!query) return;
    setReplacing(fileResult.file.id);

    try {
      let regex: RegExp;
      if (useRegex) {
        regex = new RegExp(query, caseSensitive ? "g" : "gi");
      } else {
        const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        regex = new RegExp(escaped, caseSensitive ? "g" : "gi");
      }

      const newContent = fileResult.file.content.replace(regex, replaceQuery);
      onReplaceInFile(fileResult.file.id, newContent);
    } finally {
      setTimeout(() => setReplacing(null), 300);
    }
  }, [searchQuery, replaceQuery, useRegex, caseSensitive, onReplaceInFile]);

  const handleReplaceAll = useCallback(() => {
    for (const fileResult of results) {
      handleReplaceInFile(fileResult);
    }
  }, [results, handleReplaceInFile]);

  const highlightMatch = (lineContent: string, matchStart: number, matchEnd: number) => {
    const before = lineContent.substring(0, matchStart);
    const matched = lineContent.substring(matchStart, matchEnd);
    const after = lineContent.substring(matchEnd);

    return (
      <span className="font-mono text-xs whitespace-pre">
        <span className="text-muted-foreground">{before.length > 40 ? "…" + before.slice(-40) : before}</span>
        <span className="bg-yellow-400/30 text-yellow-200 dark:bg-yellow-500/30 dark:text-yellow-300 font-semibold rounded-sm px-0.5">{matched}</span>
        <span className="text-muted-foreground">{after.length > 60 ? after.slice(0, 60) + "…" : after}</span>
      </span>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col p-0 gap-0">
        <DialogHeader className="px-4 pt-4 pb-2">
          <DialogTitle className="flex items-center gap-2 text-sm">
            <Search className="w-4 h-4" />
            Search Across Files
          </DialogTitle>
          <DialogDescription className="text-xs">
            Find and replace text across all project files
          </DialogDescription>
        </DialogHeader>

        <div className="px-4 pb-3 space-y-2 border-b">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
              <Input
                ref={searchInputRef}
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search…"
                className="h-8 pl-8 pr-2 text-sm"
              />
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant={caseSensitive ? "secondary" : "ghost"}
                  className="h-8 w-8 p-0"
                  onClick={() => setCaseSensitive(v => !v)}
                >
                  <CaseSensitive className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Match Case</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant={useRegex ? "secondary" : "ghost"}
                  className="h-8 w-8 p-0"
                  onClick={() => setUseRegex(v => !v)}
                >
                  <Regex className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Use Regular Expression</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant={showReplace ? "secondary" : "ghost"}
                  className="h-8 w-8 p-0"
                  onClick={() => setShowReplace(v => !v)}
                >
                  <Replace className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Toggle Replace</TooltipContent>
            </Tooltip>
          </div>

          {showReplace && (
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Replace className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                <Input
                  value={replaceQuery}
                  onChange={e => setReplaceQuery(e.target.value)}
                  placeholder="Replace with…"
                  className="h-8 pl-8 pr-2 text-sm"
                />
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs px-3"
                onClick={handleReplaceAll}
                disabled={results.length === 0}
              >
                Replace All
              </Button>
            </div>
          )}

          {searchQuery.trim() && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>
                {totalMatches} result{totalMatches !== 1 ? "s" : ""} in {results.length} file{results.length !== 1 ? "s" : ""}
              </span>
            </div>
          )}
        </div>

        <ScrollArea className="flex-1 min-h-0">
          <div className="px-2 py-1">
            {results.length === 0 && searchQuery.trim() && (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <Search className="w-8 h-8 mb-2 opacity-30" />
                <p className="text-sm">No results found</p>
                <p className="text-xs mt-1">Try a different search term</p>
              </div>
            )}

            {results.map(fileResult => {
              const isCollapsed = collapsedFiles.has(fileResult.file.id);
              return (
                <div key={fileResult.file.id} className="mb-1">
                  <div
                    className="flex items-center gap-1.5 px-2 py-1 rounded hover:bg-muted/60 cursor-pointer select-none group"
                    onClick={() => toggleFileCollapse(fileResult.file.id)}
                  >
                    {isCollapsed
                      ? <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    }
                    <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <span className="text-xs font-medium truncate">{fileResult.file.path}</span>
                    <Badge variant="secondary" className="text-[10px] ml-auto shrink-0 h-4 px-1.5">
                      {fileResult.matches.length}
                    </Badge>
                    {showReplace && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-5 text-[10px] px-1.5 opacity-0 group-hover:opacity-100 shrink-0"
                        onClick={e => { e.stopPropagation(); handleReplaceInFile(fileResult); }}
                        disabled={replacing === fileResult.file.id}
                      >
                        {replacing === fileResult.file.id ? <Loader2 className="w-3 h-3 animate-spin" /> : "Replace"}
                      </Button>
                    )}
                  </div>
                  {!isCollapsed && (
                    <div className="ml-5 border-l border-border/40 pl-2">
                      {fileResult.matches.slice(0, 100).map((match, i) => (
                        <button
                          key={`${match.lineNumber}-${match.matchStart}-${i}`}
                          className="w-full text-left flex items-start gap-2 px-2 py-0.5 rounded hover:bg-muted/50 transition-colors"
                          onClick={() => {
                            onOpenFileAtLine(fileResult.file, match.lineNumber);
                            onOpenChange(false);
                          }}
                        >
                          <span className="text-[10px] text-muted-foreground font-mono w-6 text-right shrink-0 pt-0.5">
                            {match.lineNumber}
                          </span>
                          <div className="min-w-0 overflow-hidden">
                            {highlightMatch(match.lineContent, match.matchStart, match.matchEnd)}
                          </div>
                        </button>
                      ))}
                      {fileResult.matches.length > 100 && (
                        <p className="text-[10px] text-muted-foreground px-2 py-1">
                          …and {fileResult.matches.length - 100} more matches
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
