import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import * as pty from "node-pty";
import path from "path";
import fs from "fs";
import { storage } from "./storage";

interface TerminalSession {
  ws: WebSocket;
  ptyProcess: pty.IPty;
  projectId: string;
}

const sessions = new Map<WebSocket, TerminalSession>();

function isValidProjectId(id: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(id) && !id.includes("..") && id.length < 128;
}

export function setupTerminalWebSocket(server: Server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url || "", `http://${request.headers.host}`);
    if (url.pathname === "/ws/terminal") {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    }
  });

  wss.on("connection", async (ws, req) => {
    const url = new URL(req.url || "", `http://${req.headers.host}`);
    const projectId = url.searchParams.get("projectId");

    if (!projectId || !isValidProjectId(projectId)) {
      ws.close(1008, "Invalid projectId");
      return;
    }

    const projectDir = path.join("/tmp/devforge-projects", projectId);
    if (!fs.existsSync(projectDir)) {
      try {
        fs.mkdirSync(projectDir, { recursive: true });
      } catch (_) {}
    }

    const envVars: Record<string, string> = {
      ...(process.env as Record<string, string>),
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      LANG: "en_US.UTF-8",
      HOME: process.env.HOME || "/home/runner",
      PATH: process.env.PATH || "",
    };

    try {
      const secrets = await storage.getSecrets(projectId);
      for (const s of secrets) {
        envVars[s.key] = s.value;
      }
    } catch (_) {}

    const ptyProcess = pty.spawn("bash", ["--login"], {
      name: "xterm-256color",
      cols: 80,
      rows: 24,
      cwd: projectDir,
      env: envVars,
    });

    const session: TerminalSession = { ws, ptyProcess, projectId };
    sessions.set(ws, session);

    ptyProcess.onData((data: string) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "output", data }));
      }
    });

    ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "exit", code: exitCode }));
        ws.close();
      }
      sessions.delete(ws);
    });

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());

        if (msg.type === "input") {
          ptyProcess.write(msg.data);
        } else if (msg.type === "resize" && msg.cols && msg.rows) {
          ptyProcess.resize(
            Math.max(1, Math.min(500, msg.cols)),
            Math.max(1, Math.min(200, msg.rows))
          );
        }
      } catch (_) {
        ptyProcess.write(raw.toString());
      }
    });

    ws.on("close", () => {
      try { ptyProcess.kill(); } catch (_) {}
      sessions.delete(ws);
    });

    ws.on("error", () => {
      try { ptyProcess.kill(); } catch (_) {}
      sessions.delete(ws);
    });

    ws.send(JSON.stringify({
      type: "output",
      data: `\x1b[1;36mSudoAI Terminal\x1b[0m — ${projectDir}\r\n`
    }));
  });

  return wss;
}
