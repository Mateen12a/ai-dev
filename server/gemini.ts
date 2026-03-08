import { GoogleGenerativeAI } from "@google/generative-ai";

const API_KEY = process.env.GEMINI_API_KEY || "";
let genAI: GoogleGenerativeAI | null = null;

function getClient() {
  if (!genAI && API_KEY) {
    genAI = new GoogleGenerativeAI(API_KEY);
  }
  return genAI;
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
    return Object.keys(node).sort().map(key => {
      const isLeaf = Object.keys(node[key]).length === 0;
      if (isLeaf) return `${indent}${key}`;
      return `${indent}${key}/\n${render(node[key], indent + "  ")}`;
    }).join("\n");
  }
  return render(tree);
}

export async function generateWithGemini(prompt: string, context?: string): Promise<string> {
  const client = getClient();
  if (!client) return fallbackResponse(prompt);

  try {
    const model = client.getGenerativeModel({ model: "gemini-2.0-flash" });

    const systemContext = `You are SudoAI — an expert AI software engineering assistant embedded in an IDE.
You help developers write code, fix bugs, explain concepts, and build full applications.
When asked to generate code, produce clean, production-ready code.
When modifying files, be specific about what changed and why.
Keep responses concise but thorough. Use markdown formatting.
Current project context: ${context || "No project context provided"}`;

    const result = await model.generateContent([systemContext, prompt]);
    const response = await result.response;
    return response.text();
  } catch (err: any) {
    console.error("[Gemini] Error:", err.message);
    if (err.message?.includes("API_KEY") || err.message?.includes("authentication")) {
      return "⚠️ Gemini API key issue. Please check your GEMINI_API_KEY secret is valid.";
    }
    return fallbackResponse(prompt);
  }
}

export async function generateProjectCode(
  prompt: string,
  language: string,
  framework: string
): Promise<Array<{ path: string; content: string; description: string }>> {
  const client = getClient();
  if (!client) return [];

  try {
    const model = client.getGenerativeModel({ model: "gemini-2.0-flash" });

    const sysPrompt = `You are SudoAI, an expert code generator. Generate a complete ${language}/${framework} project based on the user's prompt.

Return ONLY a JSON array with this exact shape (no markdown, no extra text):
[
  {"path": "src/index.ts", "content": "...full file content...", "description": "Entry point"},
  {"path": "package.json", "content": "...full file content...", "description": "Dependencies"}
]

Rules:
- Include ALL files needed to run the project (package.json, main file, routes, etc.)
- Make code complete and production-ready, not stubs
- For ${language}/${framework} projects, include proper configuration files
- Maximum 8 files to keep it manageable
- File paths should be relative (no leading slash)`;

    const result = await model.generateContent([sysPrompt, `Build this: ${prompt}`]);
    const text = result.response.text().trim();

    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter(f => f.path && f.content);
  } catch (err: any) {
    console.error("[Gemini] Code gen error:", err.message);
    return [];
  }
}

