import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import type { ProjectFile } from "@shared/schema";
import {
  ContextMenu, ContextMenuContent, ContextMenuItem,
  ContextMenuSeparator, ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  File, Folder, FolderOpen, ChevronRight, ChevronDown,
  Plus, FileCode, FileJson, FileText, FileCog, FilePlus,
  FolderPlus, Terminal, Copy, Download, Trash2, Pencil, Search,
  ImageIcon, Lock, GitBranch, Database, Upload
} from "lucide-react";

function getFileIcon(name: string) {
  const ext = name.split(".").pop()?.toLowerCase();
  const lowerName = name.toLowerCase();

  if (lowerName.startsWith(".env")) {
    return <Lock className="w-3.5 h-3.5 text-yellow-600 shrink-0" />;
  }
  if (lowerName === ".gitignore" || lowerName === ".dockerignore") {
    return <GitBranch className="w-3.5 h-3.5 text-orange-400 shrink-0" />;
  }

  switch (ext) {
    case "ts": case "tsx": case "js": case "jsx":
      return <FileCode className="w-3.5 h-3.5 text-blue-400 shrink-0" />;
    case "json":
      return <FileJson className="w-3.5 h-3.5 text-yellow-400 shrink-0" />;
    case "md": case "txt":
      return <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0" />;
    case "yml": case "yaml": case "toml":
      return <FileCog className="w-3.5 h-3.5 text-purple-400 shrink-0" />;
    case "css": case "scss":
      return <FileCode className="w-3.5 h-3.5 text-pink-400 shrink-0" />;
    case "py":
      return <FileCode className="w-3.5 h-3.5 text-green-400 shrink-0" />;
    case "html":
      return <FileCode className="w-3.5 h-3.5 text-orange-400 shrink-0" />;
    case "go":
      return <FileCode className="w-3.5 h-3.5 text-cyan-400 shrink-0" />;
    case "rs":
      return <FileCode className="w-3.5 h-3.5 text-orange-500 shrink-0" />;
    case "svg": case "png": case "jpg": case "gif": case "ico":
      return <ImageIcon className="w-3.5 h-3.5 text-emerald-400 shrink-0" />;
    case "sh": case "bash":
      return <Terminal className="w-3.5 h-3.5 text-green-500 shrink-0" />;
    case "sql":
      return <Database className="w-3.5 h-3.5 text-blue-500 shrink-0" />;
    default:
      return <File className="w-3.5 h-3.5 text-muted-foreground shrink-0" />;
  }
}

function getLineCount(file?: ProjectFile): number | null {
  if (!file || !file.content) return null;
  return file.content.split("\n").length;
}

interface FileNode {
  name: string;
  path: string;
  type: "file" | "folder";
  children?: FileNode[];
  file?: ProjectFile;
}

function buildTree(files: ProjectFile[]): FileNode[] {
  const root: FileNode[] = [];
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));

  for (const file of sorted) {
    const parts = file.path.split("/").filter(Boolean);
    let current = root;
    let currentPath = "";

    for (let i = 0; i < parts.length; i++) {
      currentPath += (currentPath ? "/" : "") + parts[i];
      const isLast = i === parts.length - 1;

      if (isLast && file.type === "file") {
        current.push({ name: parts[i], path: currentPath, type: "file", file });
      } else {
        let folder = current.find((n) => n.name === parts[i] && n.type === "folder");
        if (!folder) {
          folder = { name: parts[i], path: currentPath, type: "folder", children: [] };
          current.push(folder);
        }
        current = folder.children!;
      }
    }
  }

  function sortNodes(nodes: FileNode[]): FileNode[] {
    return nodes.sort((a, b) => {
      if (a.type === "folder" && b.type === "file") return -1;
      if (a.type === "file" && b.type === "folder") return 1;
      return a.name.localeCompare(b.name);
    }).map(n => n.children ? { ...n, children: sortNodes(n.children) } : n);
  }

  return sortNodes(root);
}

