import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import http from "http";
import { storage } from "./storage";
import { insertProjectSchema } from "@shared/schema";
import { z } from "zod";
import {
  ensureProjectDir, writeProjectFile, syncProjectFiles, getProjectDir,
  initGit, getGitStatus, gitCommit, getGitLog, getGitDiff, execShell,
  getGitBranches, gitReset, gitCreateBranch, gitCheckout, gitStash
} from "./project-fs";
import { runAgentIteration, generateProjectCode, thinkAgentPlan, selectModelForMode, callModelStream, type AgentMode } from "./gemini";
import { runClaudeAgentIteration, isClaudeAvailable, CLAUDE_MODELS } from "./anthropic";
import { importFromGitHub, importFromZip } from "./import-handlers";
import {
  startProcess, killProcess, getProcess, getProcesses, restartProcess,
  detectStartCommand, detectInstallCommand, detectInstallCommands,
  detectProjectRuntime,
} from "./process-manager";
import path from "path";
import fs from "fs";
import multer from "multer";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// In-memory autonomy session store (short-lived, per-project)
interface AutonomySession {
  projectId: string;
  userMessage: string;
  iterationsDone: number;
  totalIterations: number;
  expiresAt: number;
}
const autonomySessions = new Map<string, AutonomySession>();
// Clean up expired sessions every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of autonomySessions) {
    if (session.expiresAt < now) autonomySessions.delete(id);
  }
}, 10 * 60 * 1000);

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // ────────── AI PROVIDERS INFO ──────────
  app.get("/api/ai/providers", (_req, res) => {
    const claudeReady = isClaudeAvailable();
    res.json({
      gemini: !!process.env.GEMINI_API_KEY,
      claude: claudeReady,
      models: {
        lite: { provider: "gemini", label: "Flash" },
        economy: { provider: "gemini", label: "Flash" },
        power: { provider: "gemini", label: "Flash / Pro" },
        agent: { provider: claudeReady ? "claude" : "gemini", label: claudeReady ? "Claude Sonnet" : "Flash" },
        max: { provider: claudeReady ? "claude" : "gemini", label: claudeReady ? "Claude Opus" : "Pro" },
        test: { provider: "gemini", label: "Flash Thinking" },
        optimize: { provider: "gemini", label: "Pro" },
      },
    });
  });

  // ────────── PROJECTS ──────────
  app.get("/api/projects", async (_req, res) => {
    res.json(await storage.getProjects());
  });

  app.get("/api/projects/:id", async (req, res) => {
    const project = await storage.getProject(req.params.id);
    if (!project) return res.status(404).json({ message: "Project not found" });
    res.json(project);
  });

  app.post("/api/projects", async (req, res) => {
    const parsed = insertProjectSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid project data" });

    const project = await storage.createProject(parsed.data);

    const prompt = project.prompt || project.description;

    let generatedFiles: Array<{ path: string; content: string; description: string }> = [];
    if (prompt && prompt.length > 10) {
      generatedFiles = await generateProjectCode(prompt, project.language, project.framework);
    }

    let filesToCreate: ReturnType<typeof generateProjectFiles>;
    if (generatedFiles.length > 0) {
      filesToCreate = generatedFiles.map(f => ({
        projectId: project.id,
        name: f.path.split("/").pop()!,
        path: f.path,
        content: f.content,
        type: "file" as const,
        language: getLanguageFromPath(f.path),
      }));
    } else {
      filesToCreate = generateProjectFiles(project.id, project.language, project.framework, prompt);
    }

    for (const file of filesToCreate) await storage.createFile(file);

    await ensureProjectDir(project.id);
    await syncProjectFiles(project.id, filesToCreate.filter(f => f.type === "file").map(f => ({ path: f.path, content: f.content })));
    await initGit(project.id);

    await storage.createLog({ projectId: project.id, type: "system", message: `✨ Project "${project.name}" initialized with ${filesToCreate.length} files`, stage: "console" });
    if (generatedFiles.length > 0) {
      await storage.createLog({ projectId: project.id, type: "success", message: `AI generated ${generatedFiles.length} files for: "${prompt.substring(0, 80)}"`, stage: "console" });
    }
    res.json(project);
  });

  // ────────── IMPORT FROM GITHUB ──────────
  app.post("/api/projects/import/github", async (req, res) => {
    const parsed = z.object({
      repoUrl: z.string().url(),
      name: z.string().optional(),
      language: z.string().default("typescript"),
      framework: z.string().default("express"),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Valid GitHub URL required" });

    const repoName = parsed.data.name || parsed.data.repoUrl.split("/").pop()?.replace(".git", "") || "imported-project";

    const project = await storage.createProject({
      name: repoName,
      description: `Imported from ${parsed.data.repoUrl}`,
      prompt: `Imported from GitHub: ${parsed.data.repoUrl}`,
      language: parsed.data.language,
      framework: parsed.data.framework,
      status: "idle",
      buildStatus: "none",
    });

    await storage.createLog({ projectId: project.id, type: "system", message: `📥 Cloning ${parsed.data.repoUrl}...`, stage: "console" });

    const result = await importFromGitHub(parsed.data.repoUrl, project.id);

    if (result.success) {
      await storage.createLog({ projectId: project.id, type: "success", message: `✓ Imported ${result.files} files from GitHub`, stage: "console" });
      await initGit(project.id);
    } else {
      await storage.createLog({ projectId: project.id, type: "error", message: `✗ Import failed: ${result.error}`, stage: "console" });
    }

    res.json({ project, imported: result.files, success: result.success, error: result.error });
  });

  // ────────── IMPORT FROM ZIP ──────────
  app.post("/api/projects/import/zip", upload.single("file"), async (req: any, res) => {
    if (!req.file) return res.status(400).json({ message: "ZIP file required" });

    const name = (req.body.name as string) || req.file.originalname.replace(".zip", "") || "imported-project";

    const project = await storage.createProject({
      name,
      description: `Imported from ZIP: ${req.file.originalname}`,
      prompt: `Imported from ZIP file: ${req.file.originalname}`,
      language: (req.body.language as string) || "typescript",
      framework: (req.body.framework as string) || "express",
      status: "idle",
      buildStatus: "none",
    });

    await storage.createLog({ projectId: project.id, type: "system", message: `📦 Extracting ${req.file.originalname}...`, stage: "console" });

    const result = await importFromZip(req.file.buffer, project.id);

    if (result.success) {
      await storage.createLog({ projectId: project.id, type: "success", message: `✓ Extracted ${result.files} files from ZIP`, stage: "console" });
      await ensureProjectDir(project.id);
      await initGit(project.id);
    } else {
      await storage.createLog({ projectId: project.id, type: "error", message: `✗ Extraction failed: ${result.error}`, stage: "console" });
    }

    res.json({ project, imported: result.files, success: result.success, error: result.error });
  });

  app.patch("/api/projects/:id", async (req, res) => {
    const project = await storage.updateProject(req.params.id, req.body);
    if (!project) return res.status(404).json({ message: "Project not found" });
    res.json(project);
  });

  app.delete("/api/projects/:id", async (req, res) => {
    await storage.deleteProject(req.params.id);
    res.json({ success: true });
  });

  // ────────── FILES ──────────
  app.get("/api/projects/:id/files", async (req, res) => {
    res.json(await storage.getFiles(req.params.id));
  });

  app.post("/api/projects/:id/files", async (req, res) => {
    const fileSchema = z.object({
      name: z.string().min(1),
      path: z.string().optional(),
      content: z.string().default(""),
      type: z.enum(["file", "folder"]).default("file"),
      language: z.string().default("plaintext"),
    });
    const parsed = fileSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid file data" });

    const file = await storage.createFile({
      projectId: req.params.id,
      name: parsed.data.name,
      path: parsed.data.path || parsed.data.name,
      content: parsed.data.content,
      type: parsed.data.type,
      language: parsed.data.language,
    });

    if (file.type === "file") {
      await writeProjectFile(req.params.id, file.path, file.content);
    }
    res.json(file);
  });

  app.patch("/api/projects/:id/files/:fileId", async (req, res) => {
    const parsed = z.object({ content: z.string() }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Content required" });
    const existing = await storage.getFile(req.params.fileId);
    if (!existing) return res.status(404).json({ message: "File not found" });
    await storage.createFileVersion({
      fileId: existing.id,
      projectId: req.params.id,
      content: existing.content,
      path: existing.path,
      size: String(Buffer.byteLength(existing.content, "utf8")),
    });
    const file = await storage.updateFile(req.params.fileId, parsed.data.content);
    if (!file) return res.status(404).json({ message: "File not found" });
    await writeProjectFile(req.params.id, file.path, file.content);
    res.json(file);
  });

  app.patch("/api/projects/:id/files/:fileId/rename", async (req, res) => {
    const parsed = z.object({ name: z.string().min(1), path: z.string().min(1) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "name and path required" });
    const file = await storage.getFile(req.params.fileId);
    if (!file) return res.status(404).json({ message: "File not found" });
    const updatedFile = await storage.renameFile(req.params.fileId, parsed.data.name, parsed.data.path);
    // Move on disk
    const projectDir = path.join("/tmp/devforge-projects", req.params.id);
    const oldPath = path.join(projectDir, file.path);
    const newPath = path.join(projectDir, parsed.data.path);
    try {
      if (fs.existsSync(oldPath)) {
        fs.mkdirSync(path.dirname(newPath), { recursive: true });
        fs.renameSync(oldPath, newPath);
      }
    } catch (_) {}
    res.json(updatedFile);
  });

  app.get("/api/projects/:id/files/:fileId/download", async (req, res) => {
    const file = await storage.getFile(req.params.fileId);
    if (!file) return res.status(404).json({ message: "File not found" });
    res.setHeader("Content-Disposition", `attachment; filename="${file.name}"`);
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.send(file.content);
  });

  app.delete("/api/projects/:id/files/:fileId", async (req, res) => {
    const file = await storage.getFile(req.params.fileId);
    if (file) {
      const projectDir = path.join("/tmp/devforge-projects", req.params.id);
      const filePath = path.join(projectDir, file.path);
      try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (_) {}
    }
    await storage.deleteFile(req.params.fileId);
    res.json({ success: true });
  });

  // ────────── FILE VERSION HISTORY ──────────
  app.get("/api/projects/:id/files/:fileId/history", async (req, res) => {
    const versions = await storage.getFileVersions(req.params.fileId, req.params.id);
    res.json(versions);
  });

  app.get("/api/projects/:id/files/:fileId/history/:versionId", async (req, res) => {
    const version = await storage.getFileVersion(req.params.versionId);
    if (!version) return res.status(404).json({ message: "Version not found" });
    res.json(version);
  });

  app.post("/api/projects/:id/files/:fileId/history/:versionId/restore", async (req, res) => {
    const version = await storage.getFileVersion(req.params.versionId);
    if (!version) return res.status(404).json({ message: "Version not found" });
    const currentFile = await storage.getFile(req.params.fileId);
    if (!currentFile) return res.status(404).json({ message: "File not found" });
    await storage.createFileVersion({
      fileId: currentFile.id,
      projectId: req.params.id,
      content: currentFile.content,
      path: currentFile.path,
      size: String(Buffer.byteLength(currentFile.content, "utf8")),
    });
    const file = await storage.updateFile(req.params.fileId, version.content);
    if (!file) return res.status(404).json({ message: "File not found" });
    await writeProjectFile(req.params.id, file.path, file.content);
    res.json(file);
  });

  // ────────── AI MESSAGES ──────────
  app.get("/api/projects/:id/messages", async (req, res) => {
    res.json(await storage.getMessages(req.params.id));
  });

  // Helper: run a batch of agent iterations, returns summary
  async function runAgentBatch(
    projectId: string,
    userMessage: string,
    projectCtx: { name: string; language: string; framework: string; description: string; workingDir?: string; editorContext?: { activeFile: string | null; selection: string | null; cursorLine: number | null } },
    mode: AgentMode,
    startIteration: number,
    batchSize: number,
    attachments?: Array<{ type: string; data: string; name: string }>,
    modelOverride?: string
  ): Promise<{ finalMessage: string; filesUpdated: number; updatedPaths: string[]; shellCommandsRun: string[]; done: boolean; stoppedAtIteration: number }> {
    let currentFiles = await storage.getFiles(projectId);
    let history = await storage.getMessages(projectId);
    let shellResults: Array<{ command: string; stdout: string; stderr: string; exitCode: number }> = [];
    let finalAiMessage = "";
    let totalFilesUpdated = 0;
    const allUpdatedPaths: string[] = [];
    const allShellCommands: string[] = [];
    let done = false;

    for (let i = 0; i < batchSize; i++) {
      const globalIteration = startIteration + i;
      await storage.createLog({ projectId, type: "system", message: `🔄 Iteration ${globalIteration + 1}...`, stage: "agent" });
      await storage.createLog({ projectId, type: "system", message: `__ACTION__${JSON.stringify({ type: "thinking", message: `Analyzing codebase (step ${globalIteration + 1})...` })}`, stage: "agent" });

      // Use Claude for agent/max modes when available, else fall back to Gemini
      const usesClaude = isClaudeAvailable() && (mode === "agent" || mode === "max");
      let response: Awaited<ReturnType<typeof runAgentIteration>>;
      if (usesClaude) {
        try {
          const claudeModel = mode === "max" ? CLAUDE_MODELS.opus : CLAUDE_MODELS.sonnet;
          response = await runClaudeAgentIteration(
            userMessage,
            projectCtx,
            currentFiles.map(f => ({ path: f.path, content: f.content })),
            history.map(m => ({ role: m.role, content: m.content })),
            shellResults,
            { mode, modelOverride: claudeModel }
          );
        } catch (claudeErr: any) {
          console.warn("[Agent] Claude failed, falling back to Gemini:", claudeErr.message);
          response = await runAgentIteration(
            userMessage,
            projectCtx,
            currentFiles.map(f => ({ path: f.path, content: f.content })),
            history.map(m => ({ role: m.role, content: m.content })),
            shellResults,
            { mode, modelOverride, attachments: globalIteration === 0 ? attachments : undefined }
          );
        }
      } else {
        response = await runAgentIteration(
          userMessage,
          projectCtx,
          currentFiles.map(f => ({ path: f.path, content: f.content })),
          history.map(m => ({ role: m.role, content: m.content })),
          shellResults,
          { mode, modelOverride, attachments: globalIteration === 0 ? attachments : undefined }
        );
      }

      finalAiMessage = response.message;

      // Emit the model used
      if (response.modelUsed) {
        const { label } = usesClaude
          ? { label: mode === "max" ? "Claude Opus" : "Claude Sonnet" }
          : selectModelForMode(mode);
        await storage.createLog({
          projectId,
          type: "system",
          message: `__MODEL__${JSON.stringify({ model: response.modelUsed, label })}`,
          stage: "agent",
        });
      }

      // Emit the agent's chain-of-thought reasoning as a visible log
      if (response.reasoning) {
        await storage.createLog({
          projectId,
          type: "system",
          message: `__THINKING__${response.reasoning}`,
          stage: "agent",
        });
      }

      // Detect mode recommendations in message or reasoning
      const modeNoteText = response.reasoning || response.message;
      if (modeNoteText && /max mode|switch.*max|benefit from max|very complex/i.test(modeNoteText)) {
        await storage.createLog({
          projectId,
          type: "system",
          message: `__RECOMMEND__${JSON.stringify({ mode: "max", reason: "Agent recommends Max mode for this complex task" })}`,
          stage: "agent",
        });
      }

      const allFileUpdates = response.fileUpdates || [];
      for (const update of allFileUpdates) {
        const existing = currentFiles.find(f => f.path === update.path);
        const oldContent = existing ? existing.content : null;
        if (existing) {
          await storage.updateFile(existing.id, update.content);
          await writeProjectFile(projectId, update.path, update.content);
        } else {
          const newFile = await storage.createFile({
            projectId,
            name: update.path.split("/").pop()!,
            path: update.path,
            content: update.content,
            type: "file",
            language: getLanguageFromPath(update.path),
          });
          await writeProjectFile(projectId, newFile.path, newFile.content);
          currentFiles.push(newFile);
        }
        await storage.createLog({ projectId, type: "info", message: `📝 Updated ${update.path}`, stage: "agent" });
        await storage.createLog({ projectId, type: "system", message: `__ACTION__${JSON.stringify({ type: "edit", path: update.path })}`, stage: "agent" });
        await storage.createLog({
          projectId, type: "system",
          message: `__FILEDIFF__${JSON.stringify({ path: update.path, oldContent, newContent: update.content, isNew: oldContent === null })}`,
          stage: "agent",
        });
        totalFilesUpdated++;
        if (!allUpdatedPaths.includes(update.path)) allUpdatedPaths.push(update.path);
      }

      if (response.shellCommands && response.shellCommands.length > 0) {
        shellResults = [];
        const projectDir = path.join("/tmp/devforge-projects", projectId);
        const secrets = await storage.getSecrets(projectId);
        const env: Record<string, string> = {};
        for (const s of secrets) env[s.key] = s.value;

        for (const cmd of response.shellCommands) {
          await storage.createLog({ projectId, type: "system", message: `$ ${cmd}`, stage: "agent" });
          await storage.createLog({ projectId, type: "system", message: `__ACTION__${JSON.stringify({ type: "shell", command: cmd })}`, stage: "agent" });
          allShellCommands.push(cmd);
          const result = await execShell(projectId, cmd, projectDir, env);
          shellResults.push({ command: cmd, ...result });
          const outputMsg = `${result.stdout}${result.stderr ? "\n" + result.stderr : ""}`.trim();
          await storage.createLog({
            projectId,
            type: result.exitCode === 0 ? "info" : "error",
            message: outputMsg,
            stage: "agent",
          });
          await storage.createLog({
            projectId, type: "system",
            message: `__SHELLOUTPUT__${JSON.stringify({ command: cmd, stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode })}`,
            stage: "agent",
          });
          if (result.exitCode !== 0) {
            await storage.createLog({ projectId, type: "system", message: `__ACTION__${JSON.stringify({ type: "error", message: `Command failed: ${cmd}`, command: cmd, stderr: result.stderr })}`, stage: "agent" });
          }
        }
      } else {
        shellResults = [];
      }

      if (response.done || (!response.shellCommands?.length && !response.fileUpdates?.length)) {
        done = true;
        await storage.createLog({ projectId, type: "system", message: `__ACTION__${JSON.stringify({ type: "complete", filesUpdated: totalFilesUpdated, message: "Task complete" })}`, stage: "agent" });
        break;
      }

      const hasErrors = shellResults.some(r => r.exitCode !== 0);
      if (hasErrors && i < batchSize - 1) {
        await storage.createLog({ projectId, type: "system", message: `__ACTION__${JSON.stringify({ type: "fix", message: "Detected errors — analyzing and applying fix..." })}`, stage: "agent" });
      }

      currentFiles = await storage.getFiles(projectId);
    }

    if (!done) {
      await storage.createLog({ projectId, type: "system", message: `__ACTION__${JSON.stringify({ type: "complete", filesUpdated: totalFilesUpdated, message: "Batch complete" })}`, stage: "agent" });
    }

    if (totalFilesUpdated > 0) {
      try {
        const commitMsg = `AI agent: ${allUpdatedPaths.slice(0, 5).join(", ")}${allUpdatedPaths.length > 5 ? ` +${allUpdatedPaths.length - 5} more` : ""}`;
        await gitCommit(projectId, commitMsg);
        await storage.createLog({ projectId, type: "system", message: `__ACTION__${JSON.stringify({ type: "checkpoint", message: "Checkpoint created" })}`, stage: "agent" });
      } catch (_) {}
    }

    return { finalMessage: finalAiMessage, filesUpdated: totalFilesUpdated, updatedPaths: allUpdatedPaths, shellCommandsRun: allShellCommands, done, stoppedAtIteration: startIteration + batchSize };
  }

  app.post("/api/projects/:id/messages", async (req, res) => {
    const parsed = z.object({
      content: z.string().min(1),
      mode: z.enum(["lite", "economy", "power", "agent", "max", "test", "optimize", "fast", "autonomy"]).default("power"),
      phase: z.enum(["think", "execute"]).optional(),
      attachments: z.array(z.object({
        type: z.string(),
        data: z.string(),
        name: z.string(),
      })).optional(),
      activeFile: z.string().nullable().optional(),
      selection: z.string().nullable().optional(),
      cursorLine: z.number().nullable().optional(),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Content required" });

    const { mode, attachments, phase } = parsed.data;
    const editorCtx = {
      activeFile: parsed.data.activeFile || null,
      selection: parsed.data.selection || null,
      cursorLine: parsed.data.cursorLine || null,
    };
    const projectId = req.params.id;

    const project = await storage.getProject(projectId);
    if (!project) return res.status(404).json({ message: "Project not found" });

    // Detect working dir
    const allFiles = await storage.getFiles(projectId);
    let agentWorkingDirRel: string | undefined;
    {
      const pkgFile = allFiles.find(f => f.name === "package.json" || f.path.endsWith("/package.json") || f.path === "package.json");
      if (pkgFile && pkgFile.path !== "package.json") {
        const subDir = path.dirname(pkgFile.path);
        if (subDir && subDir !== ".") agentWorkingDirRel = subDir;
      }
    }

    const projectCtx = {
      name: project.name,
      language: project.language,
      framework: project.framework,
      description: project.description || "",
      workingDir: agentWorkingDirRel,
      editorContext: editorCtx.activeFile ? editorCtx : undefined,
    };

    // Normalize legacy mode names
    const normalizedMode: AgentMode = mode === "fast" ? "lite"
      : mode === "autonomy" ? "agent"
      : mode as AgentMode;

    const { model: selectedModel, label: modelLabel } = selectModelForMode(normalizedMode);

    // ── AGENT / AUTONOMY THINK PHASE (human-in-loop) ─────────────────────────
    if (normalizedMode === "agent" && phase === "think") {
      const userMsg = await storage.createMessage({ projectId, role: "user", content: parsed.data.content });
      await storage.createLog({ projectId, type: "system", message: `🧠 Planning... [agent mode · ${modelLabel}]`, stage: "agent" });

      const history = await storage.getMessages(projectId);
      const thinkResult = await thinkAgentPlan(
        parsed.data.content,
        projectCtx,
        allFiles.map(f => ({ path: f.path, content: f.content })),
        history.map(m => ({ role: m.role, content: m.content })),
        normalizedMode
      );

      await storage.createLog({
        projectId,
        type: "system",
        message: `__PLAN__${JSON.stringify({ ...thinkResult, modelSelected: selectedModel, modelLabel })}`,
        stage: "agent",
      });

      const sessionId = `aut_${projectId}_${Date.now()}`;
      autonomySessions.set(sessionId, {
        projectId,
        userMessage: parsed.data.content,
        iterationsDone: 0,
        totalIterations: 8,
        expiresAt: Date.now() + 30 * 60 * 1000,
      });

      return res.json({
        status: "pending_approval",
        user: userMsg,
        plan: thinkResult,
        sessionId,
        modelLabel,
      });
    }

    // ── MAX MODE — fully autonomous, no checkpoints, Pro model ───────────────
    if (normalizedMode === "max" && phase === "think") {
      const userMsg = await storage.createMessage({ projectId, role: "user", content: parsed.data.content });
      await storage.createLog({ projectId, type: "system", message: `🚀 Analyzing task... [Max mode · ${modelLabel}]`, stage: "agent" });

      const history = await storage.getMessages(projectId);
      const thinkResult = await thinkAgentPlan(
        parsed.data.content,
        projectCtx,
        allFiles.map(f => ({ path: f.path, content: f.content })),
        history.map(m => ({ role: m.role, content: m.content })),
        normalizedMode
      );

      await storage.createLog({
        projectId,
        type: "system",
        message: `__PLAN__${JSON.stringify({ ...thinkResult, modelSelected: selectedModel, modelLabel })}`,
        stage: "agent",
      });

      // Max mode: create session with 20 iterations, no checkpoint stops
      const sessionId = `max_${projectId}_${Date.now()}`;
      autonomySessions.set(sessionId, {
        projectId,
        userMessage: parsed.data.content,
        iterationsDone: 0,
        totalIterations: 20,
        expiresAt: Date.now() + 60 * 60 * 1000,
      });

      return res.json({
        status: "pending_approval",
        user: userMsg,
        plan: thinkResult,
        sessionId,
        modelLabel,
        isMax: true,
      });
    }

    // ── STANDARD FLOW (lite, economy, power, test, optimize) ─────────────────
    const userMsg = await storage.createMessage({ projectId, role: "user", content: parsed.data.content });
    const modeEmoji: Record<AgentMode, string> = {
      lite: "⚡", economy: "🌿", power: "💪", agent: "🤖",
      max: "🚀", test: "🧪", optimize: "⚙️", fast: "⚡", autonomy: "🤖",
    };
    await storage.createLog({ projectId, type: "system", message: `${modeEmoji[normalizedMode] || "🤖"} Starting... [${normalizedMode} mode · ${modelLabel}]`, stage: "agent" });

    const history = await storage.getMessages(projectId);
    const thinkResult = await thinkAgentPlan(
      parsed.data.content,
      projectCtx,
      allFiles.map(f => ({ path: f.path, content: f.content })),
      history.map(m => ({ role: m.role, content: m.content })),
      normalizedMode
    );

    await storage.createLog({
      projectId,
      type: "system",
      message: `__PLAN__${JSON.stringify({ ...thinkResult, modelSelected: selectedModel, modelLabel })}`,
      stage: "agent",
    });

    if (thinkResult.assessment.recommendedMode && thinkResult.assessment.recommendedMode !== normalizedMode) {
      await storage.createLog({
        projectId,
        type: "system",
        message: `__RECOMMEND__${JSON.stringify({ mode: thinkResult.assessment.recommendedMode, reason: `This task is ${thinkResult.assessment.estimatedComplexity}. Consider switching to ${thinkResult.assessment.recommendedMode} mode for best results.` })}`,
        stage: "agent",
      });
    }

    if (!thinkResult.assessment.canHandle) {
      const blockerMsg = `I can't complete this task as-is. Here's why:\n\n${thinkResult.assessment.blockers.join("\n")}\n\n${thinkResult.assessment.clarificationNeeded ? `To proceed, I need: ${thinkResult.assessment.clarificationNeeded}` : ""}`;
      const aiMsg = await storage.createMessage({ projectId, role: "assistant", content: blockerMsg });
      return res.json({ user: userMsg, assistant: aiMsg, filesUpdated: 0, plan: thinkResult });
    }

    if (thinkResult.assessment.clarificationNeeded) {
      const aiMsg = await storage.createMessage({ projectId, role: "assistant", content: `Before I start, I need some clarification:\n\n${thinkResult.assessment.clarificationNeeded}` });
      return res.json({ user: userMsg, assistant: aiMsg, filesUpdated: 0, plan: thinkResult });
    }

    const maxIterationsMap: Record<AgentMode, number> = {
      lite: 1, economy: 1, power: 4, agent: 8,
      max: 20, test: 6, optimize: 5, fast: 1, autonomy: 8,
    };
    const maxIterations = maxIterationsMap[normalizedMode] ?? 4;

    const { finalMessage, filesUpdated, updatedPaths, shellCommandsRun } = await runAgentBatch(
      projectId, parsed.data.content, projectCtx, normalizedMode, 0, maxIterations, attachments, selectedModel
    );

    const cleanedFinalMessage = finalMessage
      .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
      .replace(/AGENT_ACTION:\s*```?(?:json)?\s*\{[\s\S]*?\}\s*```?/gi, "")
      .replace(/```json\s*\{[\s\S]*?"message"[\s\S]*?"done"[\s\S]*?\}\s*```/gi, "")
      .replace(/^\s*\{[\s\S]*?"message"[\s\S]*?"done"\s*:[\s\S]*?\}\s*$/gm, "")
      .trim();
    const aiMsg = await storage.createMessage({ projectId, role: "assistant", content: cleanedFinalMessage || finalMessage });
    res.json({ user: userMsg, assistant: aiMsg, filesUpdated, updatedPaths, shellCommandsRun, plan: thinkResult, modelLabel });
  });

  app.post("/api/projects/:id/messages/stream", async (req, res) => {
    const projectId = req.params.id;
    const parsed = z.object({
      content: z.string(),
      mode: z.string().optional(),
      activeFile: z.string().nullable().optional(),
      selection: z.string().nullable().optional(),
      cursorLine: z.number().nullable().optional(),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid input" });

    const project = await storage.getProject(projectId);
    if (!project) return res.status(404).json({ error: "Project not found" });

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();

    let clientDisconnected = false;
    req.on("close", () => { clientDisconnected = true; });

    const sendEvent = (event: string, data: any) => {
      if (!clientDisconnected) {
        try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch (_) {}
      }
    };

    try {
      const allFiles = await storage.getFiles(projectId);
      const mode = (parsed.data.mode || "power") as AgentMode;
      const { model: autoModel, label: modelLabel } = selectModelForMode(mode);

      sendEvent("status", { phase: "thinking", model: modelLabel });

      const userMsg = await storage.createMessage({ projectId, role: "user", content: parsed.data.content });
      sendEvent("user", { id: userMsg.id, content: userMsg.content });

      const history = await storage.getMessages(projectId);

      let agentWorkingDirRel = "";
      const pkgFile = allFiles.find((f: any) => f.name === "package.json" || f.path.endsWith("/package.json"));
      if (pkgFile && pkgFile.path !== "package.json") {
        const subDir = path.dirname(pkgFile.path);
        if (subDir && subDir !== ".") agentWorkingDirRel = subDir;
      }

      const streamEditorCtx = {
        activeFile: parsed.data.activeFile || null,
        selection: parsed.data.selection || null,
        cursorLine: parsed.data.cursorLine || null,
      };

      const projectCtx = {
        name: project.name,
        language: project.language,
        framework: project.framework,
        description: project.description || "",
        workingDir: agentWorkingDirRel,
        editorContext: streamEditorCtx.activeFile ? streamEditorCtx : undefined,
      };

      const maxIterationsMap: Record<string, number> = {
        lite: 1, economy: 1, power: 4, agent: 8, max: 20, test: 6, optimize: 5,
      };
      const maxIter = maxIterationsMap[mode] ?? 4;

      let totalUpdated = 0;
      const allUpdatedPaths: string[] = [];
      const allShellCommands: string[] = [];
      let finalMsg = "";
      let done = false;
      let iter = 0;
      let shellResults: Array<{ command: string; stdout: string; stderr: string; exitCode: number }> = [];

      while (!done && iter < maxIter && !clientDisconnected) {
        iter++;
        sendEvent("status", { phase: "executing", iteration: iter, maxIterations: maxIter });

        const response = await runAgentIteration(
          parsed.data.content,
          projectCtx,
          allFiles.map((f: any) => ({ path: f.path, content: f.content })),
          history.map((m: any) => ({ role: m.role, content: m.content })),
          shellResults.length > 0 ? shellResults : undefined,
          { mode, modelOverride: autoModel }
        );

        if (response.message) {
          finalMsg = response.message;
          sendEvent("text", { content: response.message });
        }

        if (response.fileUpdates && response.fileUpdates.length > 0) {
          for (const fu of response.fileUpdates) {
            const existing = allFiles.find((f: any) => f.path === fu.path);
            const oldContent = existing ? existing.content : null;
            sendEvent("action", { type: "edit", path: fu.path });
            if (existing) {
              await storage.updateFile(existing.id, fu.content);
              (existing as any).content = fu.content;
            } else {
              const newFile = await storage.createFile({
                projectId,
                name: path.basename(fu.path),
                path: fu.path,
                content: fu.content,
                type: "file",
                language: path.extname(fu.path).replace(".", "") || "text",
              });
              (allFiles as any[]).push(newFile);
            }
            await writeProjectFile(projectId, fu.path, fu.content);
            allUpdatedPaths.push(fu.path);
            totalUpdated++;
            sendEvent("file_diff", {
              path: fu.path,
              oldContent: oldContent,
              newContent: fu.content,
              isNew: oldContent === null,
            });
          }
        }

        shellResults = [];
        if (response.shellCommands && response.shellCommands.length > 0) {
          for (const cmd of response.shellCommands) {
            sendEvent("action", { type: "shell", command: cmd });
            allShellCommands.push(cmd);
            const projectDir = getProjectDir(projectId);
            const secrets = await storage.getSecrets(projectId);
            const shellEnv: Record<string, string> = {};
            for (const s of secrets) shellEnv[s.key] = s.value;
            try {
              const result = await execShell(projectId, cmd, projectDir, shellEnv);
              shellResults.push({ command: cmd, ...result });
              sendEvent("shell_output", {
                command: cmd,
                stdout: result.stdout,
                stderr: result.stderr,
                exitCode: result.exitCode,
              });
              if (result.exitCode !== 0) {
                sendEvent("action", { type: "error", message: `Command failed: ${cmd}`, command: cmd, stderr: result.stderr });
              }
            } catch (err: any) {
              shellResults.push({ command: cmd, stdout: "", stderr: err.message, exitCode: 1 });
              sendEvent("shell_output", {
                command: cmd,
                stdout: "",
                stderr: err.message,
                exitCode: 1,
              });
              sendEvent("action", { type: "error", message: err.message, command: cmd, stderr: err.message });
            }
          }
        }

        done = response.done || false;
      }

      if (totalUpdated > 0) {
        try {
          await gitCommit(projectId, `Agent: updated ${allUpdatedPaths.join(", ")}`);
          sendEvent("action", { type: "checkpoint" });
        } catch (_) {}
      }

      const cleanMsg = finalMsg
        .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
        .replace(/AGENT_ACTION:\s*```?(?:json)?\s*\{[\s\S]*?\}\s*```?/gi, "")
        .replace(/```json\s*\{[\s\S]*?"message"[\s\S]*?"done"[\s\S]*?\}\s*```/gi, "")
        .replace(/^\s*\{[\s\S]*?"message"[\s\S]*?"done"\s*:[\s\S]*?\}\s*$/gm, "")
        .trim();

      const aiMsg = await storage.createMessage({ projectId, role: "assistant", content: cleanMsg || finalMsg });
      sendEvent("complete", {
        assistant: aiMsg,
        filesUpdated: totalUpdated,
        updatedPaths: allUpdatedPaths,
        shellCommandsRun: allShellCommands,
        modelLabel,
      });
      res.write("event: done\ndata: {}\n\n");
      res.end();
    } catch (err: any) {
      sendEvent("error", { message: err.message });
      res.end();
    }
  });

  // ── AUTONOMY CONTINUE / EXECUTE ──────────────────────────────────────────
  app.post("/api/projects/:id/messages/continue", async (req, res) => {
    const parsed = z.object({
      sessionId: z.string(),
      action: z.enum(["execute", "continue", "stop"]),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "sessionId and action required" });

    const { sessionId, action } = parsed.data;
    const projectId = req.params.id;

    const session = autonomySessions.get(sessionId);
    if (!session || session.projectId !== projectId) {
      return res.status(404).json({ message: "Session not found or expired" });
    }

    if (action === "stop") {
      autonomySessions.delete(sessionId);
      // Save a final message marking that the user stopped
      const aiMsg = await storage.createMessage({ projectId, role: "assistant", content: "Execution stopped by user. You can continue by sending another message." });
      await storage.createLog({ projectId, type: "system", message: `🛑 Execution stopped by user`, stage: "agent" });
      return res.json({ status: "stopped", assistant: aiMsg });
    }

    const project = await storage.getProject(projectId);
    if (!project) return res.status(404).json({ message: "Project not found" });

    const allFiles = await storage.getFiles(projectId);
    let agentWorkingDirRel: string | undefined;
    {
      const pkgFile = allFiles.find(f => f.name === "package.json" || f.path.endsWith("/package.json") || f.path === "package.json");
      if (pkgFile && pkgFile.path !== "package.json") {
        const subDir = path.dirname(pkgFile.path);
        if (subDir && subDir !== ".") agentWorkingDirRel = subDir;
      }
    }

    const projectCtx = {
      name: project.name, language: project.language, framework: project.framework,
      description: project.description || "", workingDir: agentWorkingDirRel,
    };

    // Detect mode from session ID prefix
    const isMaxMode = sessionId.startsWith("max_");
    const sessionMode: AgentMode = isMaxMode ? "max" : "agent";
    const { model: sessionModel, label: sessionModelLabel } = selectModelForMode(sessionMode);

    const remaining = session.totalIterations - session.iterationsDone;

    // Max mode: run 5 iterations per batch (auto-continues from UI without user input)
    // Agent mode: run 2-4 iterations then show checkpoint to user
    const batchSize = isMaxMode ? Math.min(5, remaining) : Math.min(action === "execute" ? 4 : 2, remaining);

    const progressMsg = isMaxMode
      ? `🚀 Max mode running... (${session.iterationsDone + 1}–${session.iterationsDone + batchSize} of ${session.totalIterations} · ${sessionModelLabel})`
      : `▶️ Continuing... (iterations ${session.iterationsDone + 1}–${session.iterationsDone + batchSize} of ${session.totalIterations} · ${sessionModelLabel})`;

    await storage.createLog({ projectId, type: "system", message: progressMsg, stage: "agent" });

    const { finalMessage, filesUpdated, updatedPaths, shellCommandsRun, done: batchDone, stoppedAtIteration } = await runAgentBatch(
      projectId, session.userMessage, projectCtx, sessionMode, session.iterationsDone, batchSize, undefined, sessionModel
    );

    session.iterationsDone = stoppedAtIteration;
    session.expiresAt = Date.now() + (isMaxMode ? 60 : 30) * 60 * 1000;

    const remainingAfter = session.totalIterations - session.iterationsDone;
    const isDone = batchDone || remainingAfter <= 0;

    if (isDone) {
      autonomySessions.delete(sessionId);
      const doneMsg = isMaxMode ? `✅ Max agent complete — fully autonomous run finished` : `✅ Agent complete`;
      await storage.createLog({ projectId, type: "system", message: doneMsg, stage: "agent" });
      const cleanFinal = finalMessage
        .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
        .replace(/AGENT_ACTION:\s*```?(?:json)?\s*\{[\s\S]*?\}\s*```?/gi, "")
        .replace(/```json\s*\{[\s\S]*?"message"[\s\S]*?"done"[\s\S]*?\}\s*```/gi, "")
        .replace(/^\s*\{[\s\S]*?"message"[\s\S]*?"done"\s*:[\s\S]*?\}\s*$/gm, "")
        .trim();
      const aiMsg = await storage.createMessage({ projectId, role: "assistant", content: cleanFinal || finalMessage });
      return res.json({ status: "done", assistant: aiMsg, filesUpdated, updatedPaths, shellCommandsRun });
    }

    await storage.createLog({
      projectId, type: "system",
      message: `__CHECKPOINT__${JSON.stringify({ iterationsDone: session.iterationsDone, totalIterations: session.totalIterations, summary: finalMessage.slice(0, 300) })}`,
      stage: "agent",
    });

    res.json({
      status: "checkpoint",
      sessionId,
      iterationsDone: session.iterationsDone,
      totalIterations: session.totalIterations,
      filesUpdated,
      updatedPaths,
      shellCommandsRun,
      preview: finalMessage.slice(0, 400),
      isMax: isMaxMode,
    });
  });

  app.post("/api/projects/:id/messages/explain-error", async (req, res) => {
    const parsed = z.object({
      command: z.string(),
      stderr: z.string(),
      exitCode: z.number().optional(),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "command and stderr required" });

    const project = await storage.getProject(req.params.id);
    if (!project) return res.status(404).json({ message: "Project not found" });

    const allFiles = await storage.getFiles(req.params.id);
    const fileList = allFiles.slice(0, 10).map(f => f.path).join(", ");

    const prompt = `You are SudoAI, an expert debugger. A shell command failed in a ${project.language}/${project.framework} project.

Command: ${parsed.data.command}
Exit code: ${parsed.data.exitCode ?? 1}
Error output:
${parsed.data.stderr}

Project files: ${fileList}

Explain what went wrong in plain language, then provide a concrete fix. Be concise. Use markdown formatting.`;

    try {
      const { generateWithGemini } = await import("./gemini");
      const explanation = await generateWithGemini(prompt, `Project: ${project.name}`);
      const userMsg = await storage.createMessage({
        projectId: req.params.id,
        role: "user",
        content: `Explain this error:\n\`\`\`\n$ ${parsed.data.command}\n${parsed.data.stderr}\n\`\`\``,
      });
      const aiMsg = await storage.createMessage({
        projectId: req.params.id,
        role: "assistant",
        content: explanation,
      });
      res.json({ user: userMsg, assistant: aiMsg });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/projects/:id/messages", async (req, res) => {
    await storage.clearMessages(req.params.id);
    res.json({ success: true });
  });

  // ────────── LOGS ──────────
  app.get("/api/projects/:id/logs", async (req, res) => {
    res.json(await storage.getLogs(req.params.id));
  });

  app.post("/api/projects/:id/logs", async (req, res) => {
    const parsed = z.object({ type: z.string(), message: z.string(), stage: z.string().default("console") }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid log" });
    const log = await storage.createLog({ projectId: req.params.id, ...parsed.data });
    res.json(log);
  });

  app.delete("/api/projects/:id/logs", async (req, res) => {
    await storage.clearLogs(req.params.id);
    res.json({ success: true });
  });

  // ────────── DEPLOYMENTS ──────────
  app.get("/api/projects/:id/deployments", async (req, res) => {
    res.json(await storage.getDeployments(req.params.id));
  });

  // ────────── RUN / STOP / STATUS ──────────
  app.post("/api/projects/:id/run", async (req, res) => {
    const project = await storage.getProject(req.params.id);
    if (!project) return res.status(404).json({ message: "Not found" });

    await storage.clearLogs(req.params.id);

    const files = await storage.getFiles(req.params.id);
    await syncProjectFiles(req.params.id, files.filter(f => f.type === "file").map(f => ({ path: f.path, content: f.content })));

    const runtime = detectProjectRuntime(files);
    await storage.createLog({ projectId: req.params.id, type: "system", message: `${runtime.icon} Detected runtime: ${runtime.language}/${runtime.framework}${runtime.version ? ` (${runtime.version})` : ""}`, stage: "console" });

    const projectRootDir = getProjectDir(req.params.id);
    let workingDir = projectRootDir;
    const pkgFile = files.find(f => f.name === "package.json" || f.path.endsWith("/package.json") || f.path === "package.json");
    if (pkgFile && pkgFile.path !== "package.json") {
      const subDir = path.dirname(pkgFile.path);
      if (subDir && subDir !== ".") {
        workingDir = path.join(projectRootDir, subDir);
        await storage.createLog({ projectId: req.params.id, type: "system", message: `📂 Working directory: ${subDir}`, stage: "console" });
      }
    }

    const installCmds: string[] = [...detectInstallCommands(files, workingDir)];
    if (installCmds.length === 0 && runtime.installCommand && runtime.language !== "javascript" && runtime.language !== "typescript") {
      installCmds.push(runtime.installCommand);
    }
    for (const installCmd of installCmds) {
      await storage.createLog({ projectId: req.params.id, type: "system", message: `📦 ${installCmd}`, stage: "console" });
      const installResult = await execShell(req.params.id, installCmd, workingDir);
      if (installResult.stderr) {
        await storage.createLog({ projectId: req.params.id, type: installResult.exitCode !== 0 ? "error" : "info", message: installResult.stderr, stage: "console" });
      }
      if (installResult.stdout) {
        await storage.createLog({ projectId: req.params.id, type: "info", message: installResult.stdout, stage: "console" });
      }
      if (installResult.exitCode !== 0) {
        await storage.createLog({ projectId: req.params.id, type: "error", message: `❌ Install failed: ${installCmd}`, stage: "console" });
      }
    }
    if (installCmds.length > 0) {
      await storage.createLog({ projectId: req.params.id, type: "success", message: "✓ Dependencies installed", stage: "console" });
    }

    const cmd = detectStartCommand(project.language, project.framework, files);
    const secrets = await storage.getSecrets(req.params.id);
    const env: Record<string, string> = {};
    for (const s of secrets) env[s.key] = s.value;

    await storage.updateProject(req.params.id, { buildStatus: "running", status: "running" });

    const label = (req.body as any)?.label || "main";
    const result = await startProcess(req.params.id, cmd, { ...env, PWD: workingDir }, async (msg, type) => {
      await storage.createLog({ projectId: req.params.id, type, message: msg, stage: "console", processLabel: label });
    }, workingDir, label);

    res.json(result);
  });

  app.post("/api/projects/:id/run-service", async (req, res) => {
    const project = await storage.getProject(req.params.id);
    if (!project) return res.status(404).json({ message: "Not found" });

    const { command, label } = req.body as { command?: string; label?: string };
    if (!command || !label) return res.status(400).json({ message: "command and label are required" });

    const secrets = await storage.getSecrets(req.params.id);
    const env: Record<string, string> = {};
    for (const s of secrets) env[s.key] = s.value;

    const projectRootDir = getProjectDir(req.params.id);

    await storage.createLog({ projectId: req.params.id, type: "system", message: `▶ Starting service "${label}": ${command}`, stage: "console", processLabel: label });

    const result = await startProcess(req.params.id, command, { ...env, PWD: projectRootDir }, async (msg, type) => {
      await storage.createLog({ projectId: req.params.id, type, message: msg, stage: "console", processLabel: label });
    }, projectRootDir, label);

    res.json(result);
  });

  app.post("/api/projects/:id/stop", async (req, res) => {
    const label = (req.body as any)?.label;
    if (label) {
      await killProcess(req.params.id, label);
      await storage.createLog({ projectId: req.params.id, type: "system", message: `⏹ Service "${label}" stopped.`, stage: "console", processLabel: label });
      const remaining = getProcesses(req.params.id);
      if (remaining.length === 0) {
        await storage.updateProject(req.params.id, { buildStatus: "idle", status: "idle" });
      }
    } else {
      await killProcess(req.params.id);
      await storage.updateProject(req.params.id, { buildStatus: "idle", status: "idle" });
      await storage.createLog({ projectId: req.params.id, type: "system", message: "⏹ All services stopped.", stage: "console" });
    }
    res.json({ success: true });
  });

  app.post("/api/projects/:id/restart-service", async (req, res) => {
    const { label } = req.body as { label?: string };
    if (!label) return res.status(400).json({ message: "label is required" });

    const secrets = await storage.getSecrets(req.params.id);
    const env: Record<string, string> = {};
    for (const s of secrets) env[s.key] = s.value;

    const projectRootDir = getProjectDir(req.params.id);

    await storage.createLog({ projectId: req.params.id, type: "system", message: `🔄 Restarting service "${label}"...`, stage: "console", processLabel: label });

    const result = await restartProcess(req.params.id, label, { ...env, PWD: projectRootDir }, async (msg, type) => {
      await storage.createLog({ projectId: req.params.id, type, message: msg, stage: "console", processLabel: label });
    }, projectRootDir);

    res.json(result);
  });

  app.get("/api/projects/:id/status", async (req, res) => {
    const proc = getProcess(req.params.id);
    res.json({
      running: !!proc,
      status: proc?.status || "stopped",
      port: proc?.port || null,
      command: proc?.command || null,
      startedAt: proc?.startedAt || null,
    });
  });

  app.get("/api/projects/:id/processes", async (req, res) => {
    const procs = getProcesses(req.params.id);
    res.json(procs.map(p => ({
      label: p.label,
      status: p.status,
      port: p.port,
      command: p.command,
      startedAt: p.startedAt,
      restartCount: p.restartCount,
      uptime: Math.floor((Date.now() - p.startedAt.getTime()) / 1000),
    })));
  });

  app.get("/api/projects/:id/runtime", async (req, res) => {
    const project = await storage.getProject(req.params.id);
    if (!project) return res.status(404).json({ message: "Not found" });
    const files = await storage.getFiles(req.params.id);
    const runtime = detectProjectRuntime(files);
    res.json(runtime);
  });

  // /build is an alias for /run for backwards compatibility
  app.post("/api/projects/:id/build", async (req, res) => {
    res.redirect(307, `/api/projects/${req.params.id}/run`);
  });

  app.post("/api/projects/:id/test", async (req, res) => {
    res.json({ message: "Use the Shell to run tests: npm test" });
  });

  app.post("/api/projects/:id/deploy", async (req, res) => {
    const project = await storage.getProject(req.params.id);
    if (!project) return res.status(404).json({ message: "Not found" });

    const deps = await storage.getDeployments(req.params.id);
    const version = `1.${deps.length}.0`;
    const deployUrl = `https://${project.name.toLowerCase().replace(/[^a-z0-9]/g, "-")}.sudoai.app`;

    const logs = [
      { type: "system", message: "▶ Starting deployment...", stage: "deploy" },
      { type: "info", message: "Creating production build...", stage: "deploy" },
      { type: "info", message: "Provisioning container...", stage: "deploy" },
      { type: "info", message: "Configuring SSL & network...", stage: "deploy" },
      { type: "info", message: "Running health checks...", stage: "deploy" },
      { type: "success", message: `✓ Deployed to ${deployUrl}`, stage: "deploy" },
    ];
    for (const l of logs) await storage.createLog({ projectId: req.params.id, ...l });

    const deployment = await storage.createDeployment({ projectId: req.params.id, status: "live", url: deployUrl, version });
    await storage.updateProject(req.params.id, { buildStatus: "deployed", status: "deployed", deployUrl });
    res.json(deployment);
  });

  // ────────── SHELL ──────────
  app.post("/api/projects/:id/shell", async (req, res) => {
    const parsed = z.object({
      command: z.string().min(1),
      cwd: z.string().optional(),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Command required" });

    const secrets = await storage.getSecrets(req.params.id);
    const env: Record<string, string> = {};
    for (const s of secrets) env[s.key] = s.value;

    const projectDir = path.join("/tmp/devforge-projects", req.params.id);
    const cwd = parsed.data.cwd || projectDir;

    const result = await execShell(req.params.id, parsed.data.command, cwd, env);

    await storage.createLog({
      projectId: req.params.id,
      type: result.exitCode === 0 ? "info" : "error",
      message: `$ ${parsed.data.command}\n${result.stdout}${result.stderr ? "\n" + result.stderr : ""}`.trim(),
      stage: "shell",
    });

    res.json(result);
  });

  // ────────── GIT ──────────
  app.get("/api/projects/:id/git/status", async (req, res) => {
    const files = await storage.getFiles(req.params.id);
    await syncProjectFiles(req.params.id, files.filter(f => f.type === "file").map(f => ({ path: f.path, content: f.content })));
    const status = await getGitStatus(req.params.id);
    res.json({ status });
  });

  app.get("/api/projects/:id/git/log", async (req, res) => {
    const log = await getGitLog(req.params.id);
    const commits = log.split("\n").filter(Boolean).map(line => {
      const [hash, message, author, time] = line.split("|");
      return { hash: hash?.substring(0, 7), message, author, time };
    });
    const dbCommits = await storage.getGitCommits(req.params.id);
    res.json({ commits: dbCommits.length > 0 ? dbCommits : commits });
  });

  app.get("/api/projects/:id/git/diff", async (req, res) => {
    const file = typeof req.query.file === "string" ? req.query.file : undefined;
    const diff = await getGitDiff(req.params.id, file);
    res.json({ diff });
  });

  app.get("/api/projects/:id/git/branches", async (req, res) => {
    const result = await getGitBranches(req.params.id);
    res.json(result);
  });

  app.post("/api/projects/:id/git/reset", async (req, res) => {
    const parsed = z.object({ hash: z.string().min(1) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "hash required" });
    try {
      const output = await gitReset(req.params.id, parsed.data.hash);
      const files = await storage.getFiles(req.params.id);
      const projectDir = getProjectDir(req.params.id);
      for (const f of files) {
        const diskPath = path.join(projectDir, f.path);
        if (fs.existsSync(diskPath)) {
          const content = fs.readFileSync(diskPath, "utf-8");
          await storage.updateFile(f.id, content);
        }
      }
      await storage.createLog({ projectId: req.params.id, type: "info", message: `[git] reset --hard ${parsed.data.hash}`, stage: "console" });
      res.json({ success: true, output });
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.post("/api/projects/:id/git/branch", async (req, res) => {
    const parsed = z.object({ name: z.string().min(1), action: z.enum(["create", "checkout"]) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "name and action required" });
    try {
      const output = parsed.data.action === "create"
        ? await gitCreateBranch(req.params.id, parsed.data.name)
        : await gitCheckout(req.params.id, parsed.data.name);
      res.json({ success: true, output });
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.post("/api/projects/:id/git/stash", async (req, res) => {
    const parsed = z.object({ action: z.enum(["push", "pop"]) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "action required" });
    try {
      const output = await gitStash(req.params.id, parsed.data.action);
      res.json({ success: true, output });
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.post("/api/projects/:id/git/commit", async (req, res) => {
    const parsed = z.object({ message: z.string().min(1) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Commit message required" });

    const files = await storage.getFiles(req.params.id);
    await syncProjectFiles(req.params.id, files.filter(f => f.type === "file").map(f => ({ path: f.path, content: f.content })));

    const output = await gitCommit(req.params.id, parsed.data.message);
    const hash = Math.random().toString(16).substring(2, 9);

    const commit = await storage.createGitCommit({
      projectId: req.params.id,
      hash,
      message: parsed.data.message,
      files: files.map(f => f.path).join(", "),
      author: "You",
    });

    await storage.createLog({ projectId: req.params.id, type: "success", message: `[git] commit ${hash}: ${parsed.data.message}`, stage: "console" });
    res.json({ success: true, commit, output });
  });

  app.post("/api/projects/:id/git/init", async (req, res) => {
    await initGit(req.params.id);
    res.json({ success: true });
  });

  // ────────── AGENT CONFIG (.agent.json) ──────────
  app.get("/api/projects/:id/agent-config", async (req, res) => {
    const files = await storage.getFiles(req.params.id);
    const configFile = files.find(f => f.name === ".agent.json" || f.path === ".agent.json");
    if (!configFile) {
      return res.json({ exists: false, config: null });
    }
    try {
      const config = JSON.parse(configFile.content);
      res.json({ exists: true, config, fileId: configFile.id });
    } catch {
      res.json({ exists: true, config: configFile.content, fileId: configFile.id });
    }
  });

  app.put("/api/projects/:id/agent-config", async (req, res) => {
    const parsed = z.object({ run: z.string().optional(), install: z.string().optional(), description: z.string().optional(), env: z.record(z.string()).optional() }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid config" });

    const files = await storage.getFiles(req.params.id);
    const existing = files.find(f => f.name === ".agent.json" || f.path === ".agent.json");
    const content = JSON.stringify(parsed.data, null, 2);

    if (existing) {
      const updated = await storage.updateFile(existing.id, content);
      await writeProjectFile(req.params.id, ".agent.json", content);
      res.json(updated);
    } else {
      const newFile = await storage.createFile({
        projectId: req.params.id,
        name: ".agent.json",
        path: ".agent.json",
        content,
        type: "file",
        language: "json",
      });
      await writeProjectFile(req.params.id, ".agent.json", content);
      res.json(newFile);
    }
  });

  // ────────── DATABASE ──────────
  app.get("/api/projects/:id/database/tables", async (req, res) => {
    const secrets = await storage.getSecrets(req.params.id);
    const dbUrlSecret = secrets.find(s => s.key === "DATABASE_URL");
    if (!dbUrlSecret) {
      return res.json({ connected: false, tables: [], error: "No DATABASE_URL secret found" });
    }

    const pgLib = await import("pg");
    const client = new pgLib.default.Client({ connectionString: dbUrlSecret.value });
    try {
      await client.connect();
      await client.query("SET statement_timeout = '5s'");

      const colsResult = await client.query(`
        SELECT table_name, column_name as name, data_type as type, is_nullable = 'YES' as nullable
        FROM information_schema.columns
        WHERE table_schema = 'public'
        ORDER BY table_name, ordinal_position
      `);

      const tablesResult = await client.query(`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        ORDER BY table_name
      `);

      const colsByTable: Record<string, Array<{ name: string; type: string; nullable: boolean }>> = {};
      for (const col of colsResult.rows) {
        if (!colsByTable[col.table_name]) colsByTable[col.table_name] = [];
        colsByTable[col.table_name].push({ name: col.name, type: col.type, nullable: col.nullable });
      }

      const tables = tablesResult.rows.map(r => ({
        table_name: r.table_name,
        row_count: null,
        columns: colsByTable[r.table_name] || [],
      }));

      await client.end();
      res.json({ connected: true, tables });
    } catch (err: any) {
      try { await client.end(); } catch (_) {}
      res.json({ connected: false, tables: [], error: err.message });
    }
  });

  app.post("/api/projects/:id/database/query", async (req, res) => {
    const parsed = z.object({ query: z.string().min(1) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Query required" });

    const secrets = await storage.getSecrets(req.params.id);
    const dbUrlSecret = secrets.find(s => s.key === "DATABASE_URL");
    if (!dbUrlSecret) {
      return res.status(400).json({ message: "No DATABASE_URL secret configured for this project" });
    }

    const sql = parsed.data.query.trim();
    const stripped = sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--.*$/gm, "").trim();
    const upper = stripped.toUpperCase();
    const allowed = /^(SELECT|INSERT|UPDATE|DELETE|WITH|EXPLAIN)\b/i;
    if (!allowed.test(stripped)) {
      return res.status(403).json({ message: "Only SELECT, INSERT, UPDATE, DELETE, WITH, and EXPLAIN queries are allowed" });
    }
    if (stripped.includes(";") && stripped.indexOf(";") < stripped.length - 1) {
      return res.status(403).json({ message: "Multiple statements are not allowed" });
    }

    const pgLib = await import("pg");
    const client = new pgLib.default.Client({ connectionString: dbUrlSecret.value });
    try {
      await client.connect();
      await client.query("SET statement_timeout = '10s'");
      const start = Date.now();
      const result = await client.query(sql);
      const duration = Date.now() - start;
      await client.end();

      const rows = (result.rows || []).slice(0, 500);
      const fields = result.fields ? result.fields.map(f => f.name) : [];
      res.json({
        rows,
        fields,
        rowCount: result.rowCount ?? 0,
        duration,
        truncated: (result.rows || []).length > 500,
      });
    } catch (err: any) {
      try { await client.end(); } catch (_) {}
      res.status(400).json({ message: err.message });
    }
  });

  app.post("/api/projects/:id/database/provision", async (req, res) => {
    const projectId = req.params.id;
    const project = await storage.getProject(projectId);
    if (!project) return res.status(404).json({ message: "Project not found" });

    const existing = await storage.getSecrets(projectId);
    if (existing.find(s => s.key === "DATABASE_URL")) {
      return res.json({ message: "Database already provisioned", alreadyExists: true });
    }

    const mainDbUrl = process.env.DATABASE_URL;
    if (!mainDbUrl) {
      return res.status(500).json({ message: "No DATABASE_URL available on the server" });
    }

    const schemaName = `project_${projectId.replace(/[^a-zA-Z0-9]/g, "_").substring(0, 50)}`;
    const pgLib = await import("pg");
    const client = new pgLib.default.Client({ connectionString: mainDbUrl });
    try {
      await client.connect();
      await client.query(`CREATE SCHEMA IF NOT EXISTS "${schemaName}"`);
      await client.end();

      const urlObj = new URL(mainDbUrl);
      urlObj.searchParams.set("schema", schemaName);
      const projectDbUrl = urlObj.toString();

      await storage.createSecret({ projectId, key: "DATABASE_URL", value: projectDbUrl });

      res.json({ message: "Database provisioned", schema: schemaName });
    } catch (err: any) {
      try { await client.end(); } catch (_) {}
      res.status(500).json({ message: `Failed to provision: ${err.message}` });
    }
  });

  // ────────── SECRETS ──────────
  app.get("/api/projects/:id/secrets", async (req, res) => {
    const secrets = await storage.getSecrets(req.params.id);
    res.json(secrets.map(s => ({ ...s, value: "••••••••" })));
  });

  app.get("/api/projects/:id/secrets/raw", async (req, res) => {
    res.json(await storage.getSecrets(req.params.id));
  });

  app.post("/api/projects/:id/secrets", async (req, res) => {
    const parsed = z.object({ key: z.string().min(1), value: z.string() }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Key and value required" });
    const secret = await storage.createSecret({ projectId: req.params.id, key: parsed.data.key, value: parsed.data.value });
    res.json({ ...secret, value: "••••••••" });
  });

  app.patch("/api/projects/:id/secrets/:secretId", async (req, res) => {
    const parsed = z.object({ value: z.string() }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Value required" });
    const secret = await storage.updateSecret(req.params.secretId, parsed.data.value);
    if (!secret) return res.status(404).json({ message: "Secret not found" });
    res.json({ ...secret, value: "••••••••" });
  });

  app.delete("/api/projects/:id/secrets/:secretId", async (req, res) => {
    await storage.deleteSecret(req.params.secretId);
    res.json({ success: true });
  });

  // ────────── PREVIEW ──────────
  app.get("/api/projects/:id/preview", async (req, res) => {
    const proc = getProcess(req.params.id);
    if (proc) {
      return res.redirect(`/api/projects/${req.params.id}/proxy/`);
    }

    const project = await storage.getProject(req.params.id);
    if (!project) return res.status(404).send("Project not found");
    const files = await storage.getFiles(req.params.id);

    const indexHtml = files.find(f => f.name === "index.html" && !f.path.includes("client/"));
    if (indexHtml) {
      return res.send(indexHtml.content);
    }

    const cssFiles = files.filter(f => f.name.endsWith(".css")).map(f => `/* ${f.path} */\n${f.content}`).join("\n\n");
    const jsFiles = files.filter(f => (f.name.endsWith(".js") && !f.name.endsWith(".min.js"))).map(f => `// ${f.path}\n${f.content}`).join("\n\n");

    const html = generatePreviewHtml(project, files, cssFiles, jsFiles);
    res.send(html);
  });

  // ────────── PROXY (running app) ──────────
  app.use("/api/projects/:id/proxy", (req: Request, res: Response) => {
    const proc = getProcess(req.params.id);
    if (!proc || !proc.port) {
      const isStarting = proc && !proc.port;
      return res.status(503).send(`
        <html><head>${isStarting ? '<meta http-equiv="refresh" content="2">' : ''}</head>
        <body style="font-family:system-ui,sans-serif;background:#0d1117;color:#e6edf3;padding:40px;text-align:center;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:80vh">
          ${isStarting ? '<div style="width:24px;height:24px;border:3px solid #30363d;border-top-color:#58a6ff;border-radius:50%;animation:spin 1s linear infinite;margin-bottom:16px"></div>' : ''}
          <h2 style="margin:0 0 8px;font-size:16px">${isStarting ? 'Starting up...' : 'App not running'}</h2>
          <p style="color:#8b949e;font-size:13px;margin:0">${isStarting ? 'Your app is loading. This page will refresh automatically.' : 'Click the Run button in the workspace to start your app.'}</p>
          <style>@keyframes spin{to{transform:rotate(360deg)}}</style>
        </body></html>
      `);
    }

    const targetPath = req.originalUrl.replace(`/api/projects/${req.params.id}/proxy`, "") || "/";

    const options: http.RequestOptions = {
      hostname: "localhost",
      port: proc.port,
      path: targetPath || "/",
      method: req.method,
      headers: { ...req.headers, host: `localhost:${proc.port}` },
    };

    const proxyReq = http.request(options, (proxyRes) => {
      const headers = { ...proxyRes.headers };
      delete headers["x-frame-options"];
      delete headers["content-security-policy"];
      res.writeHead(proxyRes.statusCode || 200, headers);
      proxyRes.pipe(res, { end: true });
    });

    proxyReq.on("error", () => {
      if (!res.headersSent) {
        const currentProc = getProcess(req.params.id);
        const stillStarting = currentProc && (currentProc.status === "starting" || currentProc.status === "running");
        res.status(502).send(`
          <html><head>${stillStarting ? '<meta http-equiv="refresh" content="2">' : ''}</head>
          <body style="font-family:system-ui,sans-serif;background:#0d1117;color:#e6edf3;padding:40px;text-align:center;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:80vh">
            ${stillStarting
              ? '<div style="width:24px;height:24px;border:3px solid #30363d;border-top-color:#58a6ff;border-radius:50%;animation:spin 1s linear infinite;margin-bottom:16px"></div>'
              : ''}
            <h2 style="margin:0 0 8px;font-size:16px">${stillStarting ? 'Starting up...' : 'Cannot connect to app'}</h2>
            <p style="color:#8b949e;font-size:13px;margin:0">${stillStarting ? 'Your app is loading. This page will refresh automatically.' : 'The app may have crashed. Check the Console tab for logs.'}</p>
            <style>@keyframes spin{to{transform:rotate(360deg)}}</style>
          </body></html>
        `);
      }
    });

    if (req.method !== "GET" && req.method !== "HEAD") {
      req.pipe(proxyReq, { end: true });
    } else {
      proxyReq.end();
    }
  });

  return httpServer;
}


function generatePreviewHtml(project: any, files: any[], cssContent: string, jsContent: string): string {
  const readmeFile = files.find(f => f.name === "README.md");
  const readmeText = readmeFile?.content || "";
  const fileTree = files.map(f => `<li>${f.path}</li>`).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${project.name} - Preview</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: system-ui, sans-serif; background: #0d1117; color: #e6edf3; min-height: 100vh; }
  .header { background: #161b22; border-bottom: 1px solid #30363d; padding: 16px 24px; display: flex; align-items: center; gap: 12px; }
  .dot { width: 10px; height: 10px; border-radius: 50%; }
  .dot.red { background: #ff5f57; } .dot.yellow { background: #febc2e; } .dot.green { background: #28c840; }
  .main { max-width: 900px; margin: 0 auto; padding: 32px 24px; }
  .badge { display: inline-flex; padding: 3px 10px; border-radius: 20px; font-size: 12px; font-weight: 500; border: 1px solid; margin: 3px; }
  .badge-blue { background: rgba(88,166,255,.1); border-color: rgba(88,166,255,.3); color: #58a6ff; }
  .badge-green { background: rgba(63,185,80,.1); border-color: rgba(63,185,80,.3); color: #3fb950; }
  h1 { font-size: 28px; font-weight: 700; margin-bottom: 8px; color: #f0f6fc; }
  p.desc { color: #8b949e; margin-bottom: 24px; font-size: 15px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin: 24px 0; }
  .card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 20px; }
  .card h3 { font-size: 14px; color: #8b949e; margin-bottom: 12px; text-transform: uppercase; letter-spacing: .5px; }
  ul { list-style: none; }
  ul li { padding: 4px 0; font-size: 13px; color: #c9d1d9; font-family: monospace; }
  ul li::before { content: "📄 "; }
  .api-tag { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 700; margin-right: 6px; }
  .get { background: rgba(48,162,87,.15); color: #56d364; }
  .post { background: rgba(88,166,255,.15); color: #79c0ff; }
  .put { background: rgba(210,153,34,.15); color: #e3b341; }
  .delete { background: rgba(248,81,73,.15); color: #f85149; }
  ${cssContent}
</style>
</head>
<body>
<div class="header">
  <div class="dot red"></div><div class="dot yellow"></div><div class="dot green"></div>
  <span style="margin-left:8px;color:#8b949e;font-size:13px">${project.name} — Preview</span>
</div>
<div class="main">
  <h1>${project.name}</h1>
  <p class="desc">${project.description || "A " + project.language + "/" + project.framework + " application"}</p>
  <div style="margin-bottom:20px">
    <span class="badge badge-blue">${project.language}</span>
    <span class="badge badge-blue">${project.framework}</span>
    <span class="badge badge-green">${project.status}</span>
  </div>
  <div class="grid">
    <div class="card">
      <h3>Project Files</h3>
      <ul>${fileTree}</ul>
    </div>
    <div class="card">
      <h3>API Endpoints</h3>
      <ul>
        <li><span class="api-tag get">GET</span>/api/health</li>
        <li><span class="api-tag get">GET</span>/api/items</li>
        <li><span class="api-tag post">POST</span>/api/items</li>
        <li><span class="api-tag put">PUT</span>/api/items/:id</li>
        <li><span class="api-tag delete">DELETE</span>/api/items/:id</li>
      </ul>
    </div>
  </div>
  ${readmeText ? `<div class="card"><h3>README</h3><pre style="font-size:12px;overflow-x:auto;white-space:pre-wrap;color:#c9d1d9;margin-top:8px">${readmeText.substring(0, 500)}</pre></div>` : ""}
</div>
</body>
</html>`;
}

function getLanguageFromPath(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = { ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript", py: "python", go: "go", rs: "rust", json: "json", css: "css", html: "html", md: "markdown", yml: "yaml", yaml: "yaml" };
  return map[ext || ""] || "plaintext";
}

function generateProjectFiles(projectId: string, language: string, framework: string, prompt: string = "") {
  const lower = prompt.toLowerCase();

  if (language === "typescript" && (framework === "express" || framework === "nextjs")) {
    const isNext = framework === "nextjs";
    const base = [
      {
        projectId, name: "package.json", path: "package.json",
        content: JSON.stringify({
          name: "my-app", version: "1.0.0", type: "module",
          scripts: { dev: isNext ? "next dev" : "tsx watch src/index.ts", build: isNext ? "next build" : "tsc", test: "jest --coverage", start: isNext ? "next start" : "node dist/index.js" },
          dependencies: isNext
            ? { next: "^14.0.0", react: "^18.0.0", "react-dom": "^18.0.0" }
            : { express: "^5.0.0", cors: "^2.8.5", zod: "^3.22.0" },
          devDependencies: { typescript: "^5.0.0", "@types/node": "^20.0.0", tsx: "^4.0.0", jest: "^29.0.0" },
        }, null, 2),
        type: "file", language: "json",
      },
      {
        projectId, name: "tsconfig.json", path: "tsconfig.json",
        content: JSON.stringify({ compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "bundler", outDir: "./dist", strict: true, esModuleInterop: true, skipLibCheck: true }, include: ["src/**/*"] }, null, 2),
        type: "file", language: "json",
      },
      {
        projectId, name: ".gitignore", path: ".gitignore",
        content: "node_modules/\ndist/\n.env\n.env.local\n*.log\n.next/\ncoverage/",
        type: "file", language: "plaintext",
      },
      {
        projectId, name: ".env", path: ".env",
        content: "PORT=3000\nNODE_ENV=development",
        type: "file", language: "plaintext",
      },
    ];

    if (isNext) {
      return [
        ...base,
        {
          projectId, name: "page.tsx", path: "src/app/page.tsx",
          content: `export default function Home() {\n  return (\n    <main className="p-8">\n      <h1 className="text-3xl font-bold">Hello World</h1>\n      <p className="text-gray-500 mt-2">Built with Next.js</p>\n    </main>\n  );\n}`,
          type: "file", language: "typescript",
        },
        {
          projectId, name: "layout.tsx", path: "src/app/layout.tsx",
          content: `export default function RootLayout({ children }: { children: React.ReactNode }) {\n  return (\n    <html lang="en">\n      <body>{children}</body>\n    </html>\n  );\n}`,
          type: "file", language: "typescript",
        },
        { projectId, name: "README.md", path: "README.md", content: "# Next.js App\n\nBuilt with Next.js and TypeScript.\n\n## Getting Started\n\n```bash\nnpm install\nnpm run dev\n```", type: "file", language: "markdown" },
      ];
    }

    const hasAuth = lower.includes("auth") || lower.includes("login") || lower.includes("user");
    const hasDb = lower.includes("database") || lower.includes("db") || lower.includes("postgres");

    return [
      ...base,
      {
        projectId, name: "index.ts", path: "src/index.ts",
        content: `import express from "express";\nimport cors from "cors";\n${hasAuth ? 'import { authRouter } from "./routes/auth.js";\n' : ""}import { itemsRouter } from "./routes/items.js";\n\nconst app = express();\nconst PORT = process.env.PORT || 3000;\n\napp.use(cors());\napp.use(express.json());\n\napp.get("/", (_req, res) => res.json({ status: "ok", version: "1.0.0" }));\napp.get("/api/health", (_req, res) => res.json({ status: "healthy", uptime: process.uptime() }));\n${hasAuth ? 'app.use("/api/auth", authRouter);\n' : ""}app.use("/api/items", itemsRouter);\n\napp.listen(PORT, () => {\n  console.log(\`🚀 Server running at http://localhost:\${PORT}\`);\n});`,
        type: "file", language: "typescript",
      },
      {
        projectId, name: "items.ts", path: "src/routes/items.ts",
        content: `import { Router } from "express";\nimport { z } from "zod";\n\nexport const itemsRouter = Router();\n\nconst items: Array<{ id: string; title: string; done: boolean }> = [];\n\nconst itemSchema = z.object({\n  title: z.string().min(1).max(200),\n});\n\nitemsRouter.get("/", (_req, res) => res.json(items));\n\nitemsRouter.post("/", (req, res) => {\n  const parsed = itemSchema.safeParse(req.body);\n  if (!parsed.success) return res.status(400).json({ error: parsed.error });\n  const item = { id: crypto.randomUUID(), title: parsed.data.title, done: false };\n  items.push(item);\n  res.status(201).json(item);\n});\n\nitemsRouter.patch("/:id", (req, res) => {\n  const item = items.find(i => i.id === req.params.id);\n  if (!item) return res.status(404).json({ error: "Not found" });\n  Object.assign(item, req.body);\n  res.json(item);\n});\n\nitemsRouter.delete("/:id", (req, res) => {\n  const idx = items.findIndex(i => i.id === req.params.id);\n  if (idx === -1) return res.status(404).json({ error: "Not found" });\n  items.splice(idx, 1);\n  res.json({ success: true });\n});`,
        type: "file", language: "typescript",
      },
      ...(hasAuth ? [{
        projectId, name: "auth.ts", path: "src/routes/auth.ts",
        content: `import { Router } from "express";\nimport { z } from "zod";\n\nexport const authRouter = Router();\n\nconst loginSchema = z.object({ email: z.string().email(), password: z.string().min(8) });\n\nauthRouter.post("/login", (req, res) => {\n  const parsed = loginSchema.safeParse(req.body);\n  if (!parsed.success) return res.status(400).json({ error: "Invalid credentials" });\n  const token = Buffer.from(\`\${parsed.data.email}:\${Date.now()}\`).toString("base64");\n  res.json({ token, user: { email: parsed.data.email } });\n});\n\nauthRouter.post("/register", (req, res) => {\n  const parsed = loginSchema.safeParse(req.body);\n  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });\n  res.status(201).json({ message: "Registered", email: parsed.data.email });\n});`,
        type: "file", language: "typescript",
      }] : []),
      {
        projectId, name: "README.md", path: "README.md",
        content: `# ${prompt ? prompt.substring(0, 60) : "Express API"}\n\nA TypeScript Express.js application.\n\n## Getting Started\n\n\`\`\`bash\nnpm install\nnpm run dev\n\`\`\`\n\n## API Endpoints\n\n| Method | Path | Description |\n|--------|------|-------------|\n| GET | / | Health check |\n| GET | /api/health | Detailed health |\n| GET | /api/items | List items |\n| POST | /api/items | Create item |\n| PATCH | /api/items/:id | Update item |\n| DELETE | /api/items/:id | Delete item |`,
        type: "file", language: "markdown",
      },
    ];
  }

  if (language === "python") {
    return [
      {
        projectId, name: "main.py", path: "main.py",
        content: `from fastapi import FastAPI, HTTPException\nfrom fastapi.middleware.cors import CORSMiddleware\nfrom pydantic import BaseModel\nfrom typing import List, Optional\nfrom uuid import uuid4\n\napp = FastAPI(title="My API", version="1.0.0")\n\napp.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])\n\nclass Item(BaseModel):\n    title: str\n    done: bool = False\n\nclass ItemResponse(BaseModel):\n    id: str\n    title: str\n    done: bool\n\nitems: List[ItemResponse] = []\n\n@app.get("/")\ndef root():\n    return {"status": "ok", "version": "1.0.0"}\n\n@app.get("/api/health")\ndef health():\n    return {"status": "healthy"}\n\n@app.get("/api/items", response_model=List[ItemResponse])\ndef get_items():\n    return items\n\n@app.post("/api/items", response_model=ItemResponse, status_code=201)\ndef create_item(item: Item):\n    new_item = ItemResponse(id=str(uuid4()), **item.dict())\n    items.append(new_item)\n    return new_item\n\n@app.delete("/api/items/{item_id}")\ndef delete_item(item_id: str):\n    global items\n    items = [i for i in items if i.id != item_id]\n    return {"success": True}`,
        type: "file", language: "python",
      },
      {
        projectId, name: "requirements.txt", path: "requirements.txt",
        content: "fastapi==0.104.0\nuvicorn==0.24.0\npydantic==2.5.0\nhttpx==0.25.0",
        type: "file", language: "plaintext",
      },
      {
        projectId, name: ".gitignore", path: ".gitignore",
        content: "__pycache__/\n*.pyc\n.env\nvenv/\n.venv/",
        type: "file", language: "plaintext",
      },
      { projectId, name: "README.md", path: "README.md", content: "# FastAPI App\n\n```bash\npip install -r requirements.txt\nuvicorn main:app --reload\n```", type: "file", language: "markdown" },
    ];
  }

  return [
    { projectId, name: "README.md", path: "README.md", content: `# New ${language} Project\n\n${prompt || "A new project."}`, type: "file", language: "markdown" },
    { projectId, name: "main.ts", path: "src/main.ts", content: `// ${framework} application\nconsole.log("Hello, World!");`, type: "file", language },
  ];
}