export async function thinkAgentPlan(
  userMessage: string,
  projectContext: {
    name: string;
    language: string;
    framework: string;
    description: string;
    workingDir?: string;
  },
  files: Array<{ path: string; content: string }>,
  conversationHistory: Array<{ role: string; content: string }>
): Promise<{
  thinking: string;
  plan: string[];
  assessment: {
    confidence: "high" | "medium" | "low";
    canHandle: boolean;
    risks: string[];
    blockers: string[];
    recommendedMode: "fast" | "power" | "economy" | "autonomy" | null;
    clarificationNeeded: string | null;
    estimatedComplexity: "simple" | "moderate" | "complex" | "very_complex";
  };
}> {
  const client = getClient();
  const fallback = {
    thinking: "Analyzing the request...",
    plan: ["Understand the request", "Make the necessary changes", "Validate the result"],
    assessment: {
      confidence: "medium" as const,
      canHandle: true,
      risks: [],
      blockers: [],
      recommendedMode: null,
      clarificationNeeded: null,
      estimatedComplexity: "moderate" as const,
    },
  };

  if (!client) return fallback;

  try {
    const model = client.getGenerativeModel({ model: "gemini-2.0-flash" });

    const filePaths = files.map(f => f.path);
    const dirTree = buildDirTree(filePaths);

    const recentFiles = files.slice(0, 8).map(f => `${f.path} (${f.content.length} chars)`).join("\n");

    const historyText = conversationHistory
      .slice(-6)
      .map(m => `${m.role.toUpperCase()}: ${m.content}`)
      .join("\n");

    const systemPrompt = `You are SudoAI, an expert AI software engineering assistant.
Your job is to THINK and PLAN before taking action. Analyze the user's request carefully.

Project: "${projectContext.name}" (${projectContext.language}/${projectContext.framework})
${projectContext.description ? `Description: ${projectContext.description}` : ""}
${projectContext.workingDir ? `Working directory: ${projectContext.workingDir}` : ""}

Project structure:
${dirTree}

Files available (${files.length} total):
${recentFiles}

${historyText ? `Recent conversation:\n${historyText}` : ""}

User's request: "${userMessage}"

Produce a THINKING PLAN in JSON. Be honest about complexity and limitations.

Return ONLY this JSON:
{
  "thinking": "Your internal analysis in 2-3 sentences. What exactly is being asked? What parts of the codebase are involved? What could go wrong?",
  "plan": ["Step 1: ...", "Step 2: ...", "Step 3: ..."],
  "assessment": {
    "confidence": "high|medium|low",
    "canHandle": true,
    "risks": ["potential issue 1"],
    "blockers": [],
    "recommendedMode": null,
    "clarificationNeeded": null,
    "estimatedComplexity": "simple|moderate|complex|very_complex"
  }
}

Rules for assessment:
- confidence "high": clear task, familiar patterns, straightforward changes
- confidence "medium": some uncertainty, multiple files, potential side effects
- confidence "low": unclear requirements, missing context, risky changes
- canHandle false: truly impossible without external services, credentials, or info you don't have
- recommendedMode: suggest "autonomy" for complex multi-step tasks that need iteration; "power" for moderate tasks; "fast" for simple tasks; null if current mode is fine
- clarificationNeeded: a specific question if you need info to proceed; null if clear
- estimatedComplexity: "simple" (1-2 file changes), "moderate" (3-5 files), "complex" (6+ files, dependencies), "very_complex" (architecture changes, new services)`;

    const result = await model.generateContent(systemPrompt);
    const text = result.response.text().trim();

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          thinking: parsed.thinking || fallback.thinking,
          plan: Array.isArray(parsed.plan) ? parsed.plan : fallback.plan,
          assessment: {
            confidence: parsed.assessment?.confidence || "medium",
            canHandle: parsed.assessment?.canHandle !== false,
            risks: Array.isArray(parsed.assessment?.risks) ? parsed.assessment.risks : [],
            blockers: Array.isArray(parsed.assessment?.blockers) ? parsed.assessment.blockers : [],
            recommendedMode: parsed.assessment?.recommendedMode || null,
            clarificationNeeded: parsed.assessment?.clarificationNeeded || null,
            estimatedComplexity: parsed.assessment?.estimatedComplexity || "moderate",
          },
        };
      } catch (_) {}
    }

    return fallback;
  } catch (err: any) {
    console.error("[Gemini] Think plan error:", err.message);
    return fallback;
  }
}