function filterTree(nodes: FileNode[], query: string): FileNode[] {
  if (!query) return nodes;
  const lower = query.toLowerCase();

  return nodes.reduce<FileNode[]>((acc, node) => {
    if (node.type === "file") {
      if (node.name.toLowerCase().includes(lower)) {
        acc.push(node);
      }
    } else {
      const filteredChildren = filterTree(node.children || [], query);
      if (filteredChildren.length > 0 || node.name.toLowerCase().includes(lower)) {
        acc.push({ ...node, children: filteredChildren });
      }
    }
    return acc;
  }, []);
}

function IndentGuides({ depth }: { depth: number }) {
  if (depth === 0) return null;
  return (
    <div className="absolute left-0 top-0 bottom-0 flex" style={{ pointerEvents: "none" }}>
      {Array.from({ length: depth }).map((_, i) => (
        <div
          key={i}
          className="border-l border-dashed border-border/20"
          style={{ marginLeft: `${i * 12 + 10}px`, position: "absolute", top: 0, bottom: 0 }}
        />
      ))}
    </div>
  );
}

interface TreeNodeProps {
  node: FileNode;
  depth: number;
  selectedFile: string | null;
  onSelect: (file: ProjectFile) => void;
  onDeleteFile: (file: ProjectFile) => void;
  onRenameFile: (file: ProjectFile, newName: string) => void;
  onCreateInDir: (dirPath: string, type: "file" | "folder") => void;
  onOpenShellAt: (dirPath: string) => void;
  projectId: string;
  forceOpen?: boolean;
}

