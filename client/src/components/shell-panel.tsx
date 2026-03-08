import { useState, useRef, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Loader2, Play, Terminal } from "lucide-react";
import type { Project, ProjectFile } from "@shared/schema";

interface ShellLine {
  type: "input" | "output" | "error" | "info" | "banner";
  text: string;
}

interface ShellPanelProps {
  projectId: string;
  project?: Project;
}

function detectStartCommand(project: Project, files: ProjectFile[]): { cmd: string; label: string } | null {
  const filePaths = files.map(f => f.path);
  const hasPackageJson = filePaths.some(f => f === "package.json" || f.endsWith("/package.json"));
  const hasRequirements = filePaths.some(f => f === "requirements.txt" || f.endsWith("/requirements.txt"));
  const hasGoMod = filePaths.some(f => f === "go.mod" || f.endsWith("/go.mod"));
  const hasMainPy = filePaths.some(f => f === "main.py" || f.endsWith("/main.py"));
  const hasMainGo = filePaths.some(f => f === "main.go" || f.endsWith("/main.go"));
  const hasIndexTs = filePaths.some(f => f.endsWith("index.ts") || f.endsWith("index.js"));

  const pkgFile = files.find(f => f.path === "package.json" || f.name === "package.json");
  if (pkgFile?.content) {
    try {
      const pkg = JSON.parse(pkgFile.content);
      if (pkg.scripts?.dev) return { cmd: "npm run dev", label: "npm run dev" };
      if (pkg.scripts?.start) return { cmd: "npm start", label: "npm start" };
    } catch (_) {}
  }

  if (hasPackageJson && project.language === "typescript") {
    if (hasIndexTs) return { cmd: "npx ts-node src/index.ts 2>/dev/null || npx ts-node index.ts", label: "ts-node index.ts" };
    return { cmd: "npm start", label: "npm start" };
  }

  if (hasPackageJson) return { cmd: "node src/index.js 2>/dev/null || node index.js", label: "node index.js" };

  if (hasMainPy || hasRequirements) {
    if (project.framework === "fastapi") return { cmd: "uvicorn main:app --reload --port 8000", label: "uvicorn main:app" };
    if (project.framework === "flask") return { cmd: "python main.py", label: "python main.py" };
    return { cmd: "python main.py 2>/dev/null || python3 main.py", label: "python main.py" };
  }

  if (hasGoMod || hasMainGo) return { cmd: "go run main.go", label: "go run main.go" };

  return null;
}

function detectInstallCommand(files: ProjectFile[]): string | null {
  const filePaths = files.map(f => f.path);
  if (filePaths.some(f => f === "package.json") || files.some(f => f.name === "package.json")) return "npm install";
  if (filePaths.some(f => f === "requirements.txt") || files.some(f => f.name === "requirements.txt")) return "pip install -r requirements.txt";
  if (filePaths.some(f => f === "go.mod") || files.some(f => f.name === "go.mod")) return "go mod download";
  return null;
}

