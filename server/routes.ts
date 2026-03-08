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
import { runAgentIteration, generateProjectCode, thinkAgentPlan } from "./gemini";
import { importFromGitHub, importFromZip } from "./import-handlers";
import {
  startProcess, killProcess, getProcess,
  detectStartCommand, detectInstallCommand, detectInstallCommands
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

  // ────────── AI MESSAGES ──────────
  app.get("/api/projects/:id/messages", async (req, res) => {
    res.json(await storage.getMessages(req.params.id));
  });

  // Helper: run a batch of agent iterations, returns summary
  async function runAgentBatch(
    projectId: string,
    userMessage: string,
    projectCtx: { name: string; language: string; framework: string; description: string; workingDir?: string },
    mode: string,
    startIteration: number,
    batchSize: number,
    attachments?: Array<{ type: string; data: string; name: string }>
  ): Promise<{ finalMessage: string; filesUpdated: number; done: boolean; stoppedAtIteration: number }> {
    let currentFiles = await storage.getFiles(projectId);
    let history = await storage.getMessages(projectId);
    let shellResults: Array<{ command: string; stdout: string; stderr: string; exitCode: number }> = [];
    let finalAiMessage = "";
    let totalFilesUpdated = 0;
    let done = false;

    for (let i = 0; i < batchSize; i++) {
      const globalIteration = startIteration + i;
      await storage.createLog({ projectId, type: "system", message: `🔄 Iteration ${globalIteration + 1}...`, stage: "agent" });

      const response = await runAgentIteration(
        userMessage,
        projectCtx,
        currentFiles.map(f => ({ path: f.path, content: f.content })),
        history.map(m => ({ role: m.role, content: m.content })),
        shellResults,
        { mode: mode as any, attachments: globalIteration === 0 ? attachments : undefined }
      );

      finalAiMessage = response.message;

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
      if (modeNoteText && /autonomy mode|switch.*autonomy|benefit from auto/i.test(modeNoteText)) {
        await storage.createLog({
          projectId,
          type: "system",
          message: `__RECOMMEND__${JSON.stringify({ mode: "autonomy", reason: "Agent recommends Autonomy mode for this complex task" })}`,
          stage: "agent",
        });
      }

      const allFileUpdates = response.fileUpdates || [];
      for (const update of allFileUpdates) {
        const existing = currentFiles.find(f => f.path === update.path);
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
        totalFilesUpdated++;
      }

      if (response.shellCommands && response.shellCommands.length > 0) {
        shellResults = [];
        const projectDir = path.join("/tmp/devforge-projects", projectId);
        const secrets = await storage.getSecrets(projectId);
        const env: Record<string, string> = {};
        for (const s of secrets) env[s.key] = s.value;

        for (const cmd of response.shellCommands) {
          await storage.createLog({ projectId, type: "system", message: `$ ${cmd}`, stage: "agent" });
          const result = await execShell(projectId, cmd, projectDir, env);
          shellResults.push({ command: cmd, ...result });
          await storage.createLog({
            projectId,
            type: result.exitCode === 0 ? "info" : "error",
            message: `${result.stdout}${result.stderr ? "\n" + result.stderr : ""}`.trim(),
            stage: "agent",
          });
        }
      } else {
        shellResults = [];
      }

      if (response.done || (!response.shellCommands?.length && !response.fileUpdates?.length)) {
        done = true;
        break;
      }

      currentFiles = await storage.getFiles(projectId);
    }

    return { finalMessage: finalAiMessage, filesUpdated: totalFilesUpdated, done, stoppedAtIteration: startIteration + batchSize };
  }

  app.post("/api/projects/:id/messages", async (req, res) => {
    const parsed = z.object({
      content: z.string().min(1),
      mode: z.enum(["fast", "power", "economy", "autonomy"]).default("power"),
      phase: z.enum(["think", "execute"]).optional(),
      attachments: z.array(z.object({
        type: z.string(),
        data: z.string(),
        name: z.string(),
      })).optional(),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Content required" });

    const { mode, attachments, phase } = parsed.data;
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
    };

    // ── AUTONOMY THINK PHASE ─────────────────────────────────────────────────
    // When phase="think", run only the analysis pass — no code changes yet
    if (mode === "autonomy" && phase === "think") {
      const userMsg = await storage.createMessage({ projectId, role: "user", content: parsed.data.content });
      await storage.createLog({ projectId, type: "system", message: `🧠 Planning... [autonomy mode]`, stage: "agent" });

      const history = await storage.getMessages(projectId);
      const thinkResult = await thinkAgentPlan(
        parsed.data.content,
        projectCtx,
        allFiles.map(f => ({ path: f.path, content: f.content })),
        history.map(m => ({ role: m.role, content: m.content }))
      );

      // Store plan as a structured log for the UI to render
      await storage.createLog({
        projectId,
        type: "system",
        message: `__PLAN__${JSON.stringify(thinkResult)}`,
        stage: "agent",
      });

      // Create an autonomy session
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
      });
    }

    // ── NON-AUTONOMY FLOW ────────────────────────────────────────────────────
    const userMsg = await storage.createMessage({ projectId, role: "user", content: parsed.data.content });
    await storage.createLog({ projectId, type: "system", message: `🤖 Agent starting... [${mode} mode]`, stage: "agent" });

    // Always run a think step (non-blocking, fast) — shown as progress in UI
    const history = await storage.getMessages(projectId);
    const thinkResult = await thinkAgentPlan(
      parsed.data.content,
      projectCtx,
      allFiles.map(f => ({ path: f.path, content: f.content })),
      history.map(m => ({ role: m.role, content: m.content }))
    );

    // Store plan log for UI rendering
    await storage.createLog({
      projectId,
      type: "system",
      message: `__PLAN__${JSON.stringify(thinkResult)}`,
      stage: "agent",
    });

    // Emit mode recommendation if needed
    if (thinkResult.assessment.recommendedMode && thinkResult.assessment.recommendedMode !== mode) {
      await storage.createLog({
        projectId,
        type: "system",
        message: `__RECOMMEND__${JSON.stringify({ mode: thinkResult.assessment.recommendedMode, reason: `This task is ${thinkResult.assessment.estimatedComplexity}. Consider switching to ${thinkResult.assessment.recommendedMode} mode for best results.` })}`,
        stage: "agent",
      });
    }

    // If agent cannot handle: explain and stop
    if (!thinkResult.assessment.canHandle) {
      const blockerMsg = `I can't complete this task as-is. Here's why:\n\n${thinkResult.assessment.blockers.join("\n")}\n\n${thinkResult.assessment.clarificationNeeded ? `To proceed, I need: ${thinkResult.assessment.clarificationNeeded}` : ""}`;
      const aiMsg = await storage.createMessage({ projectId, role: "assistant", content: blockerMsg });
      return res.json({ user: userMsg, assistant: aiMsg, filesUpdated: 0, plan: thinkResult });
    }

    // Clarification needed
    if (thinkResult.assessment.clarificationNeeded) {
      const aiMsg = await storage.createMessage({ projectId, role: "assistant", content: `Before I start, I need some clarification:\n\n${thinkResult.assessment.clarificationNeeded}` });
      return res.json({ user: userMsg, assistant: aiMsg, filesUpdated: 0, plan: thinkResult });
    }

    const maxIterations = mode === "fast" ? 1 : mode === "economy" ? 1 : 4;

    const { finalMessage, filesUpdated, done: execDone } = await runAgentBatch(
      projectId, parsed.data.content, projectCtx, mode, 0, maxIterations, attachments
    );

    const aiMsg = await storage.createMessage({ projectId, role: "assistant", content: finalMessage });
    res.json({ user: userMsg, assistant: aiMsg, filesUpdated, plan: thinkResult });
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

    // Run a batch of 2-4 iterations
    const remaining = session.totalIterations - session.iterationsDone;
    const batchSize = Math.min(action === "execute" ? 4 : 2, remaining);

    await storage.createLog({ projectId, type: "system", message: `▶️ Continuing... (iterations ${session.iterationsDone + 1}–${session.iterationsDone + batchSize} of ${session.totalIterations})`, stage: "agent" });

    const { finalMessage, filesUpdated, done: batchDone, stoppedAtIteration } = await runAgentBatch(
      projectId, session.userMessage, projectCtx, "autonomy", session.iterationsDone, batchSize
    );

    session.iterationsDone = stoppedAtIteration;
    session.expiresAt = Date.now() + 30 * 60 * 1000;

    const remainingAfter = session.totalIterations - session.iterationsDone;
    const isDone = batchDone || remainingAfter <= 0;

    if (isDone) {
      autonomySessions.delete(sessionId);
      await storage.createLog({ projectId, type: "system", message: `✅ Autonomy agent complete`, stage: "agent" });
      const aiMsg = await storage.createMessage({ projectId, role: "assistant", content: finalMessage });
      return res.json({ status: "done", assistant: aiMsg, filesUpdated });
    }

    // Checkpoint — ask user to continue
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
      preview: finalMessage.slice(0, 400),
    });
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

    // Detect correct working directory — ZIP imports can have files under a subfolder
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

    const installCmds = detectInstallCommands(files, workingDir);
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

    const result = await startProcess(req.params.id, cmd, { ...env, PWD: workingDir }, async (msg, type) => {
      await storage.createLog({ projectId: req.params.id, type, message: msg, stage: "console" });
    });

    res.json(result);
  });

  app.post("/api/projects/:id/stop", async (req, res) => {
    await killProcess(req.params.id);
    await storage.updateProject(req.params.id, { buildStatus: "idle", status: "idle" });
    await storage.createLog({ projectId: req.params.id, type: "system", message: "⏹ App stopped.", stage: "console" });
    res.json({ success: true });
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
    if (proc && proc.port) {
      return res.redirect(`/api/projects/${req.params.id}/proxy/`);
    }

    const project = await storage.getProject(req.params.id);
    if (!project) return res.status(404).send("Project not found");
    const files = await storage.getFiles(req.params.id);

    const indexHtml = files.find(f => f.name === "index.html");
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
      return res.status(503).send(`
        <html><body style="font-family:monospace;background:#0d1117;color:#e6edf3;padding:40px;text-align:center">
          <h2>App not running</h2>
          <p style="color:#8b949e">Click the ▶ Run button in the workspace to start your app.</p>
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
        res.status(502).send(`
          <html><body style="font-family:monospace;background:#0d1117;color:#e6edf3;padding:40px;text-align:center">
            <h2>Cannot connect to app</h2>
            <p style="color:#8b949e">App is starting or crashed. Check the Console tab for logs.</p>
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