export async function runAgentIteration(
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
    mode?: "fast" | "power" | "economy" | "autonomy";
    attachments?: Array<{ type: string; data: string; name: string }>;
  }
): Promise<{
  message: string;
  fileUpdates?: Array<{ path: string; content: string }>;
  shellCommands?: string[];
  planSteps?: string[];
  reasoning?: string;
  done: boolean;
}> {
  const client = getClient();
  if (!client) return { message: fallbackResponse(userMessage), done: true };

  try {
    const model = client.getGenerativeModel({ model: "gemini-2.0-flash" });
    const mode = options?.mode || "power";

    const filePaths = files.map(f => f.path);
    const dirTree = buildDirTree(filePaths);

    const fileList = files
      .slice(0, 20)
      .map(f => `### ${f.path}\n\`\`\`\n${f.content.substring(0, 2500)}\n\`\`\``)
      .join("\n\n");

    const historyText = conversationHistory
      .slice(-10)
      .map(m => `${m.role.toUpperCase()}: ${m.content}`)
      .join("\n");

    const shellResultsText = shellResults && shellResults.length > 0
      ? `\nRecent Shell Results:\n${shellResults.map(r => `$ ${r.command}\n[exit ${r.exitCode}] ${r.stdout}${r.stderr ? "\nSTDERR: " + r.stderr : ""}`).join("\n---\n")}`
      : "";

    const modeInstructions = {
      fast: "Be concise. Make minimal focused changes. Set done=true after one pass.",
      power: "Be thorough. Use shell commands to validate. Fix errors iteratively.",
      economy: "Make the smallest possible change to solve the problem. Avoid touching unrelated files.",
      autonomy: "Work autonomously. Plan, implement, test, and iterate until the feature is fully working.",
    }[mode];

    const workingDirNote = projectContext.workingDir
      ? `\nProject working directory (relative to shell CWD): ${projectContext.workingDir}\nShell commands run from the filesystem root of this project.\nTo work in the project: "cd ${projectContext.workingDir} && command"\nTo work in client: "cd ${projectContext.workingDir}/client && command"`
      : "";

    const modeGuide = `
MODE GUIDE — when to recommend switching:
- FAST: Only for tiny isolated edits (fix a typo, rename a variable, add one line). One file, no deps.
- ECONOMY: Fix one specific bug with minimal changes. Don't touch unrelated code.
- POWER: Feature additions, multi-file edits, refactors, config changes. Run validations.
- AUTONOMY (8 passes, human-in-loop): Complex tasks — new services, install dependencies, full feature implementation, debugging cascading errors across many files. If the task is clearly complex (requires 5+ file changes, dependency installs, or architecture decisions), explicitly say "NOTE: This task would benefit from Autonomy mode" in your message.`;

    const systemPrompt = `You are SudoAI, an expert AI software engineer with deep reasoning.
You run in an iterative fix-and-test loop: write code → run shell commands → see output → fix errors → repeat.
Current mode: ${mode.toUpperCase()} — ${modeInstructions}
${modeGuide}

Project: "${projectContext.name}" (${projectContext.language}/${projectContext.framework})
${projectContext.description ? `Description: ${projectContext.description}` : ""}
${workingDirNote}

CRITICAL — Shell command rules:
- Each shell command runs in isolation. NO persistent working directory between commands.
- Always use FULL paths from project root: "cd ${projectContext.workingDir || "."} && npm install"
- NEVER use ".." paths. Always use full paths from project root.
- Use the directory tree below to see the EXACT structure.

Directory tree:
${dirTree}

Current files (up to 20, truncated at 2500 chars each):
${fileList || "No files yet"}

${historyText ? `Recent conversation:\n${historyText}` : ""}
${shellResultsText}

══════════════════════════════════════════════════════
MANDATORY: THINK BEFORE ACTING
You MUST reason through the problem before writing any code or running commands.
Start your response with a <thinking> block:

<thinking>
UNDERSTAND: What is the user actually asking for? What is the goal?
CODEBASE: What files are involved? What is the current state of the relevant code?
APPROACH: What is the best way to implement this? What are the tradeoffs?
RISKS: What could break? What side effects might occur? What am I uncertain about?
MODE CHECK: Is ${mode.toUpperCase()} mode appropriate for this task, or should the user switch?
PLAN: Exact steps I will take (numbered).
</thinking>

After thinking, output the action JSON.
══════════════════════════════════════════════════════

Return format — thinking block FIRST, then JSON:
<thinking>
...your reasoning here...
</thinking>

AGENT_ACTION:
{
  "message": "Clear explanation of what I did and why. If mode change is recommended, say so here.",
  "planSteps": ["step 1", "step 2"],
  "fileUpdates": [{"path": "full/path/from/root.ts", "content": "full file content"}],
  "shellCommands": ["cd ${projectContext.workingDir || "."} && npm install"],
  "done": false
}`;

    const parts: any[] = [systemPrompt, `User Message: ${userMessage}`];

    if (options?.attachments) {
      for (const att of options.attachments) {
        if (att.type.startsWith("image/")) {
          parts.push({ inlineData: { data: att.data, mimeType: att.type } });
        } else if (att.type.startsWith("text/") || att.type === "application/json") {
          try {
            const text = Buffer.from(att.data, "base64").toString("utf-8");
            parts.push(`\nAttached file "${att.name}":\n\`\`\`\n${text.substring(0, 8000)}\n\`\`\``);
          } catch (_) {}
        }
      }
    }

    const result = await model.generateContent(parts);
    const text = result.response.text().trim();

    // Extract <thinking> block from response
    const thinkingMatch = text.match(/<thinking>([\s\S]*?)<\/thinking>/i);
    const reasoning = thinkingMatch ? thinkingMatch[1].trim() : undefined;

    const parsed = extractAgentAction(text);
    if (parsed) return { ...parsed, reasoning };

    return { message: text, done: true, reasoning };
  } catch (err: any) {
    console.error("[Gemini] Agent iteration error:", err.message);
    return { message: `I encountered an error: ${err.message}`, done: true };
  }
}

