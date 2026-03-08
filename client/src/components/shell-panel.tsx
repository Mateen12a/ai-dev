import { useEffect, useRef, useCallback, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Play, Terminal, RotateCcw } from "lucide-react";
import type { Project, ProjectFile } from "@shared/schema";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";

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
  const termRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: files = [] } = useQuery<ProjectFile[]>({
    queryKey: ["/api/projects", projectId, "files"],
  });

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws/terminal?projectId=${projectId}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      if (fitAddonRef.current) {
        try { fitAddonRef.current.fit(); } catch (_) {}
      }
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "output" && xtermRef.current) {
          xtermRef.current.write(msg.data);
        } else if (msg.type === "exit") {
          xtermRef.current?.write("\r\n\x1b[1;33m[Process exited]\x1b[0m\r\n");
          setConnected(false);
        }
      } catch (_) {}
    };

    ws.onclose = () => {
      setConnected(false);
      reconnectTimerRef.current = setTimeout(() => {
        if (termRef.current) connect();
      }, 2000);
    };

    ws.onerror = () => {
      setConnected(false);
    };
  }, [projectId]);

  useEffect(() => {
    if (!termRef.current) return;

    const term = new XTerm({
      cursorBlink: true,
      cursorStyle: "bar",
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, Monaco, 'Courier New', monospace",
      lineHeight: 1.4,
      scrollback: 5000,
      allowTransparency: true,
      theme: {
        background: "#0d1117",
        foreground: "#e6edf3",
        cursor: "#58a6ff",
        cursorAccent: "#0d1117",
        selectionBackground: "#264f78",
        selectionForeground: "#e6edf3",
        black: "#484f58",
        red: "#ff7b72",
        green: "#3fb950",
        yellow: "#d29922",
        blue: "#58a6ff",
        magenta: "#bc8cff",
        cyan: "#39d2c0",
        white: "#e6edf3",
        brightBlack: "#6e7681",
        brightRed: "#ffa198",
        brightGreen: "#56d364",
        brightYellow: "#e3b341",
        brightBlue: "#79c0ff",
        brightMagenta: "#d2a8ff",
        brightCyan: "#56d4dd",
        brightWhite: "#f0f6fc",
      },
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.open(termRef.current);

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    setTimeout(() => {
      try { fitAddon.fit(); } catch (_) {}
    }, 50);

    term.onData((data) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "input", data }));
      }
    });

    term.onResize(({ cols, rows }) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "resize", cols, rows }));
      }
    });

    connect();

    const resizeObserver = new ResizeObserver(() => {
      try { fitAddon.fit(); } catch (_) {}
    });
    resizeObserver.observe(termRef.current);

    return () => {
      resizeObserver.disconnect();
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
      term.dispose();
    };
  }, [connect]);

  const sendCommand = useCallback((cmd: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "input", data: cmd + "\n" }));
    }
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      const dir = (e as CustomEvent).detail as string;
      const fullPath = dir.startsWith("/") ? dir : `/tmp/devforge-projects/${projectId}/${dir}`;
      sendCommand(`cd "${fullPath}"`);
    };
    window.addEventListener("shell:cd", handler);
    return () => window.removeEventListener("shell:cd", handler);
  }, [projectId, sendCommand]);

  const handleReconnect = () => {
    wsRef.current?.close();
    xtermRef.current?.clear();
    setTimeout(connect, 100);
  };

  const startCmd = project && files.length > 0 ? detectStartCommand(project, files) : null;
  const installCmd = files.length > 0 ? detectInstallCommand(files) : null;

  return (
    <div className="h-full flex flex-col bg-[#0d1117]" data-testid="panel-shell">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[#30363d] bg-[#161b22] shrink-0">
        {installCmd && (
          <button
            className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[10px] font-sans bg-[#21262d] border border-[#30363d] text-[#8b949e] hover:text-[#e6edf3] hover:border-[#58a6ff] transition-colors"
            onClick={() => sendCommand(installCmd)}
            data-testid="button-shell-install"
          >
            <Terminal className="w-3 h-3" />
            Install
          </button>
        )}
        {startCmd && (
          <button
            className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[10px] font-sans bg-[#238636] border border-[#2ea043] text-white hover:bg-[#2ea043] transition-colors"
            onClick={() => sendCommand(startCmd.cmd)}
            data-testid="button-shell-run-app"
          >
            <Play className="w-3 h-3" />
            Run App
          </button>
        )}
        <div className="flex items-center gap-2 ml-auto">
          <span className={`w-1.5 h-1.5 rounded-full ${connected ? "bg-[#3fb950]" : "bg-[#f85149]"}`} />
          <span className="text-[10px] text-[#484f58] font-sans">
            {connected ? "Connected" : "Disconnected"}
          </span>
          <button
            className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-sans text-[#8b949e] hover:text-[#e6edf3] transition-colors"
            onClick={handleReconnect}
            title="Reconnect terminal"
          >
            <RotateCcw className="w-3 h-3" />
          </button>
        </div>
      </div>

      <div
        ref={termRef}
        className="flex-1 overflow-hidden px-1 py-1"
        onClick={() => xtermRef.current?.focus()}
      />
    </div>
  );
}
