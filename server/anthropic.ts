// Claude / Anthropic AI provider for SudoAI
// Uses Replit AI Integrations — no personal API key required.
// Env vars AI_INTEGRATIONS_ANTHROPIC_BASE_URL and AI_INTEGRATIONS_ANTHROPIC_API_KEY
// are injected automatically after the integration is set up.

let Anthropic: any = null;

async function loadSdk() {
  if (Anthropic) return Anthropic;
  try {
    const mod = await import("@anthropic-ai/sdk");
    Anthropic = mod.default;
    return Anthropic;
  } catch {
    return null;
  }
}

function isAvailable(): boolean {
  return !!(
    process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL &&
    process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY
  );
}

function getClient() {
  if (!isAvailable()) return null;
  if (!Anthropic) return null;
  return new Anthropic({
    apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
    baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
  });
}

export const CLAUDE_MODELS = {
  haiku: "claude-haiku-4-5",
  sonnet: "claude-sonnet-4-6",
  opus: "claude-opus-4-6",
} as const;

export type ClaudeModel = (typeof CLAUDE_MODELS)[keyof typeof CLAUDE_MODELS];

export function isClaudeAvailable(): boolean {
  return isAvailable();
}

async function callClaude(
  model: string,
  systemPrompt: string,
  userContent: string,
  maxTokens = 8192
): Promise<string> {
  await loadSdk();
  const client = getClient();
  if (!client) throw new Error("Claude not available — Anthropic integration not set up");

  const message = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: "user", content: userContent }],
  });

  const block = message.content?.[0];
  if (block?.type === "text") return block.text.trim();
  return "";
}

function stripThinkingTags(text: string): string {
  return text.replace(/<thinking>[\s\S]*?<\/thinking>/gi, "").replace(/^\s*\n/gm, "\n").trim();
}

