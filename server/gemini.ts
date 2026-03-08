import { GoogleGenerativeAI } from "@google/generative-ai";

const API_KEY = process.env.GEMINI_API_KEY || "";
let genAI: GoogleGenerativeAI | null = null;

function getClient() {
  if (!genAI && API_KEY) {
    genAI = new GoogleGenerativeAI(API_KEY);
  }
  return genAI;
}

export type AgentMode = "lite" | "economy" | "power" | "agent" | "max" | "test" | "optimize";

// ─────────────────────────────────────────────
// AUTO MODEL SELECTION
// Flash = fast/cheap, Pro = deep/complex, Thinking = analysis-heavy
// ─────────────────────────────────────────────
const MODELS = {
  flash: "gemini-2.0-flash",
  pro: "gemini-1.5-pro",
  thinking: "gemini-2.0-flash-thinking-exp-01-21",
} as const;

export function selectModelForMode(
  mode: AgentMode,
  complexity?: "simple" | "moderate" | "complex" | "very_complex"
): { model: string; label: string } {
  switch (mode) {
    case "lite":
      return { model: MODELS.flash, label: "Flash" };
    case "economy":
      return { model: MODELS.flash, label: "Flash" };
    case "power":
      if (complexity === "very_complex" || complexity === "complex") {
        return { model: MODELS.pro, label: "Pro" };
      }
      return { model: MODELS.flash, label: "Flash" };
    case "agent":
      return { model: MODELS.flash, label: "Flash" };
    case "max":
      return { model: MODELS.pro, label: "Pro" };
    case "test":
      return { model: MODELS.thinking, label: "Flash Thinking" };
    case "optimize":
      return { model: MODELS.pro, label: "Pro" };
    default:
      return { model: MODELS.flash, label: "Flash" };
  }
}

