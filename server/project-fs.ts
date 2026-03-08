import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);
const BASE_DIR = "/tmp/devforge-projects";

export function getProjectDir(projectId: string): string {
  return path.join(BASE_DIR, projectId);
}

export async function ensureProjectDir(projectId: string): Promise<string> {
  const dir = getProjectDir(projectId);
  await fs.promises.mkdir(dir, { recursive: true });
  return dir;
}

export async function writeProjectFile(projectId: string, filePath: string, content: string): Promise<void> {
  const dir = getProjectDir(projectId);
  const fullPath = path.join(dir, filePath);
  await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.promises.writeFile(fullPath, content, "utf-8");
}

export async function syncProjectFiles(projectId: string, files: { path: string; content: string }[]): Promise<void> {
  await ensureProjectDir(projectId);
  for (const file of files) {
    await writeProjectFile(projectId, file.path, file.content);
  }
}

export async function initGit(projectId: string): Promise<void> {
  const dir = getProjectDir(projectId);
  await ensureProjectDir(projectId);
  try {
    await execAsync("git init", { cwd: dir });
    await execAsync('git config user.email "agent@devforge.ai"', { cwd: dir });
    await execAsync('git config user.name "DevForge Agent"', { cwd: dir });
  } catch (_) {}
}

export async function getGitStatus(projectId: string): Promise<string> {
  const dir = getProjectDir(projectId);
  try {
    const { stdout } = await execAsync("git status --short", { cwd: dir });
    return stdout || "nothing to commit, working tree clean";
  } catch {
    return "git not initialized";
  }
}

export async function gitAdd(projectId: string): Promise<void> {
  const dir = getProjectDir(projectId);
  try {
    await execAsync("git add -A", { cwd: dir });
  } catch (_) {}
}

export async function gitCommit(projectId: string, message: string): Promise<string> {
  const dir = getProjectDir(projectId);
  try {
    await execAsync("git add -A", { cwd: dir });
    const { stdout } = await execAsync(`git commit -m "${message.replace(/"/g, "'")}"`, { cwd: dir });
    return stdout;
  } catch (e: any) {
    return e.message || "commit failed";
  }
}

export async function getGitLog(projectId: string): Promise<string> {
  const dir = getProjectDir(projectId);
  try {
    const { stdout } = await execAsync('git log --oneline -20 --format="%H|%s|%an|%ar"', { cwd: dir });
    return stdout;
  } catch {
    return "";
  }
}

export async function getGitDiff(projectId: string, file?: string): Promise<string> {
  const dir = getProjectDir(projectId);
  try {
    const cmd = file ? `git diff HEAD -- "${file}"` : "git diff HEAD";
    const { stdout } = await execAsync(cmd, { cwd: dir });
    return stdout || "";
  } catch {
    return "";
  }
}

export async function getGitBranches(projectId: string): Promise<{ current: string; branches: string[] }> {
  const dir = getProjectDir(projectId);
  try {
    const { stdout } = await execAsync("git branch --format='%(refname:short)'", { cwd: dir });
    const branches = stdout.split("\n").map(b => b.trim()).filter(Boolean);
    const { stdout: current } = await execAsync("git branch --show-current", { cwd: dir });
    return { current: current.trim(), branches };
  } catch {
    return { current: "main", branches: ["main"] };
  }
}

export async function gitReset(projectId: string, hash: string): Promise<string> {
  const dir = getProjectDir(projectId);
  try {
    const { stdout, stderr } = await execAsync(`git reset --hard "${hash}"`, { cwd: dir });
    return stdout || stderr;
  } catch (e: any) {
    throw new Error(e.stderr || e.message);
  }
}

export async function gitCreateBranch(projectId: string, name: string): Promise<string> {
  const dir = getProjectDir(projectId);
  try {
    const { stdout } = await execAsync(`git checkout -b "${name}"`, { cwd: dir });
    return stdout;
  } catch (e: any) {
    throw new Error(e.stderr || e.message);
  }
}

export async function gitCheckout(projectId: string, branch: string): Promise<string> {
  const dir = getProjectDir(projectId);
  try {
    const { stdout } = await execAsync(`git checkout "${branch}"`, { cwd: dir });
    return stdout;
  } catch (e: any) {
    throw new Error(e.stderr || e.message);
  }
}

export async function gitStash(projectId: string, action: "push" | "pop"): Promise<string> {
  const dir = getProjectDir(projectId);
  try {
    const cmd = action === "push" ? "git stash push -m 'SudoAI stash'" : "git stash pop";
    const { stdout } = await execAsync(cmd, { cwd: dir });
    return stdout;
  } catch (e: any) {
    throw new Error(e.stderr || e.message);
  }
}

export async function execShell(
  projectId: string,
  command: string,
  cwd: string,
  env: Record<string, string> = {}
): Promise<{ stdout: string; stderr: string; exitCode: number; cwd: string }> {
  const projectDir = getProjectDir(projectId);
  await ensureProjectDir(projectId);

  const safeCommand = command.trim();

  const safeCwd = cwd.startsWith(projectDir) ? cwd : projectDir;

  const mergedEnv = {
    ...process.env,
    ...env,
    HOME: process.env.HOME || "/root",
  };

  try {
    const { stdout, stderr } = await execAsync(safeCommand, {
      cwd: safeCwd,
      env: mergedEnv,
      timeout: 120000,
      maxBuffer: 4 * 1024 * 1024,
    });
    return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode: 0, cwd: safeCwd };
  } catch (e: any) {
    const exitCode = e.code || 1;
    return {
      stdout: e.stdout?.trim() || "",
      stderr: e.stderr?.trim() || e.message || "Command failed",
      exitCode: typeof exitCode === "number" ? exitCode : 1,
      cwd: safeCwd,
    };
  }
}