function extractAgentAction(text: string): {
  message: string;
  fileUpdates?: Array<{ path: string; content: string }>;
  shellCommands?: string[];
  planSteps?: string[];
  done: boolean;
} | null {
  const prefixMatch = text.match(/AGENT_ACTION:\s*(\{[\s\S]*\})/i);
  if (prefixMatch) {
    try { return JSON.parse(prefixMatch[1]); } catch (_) {}
  }

  const fenceMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (fenceMatch) {
    try { return JSON.parse(fenceMatch[1]); } catch (_) {}
  }

  const objMatch = text.match(/^\s*(\{[\s\S]*\})\s*$/);
  if (objMatch) {
    try { return JSON.parse(objMatch[1]); } catch (_) {}
  }

  const anyMatch = text.match(/\{[\s\S]*?"message"[\s\S]*?\}/);
  if (anyMatch) {
    try { return JSON.parse(anyMatch[0]); } catch (_) {}
  }

  return null;
}

export async function getAgentResponse(
  userMessage: string,
  projectContext: { name: string; language: string; framework: string; description: string },
  files: Array<{ path: string; content: string }>,
  conversationHistory: Array<{ role: string; content: string }>
): Promise<{
  message: string;
  fileUpdates?: Array<{ path: string; content: string }>;
  newFiles?: Array<{ path: string; content: string }>;
}> {
  const client = getClient();
  if (!client) return { message: fallbackResponse(userMessage) };

  try {
    const model = client.getGenerativeModel({ model: "gemini-2.0-flash" });

    const fileList = files
      .slice(0, 6)
      .map(f => `### ${f.path}\n\`\`\`\n${f.content.substring(0, 1500)}\n\`\`\``)
      .join("\n\n");

    const historyText = conversationHistory
      .slice(-6)
      .map(m => `${m.role.toUpperCase()}: ${m.content}`)
      .join("\n");

    const systemPrompt = `You are SudoAI, an expert AI software engineering assistant.

Project: "${projectContext.name}" (${projectContext.language}/${projectContext.framework})
${projectContext.description ? `Description: ${projectContext.description}` : ""}

Current files:
${fileList || "No files yet"}

${historyText ? `Recent conversation:\n${historyText}` : ""}

Instructions:
- If the user asks you to write/modify/add code, include the updated file content in your response
- Format file updates EXACTLY like this at the end of your response:
  ===FILE: path/to/file.ts===
  (full file content here)
  ===END===
- You can include multiple file blocks
- Give a clear explanation of what you did
- For explanations/questions, just respond normally without file blocks`;

    const result = await model.generateContent([systemPrompt, `User: ${userMessage}`]);
    const text = result.response.text();

    const fileUpdates: Array<{ path: string; content: string }> = [];
    const fileRegex = /===FILE: (.+?)===\n([\s\S]*?)===END===/g;
    let match;
    while ((match = fileRegex.exec(text)) !== null) {
      fileUpdates.push({ path: match[1].trim(), content: match[2].trim() });
    }

    const cleanMessage = text.replace(/===FILE: .+?===\n[\s\S]*?===END===/g, "").trim();

    return {
      message: cleanMessage || text,
      fileUpdates: fileUpdates.length > 0 ? fileUpdates : undefined,
    };
  } catch (err: any) {
    console.error("[Gemini] Agent error:", err.message);
    return { message: fallbackResponse(userMessage) };
  }
}

function fallbackResponse(prompt: string): string {
  const lower = prompt.toLowerCase();
  if (lower.includes("auth") || lower.includes("login")) {
    return "I can help you add authentication! Connect your Gemini API key to get full AI-powered responses.";
  }
  if (lower.includes("test")) {
    return "I can write comprehensive tests for your project. Connect your Gemini API key to enable full AI code generation.";
  }
  if (lower.includes("explain") || lower.includes("what") || lower.includes("how")) {
    return "I'd be happy to explain this codebase! Connect your Gemini API key in the Secrets panel for detailed AI-powered analysis.";
  }
  return "I'm SudoAI, your coding assistant. Connect your Gemini API key in Secrets to enable full AI-powered code generation, debugging, and explanations.";
}
