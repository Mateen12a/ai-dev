import { spawn, ChildProcess } from "child_process";
import path from "path";

const BASE_DIR = "/tmp/devforge-projects";

export interface RunningProcess {
  child: ChildProcess;
  port: number | null;
  status: "starting" | "running" | "crashed" | "stopped";
  startedAt: Date;
  command: string;
}

const running = new Map<string, RunningProcess>();

export function getProcess(projectId: string): RunningProcess | undefined {
  return running.get(projectId);
}

export function getAllRunning(): Map<string, RunningProcess> {
  return running;
}

const PORT_PATTERNS = [
  /https?:\/\/(?:localhost|0\.0\.0\.0|127\.0\.0\.1):(\d{3,5})/i,
  /(?:listening|running|started|server)\s+(?:on|at)\s+(?:port\s+)?(?:https?:\/\/[^:]+:)?(\d{3,5})/i,
  /port[:\s]+(\d{3,5})/i,
  /:(\d{3,5})\s*$/m,
];

function extractPort(text: string): number | null {
  for (const pattern of PORT_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      const port = parseInt(match[1]);
      if (port >= 1024 && port <= 65535) return port;
    }
  }
  return null;
}

export async function startProcess(
  projectId: string,
  command: string,
  env: Record<string, string> = {},
  onLog: (msg: string, type: string) => void,
  customCwd?: string
): Promise<{ success: boolean; message: string }> {
  await killProcess(projectId);

  const cwd = customCwd || env.PWD || path.join(BASE_DIR, projectId);
  const cleanEnv = { ...env };
  delete cleanEnv.PWD;

  const proc: RunningProcess = {
    child: null as any,
    port: null,
    status: "starting",
    startedAt: new Date(),
    command,
  };

  const child = spawn(command, [], {
    cwd,
    env: {
      ...process.env,
      ...cleanEnv,
      PORT: cleanEnv.PORT || "3000",
      NODE_ENV: "development",
      FORCE_COLOR: "0",
    },
    shell: true,
    detached: false,
  });

  proc.child = child;
  running.set(projectId, proc);

  const handleChunk = (data: Buffer, isStderr = false) => {
    const text = data.toString();

    if (!proc.port) {
      const port = extractPort(text);
      if (port) {
        proc.port = port;
        proc.status = "running";
        onLog(`✓ App running on port ${port}`, "success");
      }
    }

    const lines = text.split("\n").filter(l => l.trim());
    for (const line of lines) {
      const type = isStderr && /error|exception|fatal/i.test(line) ? "error" : "info";
      onLog(line, type);
    }
  };

  child.stdout?.on("data", d => handleChunk(d, false));
  child.stderr?.on("data", d => handleChunk(d, true));

  child.on("error", (err) => {
    proc.status = "crashed";
    running.delete(projectId);
    onLog(`Failed to start: ${err.message}`, "error");
  });

  child.on("exit", (code, signal) => {
    running.delete(projectId);
    if (signal === "SIGTERM" || signal === "SIGKILL") {
      onLog("Process stopped.", "system");
    } else {
      onLog(`Process exited with code ${code ?? "?"}`, code === 0 ? "success" : "error");
    }
  });

  return { success: true, message: `Started: ${command}` };
}

export function killProcess(projectId: string): Promise<void> {
  return new Promise(resolve => {
    const proc = running.get(projectId);
    if (!proc) return resolve();

    running.delete(projectId);

    try {
      proc.child.kill("SIGTERM");
      const t = setTimeout(() => {
        try { proc.child.kill("SIGKILL"); } catch (_) {}
        resolve();
      }, 2000);
      proc.child.on("exit", () => { clearTimeout(t); resolve(); });
    } catch (_) {
      resolve();
    }
  });
}

/** Return the shallowest package.json file from a list (fewest path segments). */
function shallowestPkg(
  files: Array<{ path: string; name: string; content?: string }>
): { path: string; name: string; content?: string } | undefined {
  return files
    .filter(f => f.name === "package.json")
    .sort((a, b) => a.path.split("/").length - b.path.split("/").length)[0];
}

export function detectStartCommand(
  language: string,
  framework: string,
  files: Array<{ path: string; name: string; content: string }>
): string {
  const agentConfigFile = files.find(f => f.name === ".agent.json" || f.path === ".agent.json");
  if (agentConfigFile?.content) {
    try {
      const cfg = JSON.parse(agentConfigFile.content);
      if (cfg.run) return cfg.run;
    } catch (_) {}
  }

  const pkgFile = shallowestPkg(files);
  if (pkgFile?.content) {
    try {
      const pkg = JSON.parse(pkgFile.content);
      if (pkg.scripts?.dev) return "npm run dev";
      if (pkg.scripts?.start) return "npm start";
    } catch (_) {}
  }

  const hasIndexTs = files.some(f => f.name === "index.ts");
  const hasMainTs = files.some(f => f.name === "main.ts");
  const hasIndexJs = files.some(f => f.name === "index.js");
  const hasMainPy = files.some(f => f.name === "main.py");

  if (language === "typescript" || framework === "express" || framework === "nextjs") {
    if (hasIndexTs) return "npx tsx src/index.ts 2>/dev/null || npx tsx index.ts";
    if (hasMainTs) return "npx tsx main.ts";
    if (hasIndexJs) return "node src/index.js 2>/dev/null || node index.js";
    return "npm start";
  }

  if (language === "python") {
    if (framework === "fastapi") return "python3 -m uvicorn main:app --host 0.0.0.0 --port 3000 --reload";
    if (hasMainPy) return "python3 main.py";
    return "python3 main.py";
  }

  if (language === "go") return "go run main.go";
  if (language === "rust") return "cargo run";

  return "npm start";
}

/** Returns install commands for all package.json directories, shallowest first.
 *  Skips a nested dir if the parent already runs concurrent installs via postinstall.
 */
export function detectInstallCommands(
  files: Array<{ path: string; name: string }>,
  projectRootDir: string
): string[] {
  const cmds: string[] = [];

  const pkgFiles = files
    .filter(f => f.name === "package.json")
    .sort((a, b) => a.path.split("/").length - b.path.split("/").length);

  if (pkgFiles.length === 0) {
    if (files.some(f => f.name === "requirements.txt")) return ["pip install -r requirements.txt"];
    if (files.some(f => f.name === "go.mod")) return ["go mod download"];
    return [];
  }

  // Always install the root (shallowest) first
  cmds.push("npm install");

  // Also install immediate sub-directories that have their own package.json
  const rootDepth = pkgFiles[0].path.split("/").length;
  for (const pf of pkgFiles.slice(1)) {
    const depth = pf.path.split("/").length;
    if (depth === rootDepth + 1) {
      const subDir = pf.path.split("/").slice(0, -1).join("/");
      // Get relative subDir within the workingDir (strip the workingDir prefix)
      const rootParts = pkgFiles[0].path.split("/").slice(0, -1);
      const subParts = pf.path.split("/").slice(0, -1);
      const rel = subParts.slice(rootParts.length).join("/");
      if (rel) cmds.push(`cd ${rel} && npm install`);
    }
  }

  return cmds;
}

/** Legacy single-command version (used by shell panel directly). */
export function detectInstallCommand(
  files: Array<{ path: string; name: string }>
): string | null {
  if (files.some(f => f.name === "package.json")) return "npm install";
  if (files.some(f => f.name === "requirements.txt")) return "pip install -r requirements.txt";
  if (files.some(f => f.name === "go.mod")) return "go mod download";
  return null;
}