function TreeNode({
  node, depth, selectedFile, onSelect,
  onDeleteFile, onRenameFile, onCreateInDir, onOpenShellAt, projectId, forceOpen
}: TreeNodeProps) {
  const [open, setOpen] = useState(depth < 2);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(node.name);
  const [creatingInside, setCreatingInside] = useState<"file" | "folder" | null>(null);
  const [newItemName, setNewItemName] = useState("");
  const renameRef = useRef<HTMLInputElement>(null);
  const isSelected = node.file && selectedFile === node.file.id;

  const effectiveOpen = forceOpen || open;

  useEffect(() => {
    if (renaming) renameRef.current?.select();
  }, [renaming]);

  const startRename = () => {
    setRenameValue(node.name);
    setRenaming(true);
  };

  const commitRename = () => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== node.name && node.file) {
      onRenameFile(node.file, trimmed);
    }
    setRenaming(false);
  };

  const copyPath = () => {
    navigator.clipboard.writeText(node.path).catch(() => {});
  };

  const downloadFile = () => {
    if (node.file) {
      const a = document.createElement("a");
      a.href = `/api/projects/${projectId}/files/${node.file.id}/download`;
      a.download = node.name;
      a.click();
    }
  };

  const commitCreate = () => {
    const trimmed = newItemName.trim();
    if (trimmed && creatingInside) {
      const dirPath = node.type === "folder" ? node.path : node.path.split("/").slice(0, -1).join("/");
      onCreateInDir(dirPath ? `${dirPath}/${trimmed}` : trimmed, creatingInside);
      setNewItemName("");
      setCreatingInside(null);
    }
  };

  const indent = depth * 12 + 4;
  const lineCount = getLineCount(node.file);

  const sharedMenuItems = (
    <>
      <ContextMenuItem onClick={startRename} data-testid={`menu-rename-${node.name}`}>
        <Pencil className="w-3.5 h-3.5 mr-2 text-muted-foreground" /> Rename
      </ContextMenuItem>
      <ContextMenuSeparator />
      {node.type === "folder" && (
        <>
          <ContextMenuItem onClick={() => { setCreatingInside("file"); setOpen(true); }} data-testid={`menu-addfile-${node.name}`}>
            <FilePlus className="w-3.5 h-3.5 mr-2 text-muted-foreground" /> Add file
          </ContextMenuItem>
          <ContextMenuItem onClick={() => { setCreatingInside("folder"); setOpen(true); }} data-testid={`menu-addfolder-${node.name}`}>
            <FolderPlus className="w-3.5 h-3.5 mr-2 text-muted-foreground" /> Add folder
          </ContextMenuItem>
          <ContextMenuItem onClick={() => onOpenShellAt(node.path)} data-testid={`menu-shell-${node.name}`}>
            <Terminal className="w-3.5 h-3.5 mr-2 text-muted-foreground" /> Open shell here
          </ContextMenuItem>
          <ContextMenuSeparator />
        </>
      )}
      <ContextMenuItem onClick={copyPath} data-testid={`menu-copypath-${node.name}`}>
        <Copy className="w-3.5 h-3.5 mr-2 text-muted-foreground" /> Copy file path
      </ContextMenuItem>
      {node.type === "file" && (
        <ContextMenuItem onClick={downloadFile} data-testid={`menu-download-${node.name}`}>
          <Download className="w-3.5 h-3.5 mr-2 text-muted-foreground" /> Download
        </ContextMenuItem>
      )}
      <ContextMenuSeparator />
      <ContextMenuItem
        className="text-destructive focus:text-destructive"
        onClick={() => node.file && onDeleteFile(node.file)}
        data-testid={`menu-delete-${node.name}`}
      >
        <Trash2 className="w-3.5 h-3.5 mr-2" /> Delete
      </ContextMenuItem>
    </>
  );

  if (node.type === "folder") {
    return (
      <div>
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div className="relative">
              <IndentGuides depth={depth} />
              {renaming ? (
                <div className="flex items-center gap-1 py-0.5" style={{ paddingLeft: `${indent}px` }}>
                  <ChevronDown className="w-3 h-3 shrink-0 opacity-50" />
                  <FolderOpen className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <Input
                    ref={renameRef}
                    className="h-5 text-xs py-0 px-1 flex-1"
                    value={renameValue}
                    onChange={e => setRenameValue(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === "Enter") commitRename();
                      if (e.key === "Escape") setRenaming(false);
                    }}
                    onBlur={commitRename}
                    data-testid={`input-rename-${node.name}`}
                  />
                </div>
              ) : (
                <button
                  className="flex items-center gap-1 w-full text-left py-1 px-1 rounded-sm text-xs hover:bg-accent/50 transition-colors group"
                  style={{ paddingLeft: `${indent}px` }}
                  onClick={() => setOpen(!effectiveOpen)}
                  data-testid={`button-folder-${node.name}`}
                >
                  {effectiveOpen ? <ChevronDown className="w-3 h-3 shrink-0" /> : <ChevronRight className="w-3 h-3 shrink-0" />}
                  {effectiveOpen ? <FolderOpen className="w-3.5 h-3.5 text-amber-400 shrink-0" /> : <Folder className="w-3.5 h-3.5 text-amber-400 shrink-0" />}
                  <span className="truncate">{node.name}</span>
                </button>
              )}
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent className="w-56">
            {sharedMenuItems}
          </ContextMenuContent>
        </ContextMenu>

        <div
          className="overflow-hidden transition-all duration-200 ease-in-out"
          style={{
            maxHeight: effectiveOpen ? "9999px" : "0px",
            opacity: effectiveOpen ? 1 : 0,
          }}
        >
          {node.children?.map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedFile={selectedFile}
              onSelect={onSelect}
              onDeleteFile={onDeleteFile}
              onRenameFile={onRenameFile}
              onCreateInDir={onCreateInDir}
              onOpenShellAt={onOpenShellAt}
              projectId={projectId}
              forceOpen={forceOpen}
            />
          ))}
          {creatingInside && (
            <div className="flex items-center gap-1 py-0.5 relative" style={{ paddingLeft: `${(depth + 1) * 12 + 4}px` }}>
              <IndentGuides depth={depth + 1} />
              {creatingInside === "folder"
                ? <Folder className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                : <File className="w-3.5 h-3.5 shrink-0" />}
              <Input
                autoFocus
                className="h-5 text-xs py-0 px-1 flex-1"
                placeholder={creatingInside === "file" ? "filename.ts" : "folder-name"}
                value={newItemName}
                onChange={e => setNewItemName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter") commitCreate();
                  if (e.key === "Escape") { setCreatingInside(null); setNewItemName(""); }
                }}
                onBlur={() => { setCreatingInside(null); setNewItemName(""); }}
                data-testid="input-new-item-in-folder"
              />
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="relative">
          <IndentGuides depth={depth} />
          {renaming ? (
            <div
              className="flex items-center gap-1.5 py-0.5 px-1"
              style={{ paddingLeft: `${depth * 12 + 16}px` }}
            >
              {getFileIcon(node.name)}
              <Input
                ref={renameRef}
                className="h-5 text-xs py-0 px-1 flex-1"
                value={renameValue}
                onChange={e => setRenameValue(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter") commitRename();
                  if (e.key === "Escape") setRenaming(false);
                }}
                onBlur={commitRename}
                data-testid={`input-rename-${node.name}`}
              />
            </div>
          ) : (
            <button
              className={`flex items-center gap-1.5 w-full text-left py-1 px-1 rounded-sm text-xs transition-colors group ${
                isSelected ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
              }`}
              style={{ paddingLeft: `${depth * 12 + 16}px` }}
              onClick={() => node.file && onSelect(node.file)}
              data-testid={`button-file-${node.name}`}
            >
              {getFileIcon(node.name)}
              <span className="truncate flex-1">{node.name}</span>
              {lineCount !== null && (
                <span className="text-[10px] text-muted-foreground/60 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                  {lineCount} lines
                </span>
              )}
            </button>
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        {sharedMenuItems}
      </ContextMenuContent>
    </ContextMenu>
  );
}

interface FileExplorerProps {
  files: ProjectFile[];
  selectedFile: string | null;
  onSelectFile: (file: ProjectFile) => void;
  onCreateFile: (path: string, type: "file" | "folder") => void;
  onDeleteFile: (file: ProjectFile) => void;
  onRenameFile: (file: ProjectFile, newName: string) => void;
  onOpenShellAt: (dirPath: string) => void;
  projectId: string;
}

function getLanguageFromFilename(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "ts": case "tsx": return "typescript";
    case "js": case "jsx": return "javascript";
    case "json": return "json";
    case "html": return "html";
    case "css": return "css";
    case "scss": return "scss";
    case "md": return "markdown";
    case "py": return "python";
    case "go": return "go";
    case "rs": return "rust";
    case "sql": return "sql";
    case "yml": case "yaml": return "yaml";
    case "sh": case "bash": return "shell";
    default: return "plaintext";
  }
}

