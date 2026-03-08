import { useState, useEffect, useRef, useCallback } from "react";
import type { ProjectFile } from "@shared/schema";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { X, Save, FileCode } from "lucide-react";

interface CodeEditorProps {
  file: ProjectFile | null;
  openFiles: ProjectFile[];
  onSave: (fileId: string, content: string) => void;
  onSelectFile: (file: ProjectFile) => void;
  onCloseFile: (fileId: string) => void;
}

function getLanguageClass(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "ts": case "tsx": return "typescript";
    case "js": case "jsx": return "javascript";
    case "json": return "json";
    case "css": case "scss": return "css";
    case "html": return "html";
    case "py": return "python";
    case "go": return "go";
    case "rs": return "rust";
    case "md": return "markdown";
    case "yml": case "yaml": return "yaml";
    default: return "plaintext";
  }
}

function LineNumbers({ count }: { count: number }) {
  return (
    <div className="select-none text-right pr-4 text-muted-foreground/40 font-mono text-xs leading-[1.65rem] pt-3 min-w-[3rem]">
      {Array.from({ length: count }, (_, i) => (
        <div key={i + 1}>{i + 1}</div>
      ))}
    </div>
  );
}

export function CodeEditor({ file, openFiles, onSave, onSelectFile, onCloseFile }: CodeEditorProps) {
  const [content, setContent] = useState("");
  const [hasChanges, setHasChanges] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (file) {
      setContent(file.content);
      setHasChanges(false);
    }
  }, [file?.id, file?.content]);

  const handleChange = (value: string) => {
    setContent(value);
    setHasChanges(value !== file?.content);
  };

  const handleSave = useCallback(() => {
    if (file && hasChanges) {
      onSave(file.id, content);
      setHasChanges(false);
    }
  }, [file, hasChanges, content, onSave]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleSave]);

  const handleTab = (e: React.KeyboardEvent) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const textarea = textareaRef.current;
      if (!textarea) return;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const newContent = content.substring(0, start) + "  " + content.substring(end);
      setContent(newContent);
      setHasChanges(true);
      requestAnimationFrame(() => {
        textarea.selectionStart = textarea.selectionEnd = start + 2;
      });
    }
  };

  const lineCount = Math.max(content.split("\n").length, 20);

  if (!file) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-muted-foreground">
        <FileCode className="w-12 h-12 mb-3 opacity-30" />
        <p className="text-sm font-medium">No file open</p>
        <p className="text-xs mt-1">Select a file from the explorer to edit</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center border-b overflow-x-auto">
        <div className="flex items-center min-w-0">
          {openFiles.map((f) => (
            <div
              key={f.id}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs border-r shrink-0 transition-colors cursor-pointer ${
                f.id === file.id
                  ? "bg-background text-foreground"
                  : "bg-card text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => onSelectFile(f)}
              data-testid={`tab-file-${f.name}`}
            >
              <span className="truncate max-w-[120px]">{f.name}</span>
              {f.id === file.id && hasChanges && (
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
              )}
              <span
                role="button"
                className="ml-1 rounded-sm hover:bg-muted p-0.5 inline-flex"
                onClick={(e) => { e.stopPropagation(); onCloseFile(f.id); }}
                data-testid={`button-close-tab-${f.name}`}
              >
                <X className="w-3 h-3" />
              </span>
            </div>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2 px-2 shrink-0">
          <Badge variant="outline" className="text-[10px]">{getLanguageClass(file.name)}</Badge>
          {hasChanges && (
            <Button size="sm" variant="ghost" onClick={handleSave} data-testid="button-save-file">
              <Save className="w-3 h-3 mr-1" />
              Save
            </Button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-hidden">
        <ScrollArea className="h-full">
          <div className="flex min-h-full">
            <LineNumbers count={lineCount} />
            <textarea
              ref={textareaRef}
              value={content}
              onChange={(e) => handleChange(e.target.value)}
              onKeyDown={handleTab}
              className="flex-1 bg-transparent resize-none outline-none font-mono text-xs leading-[1.65rem] py-3 pr-4 min-h-full text-foreground placeholder:text-muted-foreground"
              spellCheck={false}
              data-testid="textarea-code-editor"
            />
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
