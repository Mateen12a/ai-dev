import { spawn, ChildProcess } from "child_process";
import path from "path";

const BASE_DIR = "/tmp/devforge-projects";

export interface RunningProcess {
  child: ChildProcess;
  port: number | null;
  status: "starting" | "running" | "crashed" | "stopped";
  startedAt: Date;
  command: string;
  label: string;
  restartCount: number;
}

const running = new Map<string, RunningProcess>();

function processKey(projectId: string, label: string): string {
  return `${projectId}:${label}`;
}

export function getProcess(projectId: string, label?: string): RunningProcess | undefined {
  if (label) {
    return running.get(processKey(projectId, label));
  }
  for (const [key, proc] of running) {
    if (key.startsWith(`${projectId}:`)) return proc;
  }
  return undefined;
}

export function getProcesses(projectId: string): RunningProcess[] {
  const result: RunningProcess[] = [];
  for (const [key, proc] of running) {
    if (key.startsWith(`${projectId}:`)) result.push(proc);
  }
  return result;
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
  customCwd?: string,
  label: string = "main"
): Promise<{ success: boolean; message: string }> {
  await killProcess(projectId, label);

  const cwd = customCwd || env.PWD || path.join(BASE_DIR, projectId);
  const cleanEnv = { ...env };
  delete cleanEnv.PWD;

  const existingProc = getProcess(projectId, label);
  const restartCount = existingProc ? existingProc.restartCount + 1 : 0;

  const proc: RunningProcess = {
    child: null as any,
    port: null,
    status: "starting",
    startedAt: new Date(),
    command,
    label,
    restartCount,
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
  const key = processKey(projectId, label);
  running.set(key, proc);

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
    running.delete(key);
    onLog(`Failed to start: ${err.message}`, "error");
  });

  child.on("exit", (code, signal) => {
    running.delete(key);
    if (signal === "SIGTERM" || signal === "SIGKILL") {
      onLog("Process stopped.", "system");
    } else {
      onLog(`Process exited with code ${code ?? "?"}`, code === 0 ? "success" : "error");
    }
  });

  return { success: true, message: `Started: ${command}` };
}

export function killProcess(projectId: string, label?: string): Promise<void> {
  if (label) {
    return killSingleProcess(processKey(projectId, label));
  }
  const keys = [...running.keys()].filter(k => k.startsWith(`${projectId}:`));
  return Promise.all(keys.map(k => killSingleProcess(k))).then(() => {});
}

function killSingleProcess(key: string): Promise<void> {
  return new Promise(resolve => {
    const proc = running.get(key);
    if (!proc) return resolve();

    proc.status = "stopped";
    running.delete(key);

    try {
      proc.child.kill("SIGTERM");
      const t = setTimeout(() => {
        try { proc.child.kill("SIGKILL"); } catch (_) {}
        resolve();
      }, 3000);
      proc.child.on("exit", () => { clearTimeout(t); resolve(); });
    } catch (_) {
      resolve();
    }
  });
}

export async function restartProcess(
  projectId: string,
  label: string,
  env: Record<string, string> = {},
  onLog: (msg: string, type: string) => void,
  customCwd?: string
): Promise<{ success: boolean; message: string }> {
  const key = processKey(projectId, label);
  const existing = running.get(key);
  if (!existing) {
    return { success: false, message: `No process found with label '${label}'` };
  }
  const command = existing.command;
  const restartCount = existing.restartCount + 1;

  await killProcess(projectId, label);

  const result = await startProcess(projectId, command, env, onLog, customCwd, label);

  const newProc = running.get(key);
  if (newProc) {
    newProc.restartCount = restartCount;
  }

  return result;
}

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

  cmds.push("npm install");

  const rootDepth = pkgFiles[0].path.split("/").length;
  for (const pf of pkgFiles.slice(1)) {
    const depth = pf.path.split("/").length;
    if (depth === rootDepth + 1) {
      const subDir = pf.path.split("/").slice(0, -1).join("/");
      const rootParts = pkgFiles[0].path.split("/").slice(0, -1);
      const subParts = pf.path.split("/").slice(0, -1);
      const rel = subParts.slice(rootParts.length).join("/");
      if (rel) cmds.push(`cd ${rel} && npm install`);
    }
  }

  return cmds;
}

export interface DetectedRuntime {
  language: string;
  framework: string;
  version: string | null;
  runCommand: string;
  installCommand: string | null;
  entryPoint: string | null;
  icon: string;
}