export function FileExplorer({
  files, selectedFile, onSelectFile, onCreateFile,
  onDeleteFile, onRenameFile, onOpenShellAt, projectId
}: FileExplorerProps) {
  const [creating, setCreating] = useState<"file" | "folder" | null>(null);
  const [newName, setNewName] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadingCount, setUploadingCount] = useState(0);
  const dragCounterRef = useRef(0);

  const tree = useMemo(() => buildTree(files), [files]);
  const filteredTree = useMemo(() => filterTree(tree, searchQuery), [tree, searchQuery]);
  const isFiltering = searchQuery.trim().length > 0;

  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
  }, [searchOpen]);

  const handleCreate = () => {
    if (newName.trim() && creating) {
      onCreateFile(newName.trim(), creating);
      setNewName("");
      setCreating(null);
    }
  };

  const handleFileDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    dragCounterRef.current = 0;

    const droppedFiles = Array.from(e.dataTransfer.files);
    if (droppedFiles.length === 0) return;

    setUploadingCount(droppedFiles.length);

    const uploadPromises = droppedFiles.map((file) => {
      return new Promise<void>((resolve) => {
        const reader = new FileReader();
        reader.onload = async () => {
          try {
            const content = reader.result as string;
            await fetch(`/api/projects/${projectId}/files`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                name: file.name,
                path: file.name,
                content,
                type: "file" as const,
                language: getLanguageFromFilename(file.name),
              }),
            });
          } catch (err) {
            console.error(`Failed to upload ${file.name}:`, err);
          }
          resolve();
        };
        reader.onerror = () => resolve();
        reader.readAsText(file);
      });
    });

    await Promise.all(uploadPromises);
    setUploadingCount(0);
  }, [projectId]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer.types.includes("Files")) {
      setIsDragging(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDragging(false);
    }
  }, []);

  return (
    <div
      className="h-full flex flex-col relative"
      onDrop={handleFileDrop}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
    >
      {isDragging && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-primary/10 border-2 border-dashed border-primary rounded-md pointer-events-none">
          <Upload className="w-8 h-8 text-primary mb-2" />
          <p className="text-sm font-medium text-primary">Drop files to upload</p>
          <p className="text-xs text-muted-foreground mt-0.5">Files will be added to the project</p>
        </div>
      )}

      {uploadingCount > 0 && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-background/80 backdrop-blur-sm pointer-events-none">
          <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full mb-2" />
          <p className="text-xs text-muted-foreground">Uploading {uploadingCount} file{uploadingCount > 1 ? "s" : ""}...</p>
        </div>
      )}

      <div className="flex items-center justify-between gap-1 px-2 py-1.5 border-b">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Files</span>
        <div className="flex items-center gap-0.5">
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            onClick={() => { setSearchOpen(!searchOpen); if (searchOpen) setSearchQuery(""); }}
            data-testid="button-search-toggle"
            title="Search files"
          >
            <Search className="w-3.5 h-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            onClick={() => setCreating("file")}
            data-testid="button-new-file"
            title="New file"
          >
            <FilePlus className="w-3.5 h-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            onClick={() => setCreating("folder")}
            data-testid="button-new-folder"
            title="New folder"
          >
            <FolderPlus className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {searchOpen && (
        <div className="px-2 py-1.5 border-b">
          <div className="flex items-center gap-1.5">
            <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <Input
              ref={searchRef}
              className="h-6 text-xs"
              placeholder="Search files..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") { setSearchOpen(false); setSearchQuery(""); }
              }}
              data-testid="input-search-files"
            />
          </div>
        </div>
      )}

      {creating && (
        <div className="px-2 py-1.5 border-b">
          <div className="flex items-center gap-1.5">
            {creating === "folder" ? <Folder className="w-3.5 h-3.5 text-amber-400 shrink-0" /> : <File className="w-3.5 h-3.5 shrink-0" />}
            <Input
              autoFocus
              className="h-6 text-xs"
              placeholder={creating === "file" ? "filename.ts" : "folder-name"}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate();
                if (e.key === "Escape") { setCreating(null); setNewName(""); }
              }}
              onBlur={() => { setCreating(null); setNewName(""); }}
              data-testid="input-new-filename"
            />
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        <div className="py-1 px-1">
          {filteredTree.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center px-4">
              <File className="w-8 h-8 text-muted-foreground/50 mb-2" />
              <p className="text-xs text-muted-foreground">{isFiltering ? "No matching files" : "No files yet"}</p>
              <p className="text-[10px] text-muted-foreground/60 mt-0.5">{isFiltering ? "Try a different search" : "Right-click to add"}</p>
            </div>
          ) : (
            filteredTree.map((node) => (
              <TreeNode
                key={node.path}
                node={node}
                depth={0}
                selectedFile={selectedFile}
                onSelect={onSelectFile}
                onDeleteFile={onDeleteFile}
                onRenameFile={onRenameFile}
                onCreateInDir={onCreateFile}
                onOpenShellAt={onOpenShellAt}
                projectId={projectId}
                forceOpen={isFiltering}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
