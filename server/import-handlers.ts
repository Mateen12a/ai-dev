import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import { storage } from "./storage";
import AdmZip from "adm-zip";

const execAsync = promisify(exec);

export async function importFromGitHub(
  repoUrl: string,
  projectId: string
): Promise<{ success: boolean; files: number; error?: string }> {
  const dir = `/tmp/devforge-projects/${projectId}`;

  try {
    await fs.promises.mkdir(dir, { recursive: true });

    const cleanUrl = repoUrl.trim().replace(/\/$/, "");
    const isGitHub = cleanUrl.includes("github.com");
    const cloneUrl = isGitHub && !cleanUrl.endsWith(".git")
      ? cleanUrl + ".git"
      : cleanUrl;

    await execAsync(`git clone --depth=1 "${cloneUrl}" "${dir}" 2>&1`, {
      timeout: 30000,
    });

    const importedFiles = await walkDir(dir, dir);
    let count = 0;

    for (const { relPath, fullPath } of importedFiles.slice(0, 50)) {
      try {
        const stat = await fs.promises.stat(fullPath);
        if (stat.size > 500 * 1024) continue;

        const content = await fs.promises.readFile(fullPath, "utf-8");
        const name = path.basename(relPath);
        const ext = name.split(".").pop()?.toLowerCase() || "";
        const lang = extToLanguage(ext);

        await storage.createFile({
          projectId,
          name,
          path: relPath,
          content,
          type: "file",
          language: lang,
        });
        count++;
      } catch {}
    }

    return { success: true, files: count };
  } catch (err: any) {
    return { success: false, files: 0, error: err.message };
  }
}

export async function importFromZip(
  zipBuffer: Buffer,
  projectId: string
): Promise<{ success: boolean; files: number; error?: string }> {
  try {
    const zip = new AdmZip(zipBuffer);
    const entries = zip.getEntries();
    let count = 0;

    let prefix = "";
    const dirs = entries
      .filter(e => e.isDirectory && e.entryName.split("/").length === 2)
      .map(e => e.entryName);
    if (dirs.length === 1) {
      prefix = dirs[0];
    }

    for (const entry of entries) {
      if (entry.isDirectory) continue;
      const entryPath = prefix ? entry.entryName.replace(prefix, "") : entry.entryName;
      if (!entryPath || entryPath.startsWith(".git/") || entryPath.includes("node_modules/")) continue;

      try {
        const content = entry.getData().toString("utf-8");
        if (!isTextContent(content)) continue;
        if (content.length > 500 * 1024) continue;

        const name = path.basename(entryPath);
        const ext = name.split(".").pop()?.toLowerCase() || "";

        await storage.createFile({
          projectId,
          name,
          path: entryPath,
          content,
          type: "file",
          language: extToLanguage(ext),
        });
        count++;
      } catch {}
    }

    return { success: true, files: count };
  } catch (err: any) {
    return { success: false, files: 0, error: err.message };
  }
}

async function walkDir(base: string, dir: string): Promise<Array<{ relPath: string; fullPath: string }>> {
  const results: Array<{ relPath: string; fullPath: string }> = [];
  const IGNORE = new Set([".git", "node_modules", "__pycache__", ".next", "dist", "build", ".venv", "venv"]);

  try {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (IGNORE.has(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      const relPath = path.relative(base, fullPath);
      if (entry.isDirectory()) {
        const sub = await walkDir(base, fullPath);
        results.push(...sub);
      } else {
        results.push({ relPath, fullPath });
      }
    }
  } catch {}

  return results;
}

function isTextContent(content: string): boolean {
  for (let i = 0; i < Math.min(content.length, 512); i++) {
    const code = content.charCodeAt(i);
    if (code === 0) return false;
  }
  return true;
}

function extToLanguage(ext: string): string {
  const map: Record<string, string> = {
    ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
    py: "python", go: "go", rs: "rust", java: "java", cs: "csharp",
    json: "json", css: "css", scss: "css", html: "html", md: "markdown",
    yml: "yaml", yaml: "yaml", sh: "shell", toml: "toml", env: "plaintext",
    txt: "plaintext", gitignore: "plaintext",
  };
  return map[ext] || "plaintext";
}