export default function ShellPanel({ projectId, project }: ShellPanelProps) {
  const [lines, setLines] = useState<ShellLine[]>([]);
  const [input, setInput] = useState("");
  const [cwd, setCwd] = useState(`/tmp/devforge-projects/${projectId}`);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [initialized, setInitialized] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: files = [] } = useQuery<ProjectFile[]>({
    queryKey: ["/api/projects", projectId, "files"],
  });

  // Initialize shell with project context banner
  useEffect(() => {
    if (!initialized && project && files.length > 0) {
      setInitialized(true);
      const startCmd = detectStartCommand(project, files);
      const installCmd = detectInstallCommand(files);

      const bannerLines: ShellLine[] = [
        { type: "info", text: `SudoAI Shell — ${project.name}` },
        { type: "info", text: `Directory: /tmp/devforge-projects/${projectId}` },
        { type: "info", text: "" },
      ];

      if (installCmd) {
        bannerLines.push({ type: "info", text: `┌─ Install deps:  ${installCmd}` });
      }
      if (startCmd) {
        bannerLines.push({ type: "info", text: `├─ Start app:     ${startCmd.label}` });
        bannerLines.push({ type: "info", text: `└─ Or click ▶ Run App above` });
      }
      if (!startCmd) {
        bannerLines.push({ type: "info", text: `Type 'help' for available commands` });
      }
      bannerLines.push({ type: "info", text: "" });

      setLines(bannerLines);
    }
  }, [initialized, project, files, projectId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines]);

  const execMutation = useMutation({
    mutationFn: async (command: string) => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/shell`, { command, cwd });
      return res.json();
    },
    onSuccess: (result) => {
      const output: ShellLine[] = [];
      if (result.stdout) output.push({ type: "output", text: result.stdout });
      if (result.stderr) output.push({ type: "error", text: result.stderr });
      if (!result.stdout && !result.stderr) output.push({ type: "output", text: "" });
      if (result.cwd) setCwd(result.cwd);
      setLines(prev => [...prev, ...output]);
    },
    onError: (err: Error) => {
      setLines(prev => [...prev, { type: "error", text: `Error: ${err.message}` }]);
    },
  });

  const runCommand = (cmd: string) => {
    setLines(prev => [...prev, { type: "input", text: `$ ${cmd}` }]);
    setHistory(prev => [cmd, ...prev.slice(0, 49)]);
    setHistoryIndex(-1);
    execMutation.mutate(cmd);
  };

  const runCommandRef = useRef(runCommand);
  runCommandRef.current = runCommand;

  useEffect(() => {
    const handler = (e: Event) => {
      const dir = (e as CustomEvent).detail as string;
      const fullPath = dir.startsWith("/") ? dir : `/tmp/devforge-projects/${projectId}/${dir}`;
      runCommandRef.current(`cd "${fullPath}"`);
      inputRef.current?.focus();
    };
    window.addEventListener("shell:cd", handler);
    return () => window.removeEventListener("shell:cd", handler);
  }, [projectId]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && input.trim()) {
      const cmd = input.trim();
      setInput("");

      if (cmd === "clear") {
        setLines([{ type: "info", text: "" }]);
        return;
      }
      if (cmd === "help") {
        setLines(prev => [
          ...prev,
          { type: "output", text: "Available commands:" },
          { type: "output", text: "  ls, cat, pwd, echo, node, python3, git, npm, curl, env" },
          { type: "output", text: "  clear — clear terminal  |  Ctrl+L — clear" },
        ]);
        return;
      }

      runCommand(cmd);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (history.length > 0) {
        const idx = Math.min(historyIndex + 1, history.length - 1);
        setHistoryIndex(idx);
        setInput(history[idx]);
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyIndex > 0) {
        const idx = historyIndex - 1;
        setHistoryIndex(idx);
        setInput(history[idx]);
      } else {
        setHistoryIndex(-1);
        setInput("");
      }
    } else if (e.key === "l" && e.ctrlKey) {
      e.preventDefault();
      setLines([{ type: "info", text: "" }]);
    }
  };

  const startCmd = project && files.length > 0 ? detectStartCommand(project, files) : null;
  const installCmd = files.length > 0 ? detectInstallCommand(files) : null;
  const promptPath = cwd.replace(`/tmp/devforge-projects/${projectId}`, "~");

  return (
    <div
      className="h-full flex flex-col bg-[#0d1117] font-mono text-sm"
      onClick={() => inputRef.current?.focus()}
      data-testid="panel-shell"
    >
      {/* Quick action buttons */}
      {(startCmd || installCmd) && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[#30363d] bg-[#161b22] shrink-0">
          {installCmd && (
            <button
              className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[10px] font-sans bg-[#21262d] border border-[#30363d] text-[#8b949e] hover:text-[#e6edf3] hover:border-[#58a6ff] transition-colors"
              onClick={() => runCommand(installCmd)}
              disabled={execMutation.isPending}
              data-testid="button-shell-install"
            >
              <Terminal className="w-3 h-3" />
              Install
            </button>
          )}
          {startCmd && (
            <button
              className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[10px] font-sans bg-[#238636] border border-[#2ea043] text-white hover:bg-[#2ea043] transition-colors"
              onClick={() => runCommand(startCmd.cmd)}
              disabled={execMutation.isPending}
              data-testid="button-shell-run-app"
            >
              <Play className="w-3 h-3" />
              Run App
            </button>
          )}
          <span className="text-[10px] text-[#484f58] font-sans ml-auto">{project?.language}/{project?.framework}</span>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-0.5">
        {lines.map((line, i) => (
          <div
            key={i}
            className={
              line.type === "input" ? "text-[#58a6ff]" :
              line.type === "error" ? "text-[#f85149]" :
              line.type === "info" ? "text-[#8b949e]" :
              line.type === "banner" ? "text-[#3fb950]" :
              "text-[#e6edf3]"
            }
            style={{ whiteSpace: "pre-wrap", wordBreak: "break-all", lineHeight: "1.5" }}
          >
            {line.text}
          </div>
        ))}
        {execMutation.isPending && (
          <div className="flex items-center gap-2 text-[#8b949e]">
            <Loader2 className="w-3 h-3 animate-spin" />
            <span>running...</span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-[#30363d] px-3 py-2 flex items-center gap-2">
        <span className="text-[#3fb950] select-none text-xs">{promptPath}</span>
        <span className="text-[#e6edf3] select-none">$</span>
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          className="flex-1 bg-transparent outline-none text-[#e6edf3] placeholder:text-[#484f58] text-sm"
          placeholder="type a command..."
          autoComplete="off"
          spellCheck={false}
          data-testid="input-shell-command"
          disabled={execMutation.isPending}
        />
        {execMutation.isPending && <Loader2 className="w-3 h-3 animate-spin text-[#8b949e] shrink-0" />}
      </div>
    </div>
  );
}
