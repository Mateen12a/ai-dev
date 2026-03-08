import { useState, useRef, useEffect } from "react";
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
  FolderPlus, Terminal, Copy, Download, Trash2, Pencil, Search
} from "lucide-react";

function getFileIcon(name: string) {
  const ext = name.split(".").pop()?.toLowerCase();
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
    default:
      return <File className="w-3.5 h-3.5 text-muted-foreground shrink-0" />;
  }
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
}

function TreeNode({
  node, depth, selectedFile, onSelect,
  onDeleteFile, onRenameFile, onCreateInDir, onOpenShellAt, projectId
}: TreeNodeProps) {
  const [open, setOpen] = useState(depth < 2);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(node.name);
  const [creatingInside, setCreatingInside] = useState<"file" | "folder" | null>(null);
  const [newItemName, setNewItemName] = useState("");
  const renameRef = useRef<HTMLInputElement>(null);
  const isSelected = node.file && selectedFile === node.file.id;

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
            <div>
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
                  onClick={() => setOpen(!open)}
                  data-testid={`button-folder-${node.name}`}
                >
                  {open ? <ChevronDown className="w-3 h-3 shrink-0" /> : <ChevronRight className="w-3 h-3 shrink-0" />}
                  {open ? <FolderOpen className="w-3.5 h-3.5 text-amber-400 shrink-0" /> : <Folder className="w-3.5 h-3.5 text-amber-400 shrink-0" />}
                  <span className="truncate">{node.name}</span>
                </button>
              )}
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent className="w-56">
            {sharedMenuItems}
          </ContextMenuContent>
        </ContextMenu>

        {open && (
          <>
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
              />
            ))}
            {creatingInside && (
              <div className="flex items-center gap-1 py-0.5" style={{ paddingLeft: `${(depth + 1) * 12 + 4}px` }}>
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
          </>
        )}
      </div>
    );
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div>
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

export function FileExplorer({
  files, selectedFile, onSelectFile, onCreateFile,
  onDeleteFile, onRenameFile, onOpenShellAt, projectId
}: FileExplorerProps) {
  const [creating, setCreating] = useState<"file" | "folder" | null>(null);
  const [newName, setNewName] = useState("");
  const tree = buildTree(files);

  const handleCreate = () => {
    if (newName.trim() && creating) {
      onCreateFile(newName.trim(), creating);
      setNewName("");
      setCreating(null);
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between gap-1 px-2 py-1.5 border-b">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Files</span>
        <div className="flex items-center gap-0.5">
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
          {tree.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center px-4">
              <File className="w-8 h-8 text-muted-foreground/50 mb-2" />
              <p className="text-xs text-muted-foreground">No files yet</p>
              <p className="text-[10px] text-muted-foreground/60 mt-0.5">Right-click to add</p>
            </div>
          ) : (
            tree.map((node) => (
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
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