export function detectProjectRuntime(
  files: Array<{ path: string; name: string; content?: string }>
): DetectedRuntime {
  const hasFile = (name: string) => files.some(f => f.name === name || f.path === name || f.path.endsWith(`/${name}`));
  const getFileContent = (name: string) => files.find(f => f.name === name || f.path === name || f.path.endsWith(`/${name}`))?.content;

  if (hasFile("Cargo.toml")) {
    const content = getFileContent("Cargo.toml") || "";
    const nameMatch = content.match(/name\s*=\s*"([^"]+)"/);
    const editionMatch = content.match(/edition\s*=\s*"([^"]+)"/);
    return {
      language: "rust",
      framework: nameMatch ? nameMatch[1] : "rust",
      version: editionMatch ? `Edition ${editionMatch[1]}` : null,
      runCommand: "cargo run",
      installCommand: "cargo build",
      entryPoint: "src/main.rs",
      icon: "🦀",
    };
  }

  if (hasFile("go.mod")) {
    const content = getFileContent("go.mod") || "";
    const goVersionMatch = content.match(/^go\s+(\S+)/m);
    const moduleMatch = content.match(/^module\s+(\S+)/m);
    return {
      language: "go",
      framework: moduleMatch ? moduleMatch[1].split("/").pop() || "go" : "go",
      version: goVersionMatch ? `Go ${goVersionMatch[1]}` : null,
      runCommand: "go run .",
      installCommand: "go mod download",
      entryPoint: "main.go",
      icon: "🐹",
    };
  }

  if (hasFile("requirements.txt") || hasFile("setup.py") || hasFile("pyproject.toml") || hasFile("Pipfile")) {
    let framework = "python";
    let runCommand = "python3 main.py";
    let entryPoint = "main.py";

    const reqContent = getFileContent("requirements.txt") || "";
    const pyprojectContent = getFileContent("pyproject.toml") || "";
    const allPyContent = reqContent + " " + pyprojectContent;

    if (/fastapi/i.test(allPyContent)) {
      framework = "fastapi";
      runCommand = "python3 -m uvicorn main:app --host 0.0.0.0 --port 3000 --reload";
    } else if (/flask/i.test(allPyContent)) {
      framework = "flask";
      runCommand = "python3 -m flask run --host 0.0.0.0 --port 3000";
      entryPoint = "app.py";
    } else if (/django/i.test(allPyContent)) {
      framework = "django";
      runCommand = "python3 manage.py runserver 0.0.0.0:3000";
      entryPoint = "manage.py";
    } else if (/streamlit/i.test(allPyContent)) {
      framework = "streamlit";
      runCommand = "python3 -m streamlit run main.py --server.port 3000 --server.address 0.0.0.0";
    }

    if (hasFile("app.py") && framework === "python") entryPoint = "app.py";

    let installCommand: string | null = "pip install -r requirements.txt";
    if (hasFile("Pipfile")) installCommand = "pipenv install";
    else if (hasFile("pyproject.toml") && !hasFile("requirements.txt")) installCommand = "pip install -e .";

    return { language: "python", framework, version: null, runCommand, installCommand, entryPoint, icon: "🐍" };
  }

  if (hasFile("package.json")) {
    const content = getFileContent("package.json") || "{}";
    let framework = "node";
    let version: string | null = null;
    let runCommand = "npm start";
    let entryPoint: string | null = null;

    try {
      const pkg = JSON.parse(content);
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

      if (allDeps["next"]) framework = "nextjs";
      else if (allDeps["nuxt"]) framework = "nuxt";
      else if (allDeps["@angular/core"]) framework = "angular";
      else if (allDeps["vue"]) framework = "vue";
      else if (allDeps["svelte"]) framework = "svelte";
      else if (allDeps["react"]) framework = "react";
      else if (allDeps["express"]) framework = "express";
      else if (allDeps["fastify"]) framework = "fastify";
      else if (allDeps["hono"]) framework = "hono";
      else if (allDeps["koa"]) framework = "koa";

      if (pkg.scripts?.dev) runCommand = "npm run dev";
      else if (pkg.scripts?.start) runCommand = "npm start";

      if (pkg.main) entryPoint = pkg.main;
      version = pkg.engines?.node ? `Node ${pkg.engines.node}` : null;
    } catch (_) {}

    const hasTsFiles = files.some(f => f.name.endsWith(".ts") || f.name.endsWith(".tsx"));
    const language = hasTsFiles ? "typescript" : "javascript";

    return { language, framework, version, runCommand, installCommand: "npm install", entryPoint, icon: language === "typescript" ? "🔷" : "🟨" };
  }

  if (hasFile("Gemfile")) {
    return { language: "ruby", framework: "ruby", version: null, runCommand: "ruby main.rb", installCommand: "bundle install", entryPoint: "main.rb", icon: "💎" };
  }

  if (hasFile("pom.xml") || hasFile("build.gradle")) {
    return {
      language: "java",
      framework: hasFile("pom.xml") ? "maven" : "gradle",
      version: null,
      runCommand: hasFile("pom.xml") ? "mvn spring-boot:run" : "./gradlew bootRun",
      installCommand: hasFile("pom.xml") ? "mvn install" : "./gradlew build",
      entryPoint: null,
      icon: "☕",
    };
  }

  return { language: "unknown", framework: "unknown", version: null, runCommand: "echo 'No run command detected'", installCommand: null, entryPoint: null, icon: "📄" };
}

export function detectInstallCommand(
  files: Array<{ path: string; name: string }>
): string | null {
  if (files.some(f => f.name === "package.json")) return "npm install";
  if (files.some(f => f.name === "requirements.txt")) return "pip install -r requirements.txt";
  if (files.some(f => f.name === "go.mod")) return "go mod download";
  return null;
}