function stripThinkingTags(text: string): string {
  return text.replace(/<thinking>[\s\S]*?<\/thinking>/gi, "").replace(/^\s*\n/gm, "\n").trim();
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

async function callModel(modelName: string, parts: any[]): Promise<string> {
  const client = getClient();
  if (!client) throw new Error("No Gemini client (missing API key)");
  try {
    const model = client.getGenerativeModel({ model: modelName });
    const result = await model.generateContent(parts);
    return result.response.text().trim();
  } catch (err: any) {
    if (modelName !== MODELS.flash) {
      console.warn(`[Gemini] Model ${modelName} failed, falling back to flash:`, err.message);
      const model = client.getGenerativeModel({ model: MODELS.flash });
      const result = await model.generateContent(parts);
      return result.response.text().trim();
    }
    throw err;
  }
}

export async function* callModelStream(modelName: string, parts: any[]): AsyncGenerator<string> {
  const client = getClient();
  if (!client) throw new Error("No Gemini client (missing API key)");
  const model = client.getGenerativeModel({ model: modelName });
  const result = await model.generateContentStream(parts);
  for await (const chunk of result.stream) {
    const text = chunk.text();
    if (text) yield text;
  }
}

// ─────────────────────────────────────────────
// GENERATE WITH GEMINI (simple one-shot)
// ─────────────────────────────────────────────
export async function generateWithGemini(prompt: string, context?: string): Promise<string> {
  const client = getClient();
  if (!client) return fallbackResponse(prompt);

  try {
    const systemContext = `You are SudoAI — an expert AI software engineering assistant embedded in an IDE.
You help developers write code, fix bugs, explain concepts, and build full applications.
When asked to generate code, produce clean, production-ready code.
When modifying files, be specific about what changed and why.
Keep responses concise but thorough. Use markdown formatting.
Current project context: ${context || "No project context provided"}`;

    return await callModel(MODELS.flash, [systemContext, prompt]);
  } catch (err: any) {
    console.error("[Gemini] Error:", err.message);
    if (err.message?.includes("API_KEY") || err.message?.includes("authentication")) {
      return "⚠️ Gemini API key issue. Please check your GEMINI_API_KEY secret is valid.";
    }
    return fallbackResponse(prompt);
  }
}

// ─────────────────────────────────────────────
// GENERATE PROJECT CODE (initial scaffold)
// ─────────────────────────────────────────────
export async function generateProjectCode(
  prompt: string,
  language: string,
  framework: string
): Promise<Array<{ path: string; content: string; description: string }>> {
  const client = getClient();
  if (!client) return [];

  try {
    const isFullStack = /react|vue|svelte|next|frontend|client.*server|full.?stack|spa|vite/i.test(prompt + " " + framework);
    const hasBackend = /express|fastify|api|backend|server|rest|graphql/i.test(prompt + " " + framework);

    const fullStackNote = (isFullStack && hasBackend)
      ? `This is a FULL-STACK project. You MUST generate BOTH:
1. Frontend files (client/ folder with React/Vite app)
2. Backend files (server/ folder with Express/Node API)
Include: client/package.json, client/index.html, client/src/main.tsx, client/src/App.tsx, server/index.ts, server/routes.ts, package.json (root), tsconfig.json`
      : isFullStack
        ? `Generate a complete frontend app with all components, styles, and config files.`
        : `Generate a complete backend API with all routes, middleware, and config files.`;

    const sysPrompt = `You are SudoAI, an expert code generator. Generate a complete ${language}/${framework} project based on the user's prompt.

${fullStackNote}

Return ONLY a JSON array with this exact shape (no markdown, no extra text):
[
  {"path": "src/index.ts", "content": "...full file content...", "description": "Entry point"},
  {"path": "package.json", "content": "...full file content...", "description": "Dependencies"}
]

Rules:
- Include ALL files needed to run the project (package.json, main file, routes, components, etc.)
- Make code complete and functional, not stubs — real working code
- Include proper TypeScript config, vite config, or other necessary config files
- For full-stack: client folder has its own package.json with React/Vite deps; server has its own deps
- Maximum 12 files total
- File paths should be relative (no leading slash)
- All file contents must be complete and syntactically correct`;

    const text = await callModel(MODELS.flash, [sysPrompt, `Build this: ${prompt}`]);
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

// ─────────────────────────────────────────────
// THINK / PLAN PHASE
// ─────────────────────────────────────────────
export async function thinkAgentPlan(
  userMessage: string,
  projectContext: {
    name: string;
    language: string;
    framework: string;
    description: string;
    workingDir?: string;
    editorContext?: {
      activeFile: string | null;
      selection: string | null;
      cursorLine: number | null;
    };
  },
  files: Array<{ path: string; content: string }>,
  conversationHistory: Array<{ role: string; content: string }>,
  mode: AgentMode = "power"
): Promise<{
  thinking: string;
  plan: string[];
  modelSelected: string;
  modelLabel: string;
  assessment: {
    confidence: "high" | "medium" | "low";
    canHandle: boolean;
    risks: string[];
    blockers: string[];
    recommendedMode: AgentMode | null;
    clarificationNeeded: string | null;
    estimatedComplexity: "simple" | "moderate" | "complex" | "very_complex";
  };
}> {
  const client = getClient();
  const fallback = {
    thinking: "Analyzing the request...",
    plan: ["Understand the request", "Make the necessary changes", "Validate the result"],
    modelSelected: MODELS.flash,
    modelLabel: "Flash",
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
${projectContext.editorContext?.activeFile ? `Editor Context: The user is currently viewing "${projectContext.editorContext.activeFile}"${projectContext.editorContext.cursorLine ? ` at line ${projectContext.editorContext.cursorLine}` : ""}.${projectContext.editorContext.selection ? ` Selected text: "${projectContext.editorContext.selection.substring(0, 500)}"` : ""}` : ""}

Project structure:
${dirTree}

Files available (${files.length} total):
${recentFiles}

${historyText ? `Recent conversation:\n${historyText}` : ""}

User's request: "${userMessage}"
Current mode: ${mode.toUpperCase()}

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

Mode recommendation rules:
- "lite": trivial single-line changes, quick questions
- "economy": small isolated bug fix, one file
- "power": feature additions, multi-file, 3-5 files
- "agent": complex multi-step, needs iteration and review (6+ files)
- "max": very complex architecture, new services, full feature builds (fully autonomous)
- "test": when user wants tests written or existing tests fixed
- "optimize": when user wants performance/code quality improvements
- Set recommendedMode to null if current mode seems appropriate`;

    const text = await callModel(MODELS.flash, [systemPrompt]);
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        const complexity = parsed.assessment?.estimatedComplexity || "moderate";
        const recommendedMode = (parsed.assessment?.recommendedMode as AgentMode) || null;
        const effectiveMode = recommendedMode || mode;
        const { model: selectedModel, label: modelLabel } = selectModelForMode(effectiveMode, complexity);

        return {
          thinking: parsed.thinking || fallback.thinking,
          plan: Array.isArray(parsed.plan) ? parsed.plan : fallback.plan,
          modelSelected: selectedModel,
          modelLabel,
          assessment: {
            confidence: parsed.assessment?.confidence || "medium",
            canHandle: parsed.assessment?.canHandle !== false,
            risks: Array.isArray(parsed.assessment?.risks) ? parsed.assessment.risks : [],
            blockers: Array.isArray(parsed.assessment?.blockers) ? parsed.assessment.blockers : [],
            recommendedMode,
            clarificationNeeded: parsed.assessment?.clarificationNeeded || null,
            estimatedComplexity: complexity,
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

// ─────────────────────────────────────────────
// AGENT ITERATION (core loop)
// ─────────────────────────────────────────────
export async function runAgentIteration(
  userMessage: string,
  projectContext: {
    name: string;
    language: string;
    framework: string;
    description: string;
    workingDir?: string;
    editorContext?: {
      activeFile: string | null;
      selection: string | null;
      cursorLine: number | null;
    };
  },
  files: Array<{ path: string; content: string }>,
  conversationHistory: Array<{ role: string; content: string }>,
  shellResults?: Array<{ command: string; stdout: string; stderr: string; exitCode: number }>,
  options?: {
    mode?: AgentMode;
    modelOverride?: string;
    attachments?: Array<{ type: string; data: string; name: string }>;
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
  const client = getClient();
  if (!client) return { message: fallbackResponse(userMessage), done: true };

  try {
    const mode = options?.mode || "power";
    const { model: autoModel } = selectModelForMode(mode);
    const modelName = options?.modelOverride || autoModel;

    const filePaths = files.map(f => f.path);
    const dirTree = buildDirTree(filePaths);

    // For Max/Power modes include more files with more content
    const maxFiles = mode === "max" ? 30 : mode === "power" ? 20 : 15;
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

    const modeInstructions: Record<AgentMode, string> = {
      lite: "Be very concise. Make one focused change. Set done=true after one pass. Do NOT run shell commands unless truly necessary.",
      economy: "Make the smallest possible change to solve the problem. Touch as few files as possible. Set done=true when the minimal fix is applied.",
      power: "Be thorough. Use shell commands to validate. Fix errors iteratively across multiple files.",
      agent: "Work autonomously. Plan, implement, test, and iterate until the feature is fully working.",
      max: "Work like a senior engineer with unlimited time. Be exhaustive. Implement the COMPLETE solution including edge cases, error handling, and tests. Run commands to verify. Only set done=true when the entire feature is truly complete and tested.",
      test: "You are a test engineer. Write comprehensive tests covering happy paths, edge cases, and error cases. Run existing tests to see what passes/fails. Fix any failures. Use the appropriate test framework for this project.",
      optimize: "You are a performance and code quality engineer. First analyze the codebase holistically, then implement concrete optimizations: reduce complexity, improve performance, eliminate dead code, improve readability, and add missing error handling.",
    };

    const workingDirNote = projectContext.workingDir
      ? `\nProject working directory (relative to shell CWD): ${projectContext.workingDir}\nShell commands run from the filesystem root of this project.\nTo work in the project: "cd ${projectContext.workingDir} && command"\nTo work in client: "cd ${projectContext.workingDir}/client && command"`
      : "";

    const languageSpecificNotes: Record<string, string> = {
      python: `\nPython project notes:
- Use python3 for all commands (not python)
- Install deps with: pip install -r requirements.txt
- For FastAPI: run with uvicorn main:app --host 0.0.0.0 --port 3000 --reload
- For Flask: run with python3 -m flask run --host 0.0.0.0 --port 3000
- For Django: run with python3 manage.py runserver 0.0.0.0:3000
- Always bind to 0.0.0.0 and port 3000 for the preview to work`,
      go: `\nGo project notes:
- Run with: go run .
- Install deps with: go mod download
- For web servers, listen on 0.0.0.0:3000 for the preview to work
- Use go mod tidy to clean up dependencies`,
      rust: `\nRust project notes:
- Run with: cargo run
- Build with: cargo build
- For web servers (actix-web, axum, rocket), bind to 0.0.0.0:3000
- Use cargo add <crate> to add dependencies`,
      ruby: `\nRuby project notes:
- Run with: ruby main.rb
- Install deps with: bundle install
- For Rails: run with rails server -b 0.0.0.0 -p 3000`,
      java: `\nJava project notes:
- For Maven: mvn spring-boot:run
- For Gradle: ./gradlew bootRun
- Bind to port 3000 for preview`,
    };
    const langNote = languageSpecificNotes[projectContext.language] || "";

    const editorContextNote = projectContext.editorContext?.activeFile
      ? `\n\nEditor Context: The user is currently viewing "${projectContext.editorContext.activeFile}"${projectContext.editorContext.cursorLine ? ` at line ${projectContext.editorContext.cursorLine}` : ""}.${projectContext.editorContext.selection ? `\nSelected text:\n\`\`\`\n${projectContext.editorContext.selection.substring(0, 2000)}\n\`\`\`` : ""}\nPrioritize this file in your response when relevant.`
      : "";

    const systemPrompt = `You are SudoAI, an expert AI software engineer.
You run in an iterative fix-and-test loop: write code → run shell commands → see output → fix errors → repeat.
Current mode: ${mode.toUpperCase()} — ${modeInstructions[mode]}

Project: "${projectContext.name}" (${projectContext.language}/${projectContext.framework})
${projectContext.description ? `Description: ${projectContext.description}` : ""}
${workingDirNote}${langNote}${editorContextNote}

CRITICAL — Shell command rules:
- Each shell command runs in isolation. NO persistent working directory between commands.
- Always use FULL paths from project root: "cd ${projectContext.workingDir || "."} && npm install"
- NEVER use ".." paths. Always use full paths from project root.
- Use the directory tree below to see the EXACT structure.

Directory tree:
${dirTree}

Current files (up to ${maxFiles}, truncated at ${maxChars} chars each):
${fileList || "No files yet"}

${historyText ? `Recent conversation:\n${historyText}` : ""}
${shellResultsText}

══════════════════════════════════════════════════════
MANDATORY: THINK BEFORE ACTING
Start your response with a <thinking> block:

<thinking>
UNDERSTAND: What is the user actually asking for? What is the goal?
CODEBASE: What files are involved? What is the current state of the relevant code?
APPROACH: What is the best way to implement this? What are the tradeoffs?
RISKS: What could break? What side effects might occur?
${mode === "max" ? "COMPLETENESS: Am I implementing the FULL solution or just a partial one? What am I missing?" : ""}
${mode === "test" ? "TEST STRATEGY: What test framework is being used? What cases need coverage?" : ""}
${mode === "optimize" ? "OPTIMIZATION TARGETS: What are the biggest performance/quality wins?" : ""}
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
  "message": "Clear explanation of what I did and why.",
  "planSteps": ["step 1", "step 2"],
  "fileUpdates": [{"path": "full/path/from/root.ts", "content": "full file content"}],
  "shellCommands": ["cd ${projectContext.workingDir || "."} && npm test"],
  "done": false
}

Important: Set "done": true only when the task is TRULY complete (${mode === "max" ? "full feature working and tested" : mode === "test" ? "all tests passing" : mode === "optimize" ? "all optimizations applied" : "requested change implemented"}).`;

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

    const text = await callModel(modelName, parts);

    const thinkingMatch = text.match(/<thinking>([\s\S]*?)<\/thinking>/i);
    const reasoning = thinkingMatch ? thinkingMatch[1].trim() : undefined;

    const parsed = extractAgentAction(text);
    if (parsed) {
      return {
        ...parsed,
        message: stripThinkingTags(parsed.message || ""),
        reasoning,
        modelUsed: modelName,
      };
    }

    const cleanText = stripThinkingTags(text)
      .replace(/AGENT_ACTION:\s*```?(?:json)?\s*\{[\s\S]*?\}\s*```?/gi, "")
      .replace(/```json\s*\{[\s\S]*?"message"[\s\S]*?"done"[\s\S]*?\}\s*```/gi, "")
      .replace(/^\s*\{[\s\S]*?"message"[\s\S]*?"done"\s*:[\s\S]*?\}\s*$/gm, "")
      .trim();
    return { message: cleanText || stripThinkingTags(text), done: true, reasoning, modelUsed: modelName };
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
  const stripped = text.replace(/<thinking>[\s\S]*?<\/thinking>/gi, "").trim();

  const prefixMatch = stripped.match(/AGENT_ACTION:\s*(\{[\s\S]*\})/i);
  if (prefixMatch) {
    try { return JSON.parse(prefixMatch[1]); } catch (_) {}
  }

  const fenceMatch = stripped.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (fenceMatch) {
    try { return JSON.parse(fenceMatch[1]); } catch (_) {}
  }

  const objMatch = stripped.match(/^\s*(\{[\s\S]*\})\s*$/);
  if (objMatch) {
    try { return JSON.parse(objMatch[0]); } catch (_) {}
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

    const text = await callModel(MODELS.flash, [systemPrompt, `User: ${userMessage}`]);

    const fileUpdates: Array<{ path: string; content: string }> = [];
    const fileRegex = /===FILE: (.+?)===\n([\s\S]*?)===END===/g;
    let match;
    while ((match = fileRegex.exec(text)) !== null) {
      fileUpdates.push({ path: match[1].trim(), content: match[2].trim() });
    }

    let cleanMessage = text.replace(/===FILE: .+?===\n[\s\S]*?===END===/g, "").trim();
    cleanMessage = stripThinkingTags(cleanMessage);

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