// ─────────────────────────────────────────────
// AGENT ITERATION — Claude version
// ─────────────────────────────────────────────
export async function runClaudeAgentIteration(
  userMessage: string,
  projectContext: {
    name: string;
    language: string;
    framework: string;
    description: string;
    workingDir?: string;
  },
  files: Array<{ path: string; content: string }>,
  conversationHistory: Array<{ role: string; content: string }>,
  shellResults?: Array<{ command: string; stdout: string; stderr: string; exitCode: number }>,
  options?: {
    mode?: string;
    modelOverride?: string;
  }
): Promise<{
  message: string;
  fileUpdates?: Array<{ path: string; content: string }>;
  shellCommands?: string[];
  planSteps?: string[];
  reasoning?: string;
  modelUsed?: string;
  done: boolean;
}> {
  await loadSdk();
  if (!isAvailable()) {
    throw new Error("Claude not available");
  }

  const mode = options?.mode || "agent";
  const modelName = options?.modelOverride || (mode === "max" ? CLAUDE_MODELS.opus : CLAUDE_MODELS.sonnet);

  const filePaths = files.map(f => f.path);
  const dirTree = buildDirTree(filePaths);

  const maxFiles = mode === "max" ? 30 : 20;
  const maxChars = mode === "max" ? 4000 : 2500;

  const fileList = files
    .slice(0, maxFiles)
    .map(f => `### ${f.path}\n\`\`\`\n${f.content.substring(0, maxChars)}\n\`\`\``)
    .join("\n\n");

  const historyText = conversationHistory
    .slice(-10)
    .map(m => `${m.role.toUpperCase()}: ${m.content}`)
    .join("\n");

  const shellResultsText = shellResults && shellResults.length > 0
    ? `\nRecent Shell Results:\n${shellResults.map(r => `$ ${r.command}\n[exit ${r.exitCode}] ${r.stdout}${r.stderr ? "\nSTDERR: " + r.stderr : ""}`).join("\n---\n")}`
    : "";

  const modeInstructions: Record<string, string> = {
    lite: "Be very concise. Make one focused change. Set done=true after one pass.",
    economy: "Make the smallest possible change to solve the problem. Touch as few files as possible.",
    power: "Be thorough. Use shell commands to validate. Fix errors iteratively across multiple files.",
    agent: "Work autonomously. Plan, implement, test, and iterate until the feature is fully working.",
    max: "Work like a senior engineer with unlimited time. Implement the COMPLETE solution including edge cases, error handling, and tests. Only set done=true when truly complete.",
    test: "Write comprehensive tests covering happy paths, edge cases, and error cases. Run and fix failures.",
    optimize: "Analyze holistically then implement concrete optimizations: reduce complexity, improve performance.",
  };

  const workingDirNote = projectContext.workingDir
    ? `\nProject working directory: ${projectContext.workingDir}\nTo run commands: "cd ${projectContext.workingDir} && command"`
    : "";

  const systemPrompt = `You are SudoAI (powered by Claude), an expert AI software engineer.
You run in an iterative fix-and-test loop: write code → run shell commands → see output → fix errors → repeat.
Current mode: ${mode.toUpperCase()} — ${modeInstructions[mode] || modeInstructions.power}

Project: "${projectContext.name}" (${projectContext.language}/${projectContext.framework})
${projectContext.description ? `Description: ${projectContext.description}` : ""}
${workingDirNote}

Shell command rules:
- Each shell command runs in isolation. NO persistent working directory between commands.
- Always use FULL paths: "cd ${projectContext.workingDir || "."} && npm install"
- NEVER use ".." paths.

Directory tree:
${dirTree}

Current files (up to ${maxFiles}, truncated at ${maxChars} chars each):
${fileList || "No files yet"}

${historyText ? `Recent conversation:\n${historyText}` : ""}
${shellResultsText}

Return format — AGENT_ACTION JSON:
AGENT_ACTION:
{
  "message": "Clear explanation of what I did and why.",
  "planSteps": ["step 1", "step 2"],
  "fileUpdates": [{"path": "full/path/from/root.ts", "content": "full file content"}],
  "shellCommands": ["cd ${projectContext.workingDir || "."} && npm test"],
  "done": false
}

Set "done": true only when the task is truly complete.`;

  const text = await callClaude(modelName, systemPrompt, `User Message: ${userMessage}`);

  const parsed = extractAgentAction(text);
  if (parsed) {
    return {
      ...parsed,
      message: stripThinkingTags(parsed.message || ""),
      modelUsed: modelName,
    };
  }

  return { message: stripThinkingTags(text), done: true, modelUsed: modelName };
}

function buildDirTree(filePaths: string[]): string {
  const tree: Record<string, any> = {};
  for (const p of filePaths) {
    const parts = p.split("/");
    let node = tree;
    for (const part of parts) {
      if (!node[part]) node[part] = {};
      node = node[part];
    }
  }
  function render(node: Record<string, any>, indent = ""): string {
    return Object.keys(node)
      .sort()
      .map(key => {
        const isLeaf = Object.keys(node[key]).length === 0;
        if (isLeaf) return `${indent}${key}`;
        return `${indent}${key}/\n${render(node[key], indent + "  ")}`;
      })
      .join("\n");
  }
  return render(tree);
}

function extractAgentAction(text: string): {
  message: string;
  fileUpdates?: Array<{ path: string; content: string }>;
  shellCommands?: string[];
  planSteps?: string[];
  done: boolean;
} | null {
  const stripped = stripThinkingTags(text);

  const prefixMatch = stripped.match(/AGENT_ACTION:\s*(\{[\s\S]*\})/i);
  if (prefixMatch) {
    try { return JSON.parse(prefixMatch[1]); } catch (_) {}
  }

  const fenceMatch = stripped.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (fenceMatch) {
    try { return JSON.parse(fenceMatch[1]); } catch (_) {}
  }

  const anyMatch = stripped.match(/\{[\s\S]*?"message"[\s\S]*?"done"\s*:\s*(true|false)[\s\S]*?\}/);
  if (anyMatch) {
    try { return JSON.parse(anyMatch[0]); } catch (_) {}
  }

  const fallbackMatch = stripped.match(/\{[\s\S]*?"message"[\s\S]*?\}/);
  if (fallbackMatch) {
    try { return JSON.parse(fallbackMatch[0]); } catch (_) {}
  }

  return null;
}
