import React, { useState, useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import {
  Send, Loader2, Bot, Sparkles, Trash2, CheckCircle2,
  FileCode2, Zap, Paperclip, X, Image as ImageIcon, FileText,
  Brain, ChevronDown, ChevronUp, ShieldAlert, AlertTriangle,
  Play, Square, SkipForward, Info, Lightbulb,
  TrendingUp, Clock, Rocket, FlaskConical, Gauge, Cpu,
  RefreshCw, Settings, Copy, Check, Terminal, FileEdit,
  Timer,
  ToggleLeft, ToggleRight
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import type { AIMessage, BuildLog } from "@shared/schema";

type AgentMode = "lite" | "economy" | "power" | "agent" | "max" | "test" | "optimize";

type AgentState =
  | "idle"
  | "thinking"
  | "pending_approval"
  | "executing"
  | "checkpoint"
  | "done";

interface ThinkPlan {
  thinking: string;
  plan: string[];
  modelSelected?: string;
  modelLabel?: string;
  assessment: {
    confidence: "high" | "medium" | "low";
    canHandle: boolean;
    risks: string[];
    blockers: string[];
    recommendedMode: AgentMode | null;
    clarificationNeeded: string | null;
    estimatedComplexity: "simple" | "moderate" | "complex" | "very_complex";
  };
}

interface AutonomyCheckpoint {
  sessionId: string;
  iterationsDone: number;
  totalIterations: number;
  filesUpdated: number;
  preview: string;
  isMax?: boolean;
}

interface Attachment {
  name: string;
  type: string;
  data: string;
  preview?: string;
}

interface MessageActions {
  updatedPaths?: string[];
  shellCommandsRun?: string[];
  filesUpdated?: number;
}

const MODES: {
  id: AgentMode;
  label: string;
  shortDesc: string;
  fullDesc: string;
  color: string;
  bgColor: string;
  icon: React.ReactNode;
  iterations: number;
  model: string;
  twoPhase: boolean;
}[] = [
  {
    id: "lite",
    label: "Lite",
    shortDesc: "Quick edits",
    fullDesc: "Fast one-pass edit. Best for small, simple changes.",
    color: "text-sky-400",
    bgColor: "bg-sky-500/10 border-sky-500/30",
    icon: <Zap className="w-3 h-3" />,
    iterations: 1,
    model: "Flash",
    twoPhase: false,
  },
  {
    id: "economy",
    label: "Economy",
    shortDesc: "Minimal changes",
    fullDesc: "Minimal-touch fix. Touches as few files as possible.",
    color: "text-green-400",
    bgColor: "bg-green-500/10 border-green-500/30",
    icon: <Settings className="w-3 h-3" />,
    iterations: 1,
    model: "Flash",
    twoPhase: false,
  },
  {
    id: "power",
    label: "Power",
    shortDesc: "4 passes",
    fullDesc: "Recommended, high-power building experience.",
    color: "text-purple-400",
    bgColor: "bg-purple-500/10 border-purple-500/30",
    icon: <Cpu className="w-3 h-3" />,
    iterations: 4,
    model: "Flash / Pro",
    twoPhase: false,
  },
  {
    id: "agent",
    label: "Agent",
    shortDesc: "Human-in-loop",
    fullDesc: "Plans first, waits for your approval, then iterates with checkpoints.",
    color: "text-orange-400",
    bgColor: "bg-orange-500/10 border-orange-500/30",
    icon: <Brain className="w-3 h-3" />,
    iterations: 8,
    model: "Flash",
    twoPhase: true,
  },
  {
    id: "max",
    label: "Max",
    shortDesc: "Fully autonomous",
    fullDesc: "Long running, hands-off building experience.",
    color: "text-rose-400",
    bgColor: "bg-rose-500/10 border-rose-500/30",
    icon: <Rocket className="w-3 h-3" />,
    iterations: 20,
    model: "Pro",
    twoPhase: true,
  },
  {
    id: "test",
    label: "Test",
    shortDesc: "Write & run tests",
    fullDesc: "Writes comprehensive tests, runs them, and fixes failures.",
    color: "text-teal-400",
    bgColor: "bg-teal-500/10 border-teal-500/30",
    icon: <FlaskConical className="w-3 h-3" />,
    iterations: 6,
    model: "Flash Thinking",
    twoPhase: false,
  },
  {
    id: "optimize",
    label: "Optimize",
    shortDesc: "Performance & quality",
    fullDesc: "Deep code review followed by performance and quality improvements.",
    color: "text-amber-400",
    bgColor: "bg-amber-500/10 border-amber-500/30",
    icon: <Gauge className="w-3 h-3" />,
    iterations: 5,
    model: "Pro",
    twoPhase: false,
  },
];

const MODE_QUICK_ACTIONS: Record<AgentMode, { label: string; prompt: string }[]> = {
  lite: [
    { label: "Fix a typo or variable name", prompt: "Fix any obvious typos, naming issues, or minor code style problems" },
    { label: "Add a comment", prompt: "Add helpful comments and documentation to the main functions" },
  ],
  economy: [
    { label: "Fix one bug", prompt: "Find and fix the most critical bug in the codebase" },
    { label: "Add error handling", prompt: "Add basic error handling to the main function" },
  ],
  power: [
    { label: "Add a feature", prompt: "What feature would you like me to add?" },
    { label: "Refactor a component", prompt: "Refactor and improve the code structure for clarity and maintainability" },
    { label: "Fix all errors", prompt: "Find and fix any bugs, type errors, or issues in the code" },
  ],
  agent: [
    { label: "Build a full feature", prompt: "Describe a complete feature to build from scratch" },
    { label: "Debug a complex issue", prompt: "There's a bug that's hard to track down — analyze the codebase and fix it" },
  ],
  max: [
    { label: "Build the whole app", prompt: "Build the full application based on the project description" },
    { label: "Implement all missing features", prompt: "Analyze what's missing and implement all remaining features" },
  ],
  test: [
    { label: "Write unit tests", prompt: "Write comprehensive unit tests for all major functions and components" },
    { label: "Fix failing tests", prompt: "Run the test suite, find failing tests, and fix them" },
  ],
  optimize: [
    { label: "Performance audit", prompt: "Audit the codebase for performance bottlenecks and fix them" },
    { label: "Code quality review", prompt: "Review code quality: naming, structure, complexity, and best practices" },
  ],
};

const COMPLEXITY_COLORS = {
  simple: "text-green-500",
  moderate: "text-blue-500",
  complex: "text-orange-500",
  very_complex: "text-red-500",
};

const CONFIDENCE_CONFIG = {
  high: { color: "text-green-500", bg: "bg-green-500/10 border-green-500/20", label: "High confidence" },
  medium: { color: "text-yellow-500", bg: "bg-yellow-500/10 border-yellow-500/20", label: "Medium confidence" },
  low: { color: "text-red-500", bg: "bg-red-500/10 border-red-500/20", label: "Low confidence" },
};

function CodeBlock({ content }: { content: string }) {
  const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
  const parts: Array<{ type: "text" | "code"; content: string; lang?: string }> = [];
  let lastIndex = 0;
  let match;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: "text", content: content.slice(lastIndex, match.index) });
    }
    parts.push({ type: "code", lang: match[1], content: match[2] });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < content.length) {
    parts.push({ type: "text", content: content.slice(lastIndex) });
  }

  if (parts.length === 0) return <p style={{ whiteSpace: "pre-wrap" }}>{content}</p>;

  return (
    <div className="space-y-2">
      {parts.map((part, i) =>
        part.type === "code" ? (
          <div key={i} className="rounded-md overflow-hidden border border-border/50">
            {part.lang && (
              <div className="flex items-center gap-1.5 px-3 py-1 bg-muted/80 border-b border-border/50">
                <FileCode2 className="w-3 h-3 text-muted-foreground" />
                <span className="text-[10px] font-mono text-muted-foreground">{part.lang}</span>
              </div>
            )}
            <pre className="p-3 bg-muted/50 text-xs font-mono overflow-x-auto whitespace-pre-wrap break-words leading-relaxed">
              {part.content}
            </pre>
          </div>
        ) : (
          <p key={i} style={{ whiteSpace: "pre-wrap" }} className="text-xs leading-relaxed">{part.content}</p>
        )
      )}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (_) {}
  };
  return (
    <button
      onClick={handleCopy}
      className="p-0.5 rounded hover:bg-white/20 transition-colors opacity-0 group-hover:opacity-100"
      title="Copy message"
    >
      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
    </button>
  );
}

function ActionIndicator({ icon, iconColor, label }: { icon: React.ReactNode; iconColor: string; label: string }) {
  return (
    <div className="flex items-center gap-2 py-1">
      <div className={`w-5 h-5 rounded-full bg-muted/80 flex items-center justify-center shrink-0 ${iconColor}`}>
        {icon}
      </div>
      <span className="text-[11px] text-muted-foreground">{label}</span>
    </div>
  );
}

function ActionsSummaryBadge({ actions }: { actions: MessageActions }) {
  const totalActions = (actions.updatedPaths?.length || 0) + (actions.shellCommandsRun?.length || 0);
  if (totalActions === 0 && (!actions.filesUpdated || actions.filesUpdated === 0)) return null;

  const count = totalActions || actions.filesUpdated || 0;
  const hasFiles = (actions.updatedPaths?.length || 0) > 0 || (actions.filesUpdated || 0) > 0;
  const hasCommands = (actions.shellCommandsRun?.length || 0) > 0;

  return (
    <div className="flex items-center gap-1.5 py-1">
      <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
        {hasFiles && <FileEdit className="w-3 h-3 text-blue-400" />}
        {hasCommands && <Terminal className="w-3 h-3 text-green-400" />}
        {hasCommands && hasFiles && <RefreshCw className="w-3 h-3 text-orange-400" />}
        <span>{count} action{count !== 1 ? "s" : ""}</span>
      </div>
    </div>
  );
}

function InlineActions({ actions }: { actions: MessageActions }) {
  const hasFiles = actions.updatedPaths && actions.updatedPaths.length > 0;
  const hasCommands = actions.shellCommandsRun && actions.shellCommandsRun.length > 0;

  if (!hasFiles && !hasCommands) {
    if (actions.filesUpdated && actions.filesUpdated > 0) {
      return (
        <ActionIndicator
          icon={<FileEdit className="w-2.5 h-2.5" />}
          iconColor="text-blue-400"
          label={`Updated ${actions.filesUpdated} file${actions.filesUpdated !== 1 ? "s" : ""}`}
        />
      );
    }
    return null;
  }

  return (
    <div className="space-y-0">
      {actions.updatedPaths?.map((p, i) => (
        <ActionIndicator
          key={`f-${i}`}
          icon={<FileEdit className="w-2.5 h-2.5" />}
          iconColor="text-blue-400"
          label={`Edited ${p}`}
        />
      ))}
      {actions.shellCommandsRun?.map((c, i) => (
        <ActionIndicator
          key={`c-${i}`}
          icon={<Terminal className="w-2.5 h-2.5" />}
          iconColor="text-green-400"
          label={`Ran ${c}`}
        />
      ))}
    </div>
  );
}

function SessionStats({ messages, actionsMap, startTime }: {
  messages: AIMessage[];
  actionsMap: Record<string, MessageActions>;
  startTime: Date | null;
}) {
  const totalActions = Object.values(actionsMap).reduce((sum, a) => {
    return sum + (a.updatedPaths?.length || 0) + (a.shellCommandsRun?.length || 0) + (a.filesUpdated && !a.updatedPaths ? a.filesUpdated : 0);
  }, 0);

  const workedMinutes = startTime
    ? Math.max(1, Math.round((Date.now() - startTime.getTime()) / 60000))
    : null;

  if (messages.length === 0) return null;

  const lastMsg = messages[messages.length - 1];
  const checkpointAge = lastMsg?.createdAt
    ? Math.max(1, Math.round((Date.now() - new Date(lastMsg.createdAt).getTime()) / 60000))
    : null;

  return (
    <div className="px-3 space-y-0.5 py-2">
      {checkpointAge && (
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <CheckCircle2 className="w-3 h-3 text-green-500" />
          <span>Checkpoint made {checkpointAge} minute{checkpointAge !== 1 ? "s" : ""} ago</span>
        </div>
      )}
      {workedMinutes && (
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <Timer className="w-3 h-3" />
          <span>Worked for {workedMinutes} minute{workedMinutes !== 1 ? "s" : ""}</span>
        </div>
      )}
    </div>
  );
}

function PlanCard({
  plan,
  mode,
  onApprove,
  onSwitchMode,
  onStop,
  awaitingApproval,
  isMax,
}: {
  plan: ThinkPlan;
  mode: AgentMode;
  onApprove?: () => void;
  onSwitchMode?: (m: AgentMode) => void;
  onStop?: () => void;
  awaitingApproval?: boolean;
  isMax?: boolean;
}) {
  const [expanded, setExpanded] = useState(true);
  const conf = CONFIDENCE_CONFIG[plan.assessment.confidence];
  const hasRisks = plan.assessment.risks.length > 0;
  const hasBlockers = plan.assessment.blockers.length > 0;

  return (
    <div className="rounded-xl border border-border/60 bg-card overflow-hidden text-xs" data-testid="card-plan">
      <div
        className="flex items-center gap-2 px-3 py-2 bg-muted/40 border-b border-border/40 cursor-pointer select-none"
        onClick={() => setExpanded(v => !v)}
      >
        <Brain className="w-3.5 h-3.5 text-primary shrink-0" />
        <span className="font-semibold text-[11px] flex-1">Agent's Plan</span>
        {plan.modelLabel && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted border border-border text-muted-foreground font-mono">
            {plan.modelLabel}
          </span>
        )}
        <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${conf.bg} ${conf.color}`}>
          {conf.label}
        </span>
        <span className={`text-[10px] ${COMPLEXITY_COLORS[plan.assessment.estimatedComplexity]}`}>
          {plan.assessment.estimatedComplexity}
        </span>
        {expanded ? <ChevronUp className="w-3 h-3 text-muted-foreground" /> : <ChevronDown className="w-3 h-3 text-muted-foreground" />}
      </div>

      {expanded && (
        <div className="p-3 space-y-3">
          <div className="text-muted-foreground leading-relaxed italic text-[11px] border-l-2 border-primary/30 pl-2.5">
            {plan.thinking}
          </div>

          <div className="space-y-1.5">
            {plan.plan.map((step, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="w-4 h-4 rounded-full bg-primary/15 text-primary text-[10px] flex items-center justify-center shrink-0 mt-0.5 font-semibold">
                  {i + 1}
                </span>
                <span className="text-foreground/90 leading-relaxed">{step}</span>
              </div>
            ))}
          </div>

          {hasRisks && (
            <div className="rounded-lg bg-yellow-500/5 border border-yellow-500/20 p-2 space-y-1">
              <div className="flex items-center gap-1.5 text-yellow-500 font-medium text-[10px]">
                <AlertTriangle className="w-3 h-3" /> Risks
              </div>
              {plan.assessment.risks.map((r, i) => (
                <div key={i} className="text-muted-foreground text-[11px] flex items-start gap-1.5">
                  <span className="shrink-0 mt-0.5">•</span>{r}
                </div>
              ))}
            </div>
          )}

          {hasBlockers && (
            <div className="rounded-lg bg-red-500/5 border border-red-500/20 p-2 space-y-1">
              <div className="flex items-center gap-1.5 text-red-500 font-medium text-[10px]">
                <ShieldAlert className="w-3 h-3" /> Blockers
              </div>
              {plan.assessment.blockers.map((b, i) => (
                <div key={i} className="text-muted-foreground text-[11px] flex items-start gap-1.5">
                  <span className="shrink-0 mt-0.5">•</span>{b}
                </div>
              ))}
            </div>
          )}

          {plan.assessment.recommendedMode && plan.assessment.recommendedMode !== mode && (
            <div className="rounded-lg bg-blue-500/5 border border-blue-500/20 p-2 flex items-center gap-2">
              <Lightbulb className="w-3.5 h-3.5 text-blue-400 shrink-0" />
              <div className="flex-1 text-[11px] text-blue-400">
                Switch to <strong>{plan.assessment.recommendedMode}</strong> mode
              </div>
              {onSwitchMode && (
                <button
                  className="text-[10px] text-blue-400 border border-blue-400/40 rounded px-1.5 py-0.5 hover:bg-blue-400/10 transition-colors shrink-0"
                  onClick={() => onSwitchMode(plan.assessment.recommendedMode!)}
                  data-testid="button-switch-mode"
                >
                  Switch
                </button>
              )}
            </div>
          )}

          {plan.assessment.clarificationNeeded && (
            <div className="rounded-lg bg-muted/60 border border-border p-2 flex items-start gap-2">
              <Info className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
              <div className="text-[11px] text-muted-foreground">{plan.assessment.clarificationNeeded}</div>
            </div>
          )}

          {awaitingApproval && onApprove && (
            <div className="flex gap-2 pt-1">
              <Button
                size="sm"
                className={`flex-1 h-7 text-xs gap-1.5 ${isMax ? "bg-rose-500 hover:bg-rose-600" : ""}`}
                onClick={onApprove}
                data-testid="button-approve-plan"
              >
                {isMax ? <Rocket className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                {isMax ? "Start Max Build" : "Start Execution"}
              </Button>
              {onStop && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs px-3"
                  onClick={onStop}
                  data-testid="button-cancel-plan"
                >
                  Cancel
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CheckpointCard({
  checkpoint,
  onContinue,
  onStop,
  isPending,
}: {
  checkpoint: AutonomyCheckpoint;
  onContinue: () => void;
  onStop: () => void;
  isPending: boolean;
}) {
  const progress = Math.round((checkpoint.iterationsDone / checkpoint.totalIterations) * 100);

  return (
    <div className="rounded-xl border border-orange-500/30 bg-orange-500/5 overflow-hidden text-xs" data-testid="card-checkpoint">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-orange-500/20">
        <Clock className="w-3.5 h-3.5 text-orange-400 shrink-0" />
        <span className="font-semibold text-[11px] text-orange-400 flex-1">Checkpoint</span>
        <span className="text-[10px] text-orange-400/70">{checkpoint.iterationsDone}/{checkpoint.totalIterations}</span>
      </div>
      <div className="p-3 space-y-2.5">
        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full bg-orange-500 transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>

        {checkpoint.preview && (
          <p className="text-muted-foreground text-[11px] leading-relaxed line-clamp-3">{checkpoint.preview}</p>
        )}

        <div className="text-[10px] text-orange-400/70 flex items-center gap-1">
          <TrendingUp className="w-3 h-3" />
          {checkpoint.filesUpdated} file{checkpoint.filesUpdated !== 1 ? "s" : ""} updated
        </div>

        <div className="flex gap-2">
          <Button
            size="sm"
            className="flex-1 h-7 text-xs gap-1.5 bg-orange-500 hover:bg-orange-600"
            onClick={onContinue}
            disabled={isPending}
            data-testid="button-continue-execution"
          >
            {isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <SkipForward className="w-3 h-3" />}
            Continue
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs px-3 border-orange-500/30 text-orange-400 hover:bg-orange-500/10"
            onClick={onStop}
            disabled={isPending}
            data-testid="button-stop-execution"
          >
            <Square className="w-3 h-3 mr-1" /> Stop
          </Button>
        </div>
      </div>
    </div>
  );
}

function MaxProgressCard({
  checkpoint,
  onStop,
  isPending,
}: {
  checkpoint: AutonomyCheckpoint;
  onStop: () => void;
  isPending: boolean;
}) {
  const progress = Math.round((checkpoint.iterationsDone / checkpoint.totalIterations) * 100);

  return (
    <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 overflow-hidden text-xs" data-testid="card-max-progress">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-rose-500/20">
        <Rocket className="w-3.5 h-3.5 text-rose-400 shrink-0 animate-pulse" />
        <span className="font-semibold text-[11px] text-rose-400 flex-1">Max mode running</span>
        <span className="text-[10px] text-rose-400/70">{checkpoint.iterationsDone}/{checkpoint.totalIterations}</span>
      </div>
      <div className="p-3 space-y-2.5">
        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-rose-500 to-rose-400 transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>

        <div className="flex items-center gap-1.5 text-[11px] text-rose-400/70">
          <RefreshCw className="w-3 h-3 animate-spin" />
          Autonomously building...
        </div>

        {checkpoint.preview && (
          <p className="text-muted-foreground text-[11px] leading-relaxed line-clamp-2">{checkpoint.preview}</p>
        )}

        <div className="text-[10px] text-rose-400/70 flex items-center gap-1">
          <TrendingUp className="w-3 h-3" />
          {checkpoint.filesUpdated} file{checkpoint.filesUpdated !== 1 ? "s" : ""} updated
        </div>

        <Button
          size="sm"
          variant="outline"
          className="w-full h-7 text-xs border-rose-500/30 text-rose-400 hover:bg-rose-500/10"
          onClick={onStop}
          disabled={isPending}
          data-testid="button-stop-max"
        >
          <Square className="w-3 h-3 mr-1" /> Stop Max Build
        </Button>
      </div>
    </div>
  );
}

function ReasoningBubble({ reasoning }: { reasoning: string }) {
  const [expanded, setExpanded] = useState(false);
  const lines = reasoning.split("\n").filter(l => l.trim());
  const preview = lines.slice(0, 2).join(" ").slice(0, 120);
  return (
    <div className="rounded-lg border border-primary/20 bg-primary/5 overflow-hidden text-xs" data-testid="reasoning-bubble">
      <button
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-primary/10 transition-colors"
        onClick={() => setExpanded(v => !v)}
      >
        <Brain className="w-3 h-3 text-primary shrink-0 animate-pulse" />
        <span className="text-primary/80 font-medium text-[11px] flex-1">Agent reasoning</span>
        {expanded ? <ChevronUp className="w-3 h-3 text-primary/60" /> : <ChevronDown className="w-3 h-3 text-primary/60" />}
      </button>
      {expanded ? (
        <div className="px-3 pb-3 space-y-1 border-t border-primary/10">
          {lines.map((line, i) => (
            <p key={i} className="text-[11px] text-muted-foreground leading-relaxed">{line}</p>
          ))}
        </div>
      ) : (
        <div className="px-3 pb-2">
          <p className="text-[11px] text-muted-foreground/70 italic leading-relaxed">{preview}{preview.length < reasoning.length ? "..." : ""}</p>
        </div>
      )}
    </div>
  );
}

interface ShellOutputData {
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface FileDiffData {
  path: string;
  oldContent: string | null;
  newContent: string;
  isNew: boolean;
}

interface ActionLog {
  type: "thinking" | "edit" | "shell" | "error" | "fix" | "complete" | "checkpoint";
  path?: string;
  command?: string;
  message?: string;
  filesUpdated?: number;
  stderr?: string;
}

function ActionLogItem({ action }: { action: ActionLog }) {
  const configs: Record<string, { icon: React.ReactNode; color: string; bg: string; label: string }> = {
    thinking: {
      icon: <Brain className="w-3 h-3 animate-pulse" />,
      color: "text-primary",
      bg: "bg-primary/10",
      label: action.message || "Analyzing...",
    },
    edit: {
      icon: <FileEdit className="w-3 h-3" />,
      color: "text-blue-400",
      bg: "bg-blue-500/10",
      label: `Edited ${action.path || "file"}`,
    },
    shell: {
      icon: <Terminal className="w-3 h-3" />,
      color: "text-green-400",
      bg: "bg-green-500/10",
      label: `Ran ${action.command || "command"}`,
    },
    error: {
      icon: <AlertTriangle className="w-3 h-3" />,
      color: "text-red-400",
      bg: "bg-red-500/10",
      label: action.message || "Error detected",
    },
    fix: {
      icon: <RefreshCw className="w-3 h-3 animate-spin" />,
      color: "text-orange-400",
      bg: "bg-orange-500/10",
      label: action.message || "Fixing...",
    },
    complete: {
      icon: <CheckCircle2 className="w-3 h-3" />,
      color: "text-green-500",
      bg: "bg-green-500/10",
      label: action.message || `Done — ${action.filesUpdated || 0} files updated`,
    },
    checkpoint: {
      icon: <CheckCircle2 className="w-3 h-3" />,
      color: "text-green-500",
      bg: "bg-green-500/10",
      label: action.message || "Checkpoint created",
    },
  };

  const c = configs[action.type] || configs.thinking;

  return (
    <div className="flex items-center gap-2 py-1">
      <div className={`w-5 h-5 rounded-full ${c.bg} flex items-center justify-center shrink-0 ${c.color}`}>
        {c.icon}
      </div>
      <span className={`text-[11px] ${c.color === "text-red-400" ? "text-red-400" : "text-muted-foreground"}`}>
        {c.label}
      </span>
    </div>
  );
}

function ShellOutputBlock({ data, projectId }: { data: ShellOutputData; projectId: string }) {
  const [explaining, setExplaining] = useState(false);
  const [explanation, setExplanation] = useState<string | null>(null);
  const isFailed = data.exitCode !== 0;
  const output = `${data.stdout}${data.stderr ? (data.stdout ? "\n" : "") + data.stderr : ""}`.trim();

  const handleExplainError = async () => {
    setExplaining(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/messages/explain-error`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: data.command, stderr: data.stderr, exitCode: data.exitCode }),
      });
      const result = await res.json();
      if (result.assistant) {
        setExplanation(result.assistant.content);
        queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "messages"] });
      }
    } catch (_) {}
    setExplaining(false);
  };

  return (
    <div className={`rounded-lg border text-xs overflow-hidden ${isFailed ? "border-red-500/30 bg-red-500/5" : "border-border/40 bg-muted/30"}`}>
      <div className={`flex items-center gap-1.5 px-2.5 py-1.5 border-b ${isFailed ? "border-red-500/20 bg-red-500/10" : "border-border/30 bg-muted/50"}`}>
        <Terminal className={`w-3 h-3 ${isFailed ? "text-red-400" : "text-green-400"}`} />
        <span className="font-mono text-[11px] text-muted-foreground flex-1 truncate">$ {data.command}</span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${isFailed ? "bg-red-500/20 text-red-400" : "bg-green-500/20 text-green-400"}`}>
          exit {data.exitCode}
        </span>
      </div>
      {output && (
        <pre className="px-2.5 py-2 text-[11px] font-mono overflow-x-auto whitespace-pre-wrap break-words max-h-[200px] overflow-y-auto text-muted-foreground leading-relaxed">
          {output.slice(0, 2000)}{output.length > 2000 ? "\n..." : ""}
        </pre>
      )}
      {isFailed && !explanation && (
        <div className="px-2.5 py-1.5 border-t border-red-500/20">
          <button
            onClick={handleExplainError}
            disabled={explaining}
            className="flex items-center gap-1.5 text-[11px] text-red-400 hover:text-red-300 transition-colors disabled:opacity-50"
          >
            {explaining ? <Loader2 className="w-3 h-3 animate-spin" /> : <Lightbulb className="w-3 h-3" />}
            {explaining ? "Explaining..." : "Explain this error"}
          </button>
        </div>
      )}
      {explanation && (
        <div className="px-2.5 py-2 border-t border-red-500/20 bg-red-500/5">
          <div className="flex items-center gap-1.5 text-[11px] text-amber-400 font-medium mb-1">
            <Lightbulb className="w-3 h-3" /> Error Explanation
          </div>
          <div className="text-[11px] text-muted-foreground">
            <CodeBlock content={explanation} />
          </div>
        </div>
      )}
    </div>
  );
}

function FileDiffBlock({ data }: { data: FileDiffData }) {
  const [expanded, setExpanded] = useState(false);

  const computeSimpleDiff = () => {
    if (data.isNew || !data.oldContent) {
      const lines = data.newContent.split("\n").slice(0, 20);
      return { added: lines.length, removed: 0, preview: lines.map(l => `+ ${l}`) };
    }
    const oldLines = data.oldContent.split("\n");
    const newLines = data.newContent.split("\n");
    let added = 0, removed = 0;
    const preview: string[] = [];
    const maxLen = Math.max(oldLines.length, newLines.length);
    for (let i = 0; i < Math.min(maxLen, 30); i++) {
      const ol = oldLines[i];
      const nl = newLines[i];
      if (ol === undefined && nl !== undefined) { added++; preview.push(`+ ${nl}`); }
      else if (nl === undefined && ol !== undefined) { removed++; preview.push(`- ${ol}`); }
      else if (ol !== nl) { removed++; added++; preview.push(`- ${ol}`); preview.push(`+ ${nl}`); }
    }
    return { added, removed, preview: preview.slice(0, 20) };
  };

  const diff = computeSimpleDiff();

  return (
    <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 text-xs overflow-hidden">
      <button
        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-blue-500/10 transition-colors"
        onClick={() => setExpanded(v => !v)}
      >
        <FileEdit className="w-3 h-3 text-blue-400 shrink-0" />
        <span className="font-mono text-[11px] text-blue-400 flex-1 truncate">{data.path}</span>
        {data.isNew && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/20 text-green-400">new</span>}
        {diff.added > 0 && <span className="text-[10px] text-green-400">+{diff.added}</span>}
        {diff.removed > 0 && <span className="text-[10px] text-red-400">-{diff.removed}</span>}
        {expanded ? <ChevronUp className="w-3 h-3 text-blue-400/60" /> : <ChevronDown className="w-3 h-3 text-blue-400/60" />}
      </button>
      {expanded && diff.preview.length > 0 && (
        <pre className="px-2.5 py-2 text-[11px] font-mono overflow-x-auto whitespace-pre-wrap break-words max-h-[200px] overflow-y-auto leading-relaxed border-t border-blue-500/20">
          {diff.preview.map((line, i) => (
            <div key={i} className={line.startsWith("+") ? "text-green-400" : line.startsWith("-") ? "text-red-400" : "text-muted-foreground"}>
              {line}
            </div>
          ))}
        </pre>
      )}
    </div>
  );
}

function AgentThinking({ projectId, mode }: { projectId: string; mode: AgentMode }) {
  const { data: logs = [] } = useQuery<BuildLog[]>({
    queryKey: ["/api/projects", projectId, "logs"],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/logs`);
      return res.json();
    },
    refetchInterval: 600,
  });

  const actionLogs: ActionLog[] = [];
  for (const log of logs) {
    if (log.stage === "agent" && log.message.startsWith("__ACTION__")) {
      try {
        const parsed = JSON.parse(log.message.replace("__ACTION__", ""));
        actionLogs.push(parsed);
      } catch (_) {}
    }
  }
  const recentActions = actionLogs.slice(-8);

  const thinkingLogs = logs.filter(l => l.stage === "agent" && l.message.startsWith("__THINKING__"));
  const latestReasoning = thinkingLogs.length > 0
    ? thinkingLogs[thinkingLogs.length - 1].message.replace("__THINKING__", "")
    : null;

  const modelLogs = logs.filter(l => l.stage === "agent" && l.message.startsWith("__MODEL__"));
  const latestModelLog = modelLogs.length > 0
    ? modelLogs[modelLogs.length - 1].message.replace("__MODEL__", "")
    : null;
  let modelLabel = "";
  try {
    if (latestModelLog) modelLabel = JSON.parse(latestModelLog).label;
  } catch (_) {}

  return (
    <div className="space-y-1">
      {modelLabel && (
        <div className="flex items-center gap-1.5 pl-1">
          <Cpu className="w-3 h-3 text-muted-foreground" />
          <span className="text-[10px] font-mono text-muted-foreground">{modelLabel}</span>
        </div>
      )}

      {recentActions.length > 0 ? (
        <div className="space-y-0">
          {recentActions.map((action, i) => (
            <ActionLogItem key={i} action={action} />
          ))}
        </div>
      ) : (
        <div className="flex items-center gap-2 py-1">
          <div className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <Brain className="w-3 h-3 animate-pulse text-primary" />
          </div>
          <span className="text-[11px] text-muted-foreground">Thinking...</span>
        </div>
      )}

      {latestReasoning && <ReasoningBubble reasoning={latestReasoning} />}
    </div>
  );
}

function ToggleSwitch({ enabled, onToggle, label, icon, disabled }: {
  enabled: boolean;
  onToggle: () => void;
  label: string;
  icon: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onToggle}
      disabled={disabled}
      className="flex items-center gap-2 w-full px-2.5 py-1.5 rounded-md hover:bg-muted/40 transition-colors disabled:opacity-40"
    >
      <span className="text-muted-foreground shrink-0">{icon}</span>
      <span className="text-[11px] text-foreground/80 flex-1 text-left">{label}</span>
      {enabled ? (
        <ToggleRight className="w-5 h-5 text-primary shrink-0" />
      ) : (
        <ToggleLeft className="w-5 h-5 text-muted-foreground shrink-0" />
      )}
    </button>
  );
}

import type { EditorContext } from "@/components/code-editor";

interface AgentPanelProps {
  projectId: string;
  editorContext?: EditorContext;
}

interface AIProviders {
  gemini: boolean;
  claude: boolean;
  models: Record<string, { provider: string; label: string }>;
}

const AgentPanel = forwardRef(function AgentPanel({ projectId, editorContext }: AgentPanelProps, ref: React.Ref<{ setInput: (text: string) => void }>) {
  const { toast } = useToast();
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<AgentMode>("power");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [actionsMap, setActionsMap] = useState<Record<string, MessageActions>>({});
  const [agentState, setAgentState] = useState<AgentState>("idle");
  const [currentPlan, setCurrentPlan] = useState<ThinkPlan | null>(null);
  const [pendingMessage, setPendingMessage] = useState<{ content: string; atts: Attachment[] } | null>(null);
  const [checkpoint, setCheckpoint] = useState<AutonomyCheckpoint | null>(null);
  const [pendingSessionId, setPendingSessionId] = useState<string | null>(null);
  const [isMaxMode, setIsMaxMode] = useState(false);
  const [testEnabled, setTestEnabled] = useState(false);
  const [optimizeEnabled, setOptimizeEnabled] = useState(false);
  const [sessionStartTime] = useState<Date>(new Date());
  const [streamingText, setStreamingText] = useState<string>("");
  const [streamActions, setStreamActions] = useState<Array<{ type: string; path?: string; command?: string; message?: string; stderr?: string }>>([]);
  const [streamShellOutputs, setStreamShellOutputs] = useState<ShellOutputData[]>([]);
  const [streamFileDiffs, setStreamFileDiffs] = useState<FileDiffData[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useImperativeHandle(ref, () => ({
    setInput: (text: string) => setInput(text),
  }), []);

  const effectiveMode: AgentMode = testEnabled ? "test" : optimizeEnabled ? "optimize" : mode;

  const providersQuery = useQuery<AIProviders>({
    queryKey: ["/api/ai/providers"],
    queryFn: async () => {
      const res = await fetch("/api/ai/providers");
      return res.json();
    },
    staleTime: 30_000,
  });
  const providers = providersQuery.data;
  const dynamicModelLabel = providers?.models?.[effectiveMode]?.label;
  const dynamicProvider = providers?.models?.[effectiveMode]?.provider;

  const messagesQuery = useQuery<AIMessage[]>({
    queryKey: ["/api/projects", projectId, "messages"],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/messages`);
      return res.json();
    },
  });

  const thinkMutation = useMutation({
    mutationFn: async ({ content, atts, modeToUse }: { content: string; atts: Attachment[]; modeToUse: AgentMode }) => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/messages`, {
        content,
        mode: modeToUse,
        phase: "think",
        attachments: atts.map(a => ({ type: a.type, data: a.data, name: a.name })),
        activeFile: editorContext?.activeFilePath || null,
        selection: editorContext?.selection || null,
        cursorLine: editorContext?.cursorLine || null,
      });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "messages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "logs"] });
      if (data.status === "pending_approval" && data.plan) {
        setCurrentPlan(data.plan);
        setPendingSessionId(data.sessionId);
        setIsMaxMode(!!data.isMax);
        setAgentState("pending_approval");
      }
    },
    onError: (err: Error) => {
      setAgentState("idle");
      toast({ title: "Think phase failed", description: err.message, variant: "destructive" });
    },
  });

  const sendStreaming = useCallback(async (content: string, atts: Attachment[], modeToUse: AgentMode) => {
    setIsStreaming(true);
    setStreamingText("");
    setStreamActions([]);
    setStreamShellOutputs([]);
    setStreamFileDiffs([]);
    setAgentState("thinking");

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(`/api/projects/${projectId}/messages/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content,
          mode: modeToUse,
          activeFile: editorContext?.activeFilePath || null,
          selection: editorContext?.selection || null,
          cursorLine: editorContext?.cursorLine || null,
        }),
        signal: controller.signal,
      });

      if (!res.ok) throw new Error("Stream request failed");
      if (!res.body) throw new Error("No response body");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        let currentEvent = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              if (currentEvent === "status") {
                if (data.phase === "thinking") setAgentState("thinking");
                else if (data.phase === "executing") setAgentState("executing");
              } else if (currentEvent === "text") {
                setStreamingText(data.content || "");
              } else if (currentEvent === "action") {
                setStreamActions(prev => [...prev, data]);
              } else if (currentEvent === "shell_output") {
                setStreamShellOutputs(prev => [...prev, data]);
              } else if (currentEvent === "file_diff") {
                setStreamFileDiffs(prev => [...prev, data]);
              } else if (currentEvent === "complete") {
                if (data.assistant) {
                  setActionsMap(prev => ({
                    ...prev,
                    [data.assistant.id]: {
                      updatedPaths: data.updatedPaths || [],
                      shellCommandsRun: data.shellCommandsRun || [],
                      filesUpdated: data.filesUpdated || 0,
                    },
                  }));
                }
                queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "messages"] });
                queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "files"] });
              } else if (currentEvent === "error") {
                toast({ title: "Agent error", description: data.message, variant: "destructive" });
              }
            } catch (_) {}
          }
        }
      }
    } catch (err: any) {
      if (err.name !== "AbortError") {
        toast({ title: "Stream failed", description: err.message, variant: "destructive" });
      }
    } finally {
      setIsStreaming(false);
      setStreamingText("");
      setStreamActions([]);
      setStreamShellOutputs([]);
      setStreamFileDiffs([]);
      setAgentState("idle");
      setCurrentPlan(null);
      setPendingMessage(null);
      abortRef.current = null;
    }
  }, [projectId, toast]);

  const sendMutation = useMutation({
    mutationFn: async ({ content, atts, modeToUse }: { content: string; atts: Attachment[]; modeToUse: AgentMode }) => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/messages`, {
        content,
        mode: modeToUse,
        attachments: atts.map(a => ({ type: a.type, data: a.data, name: a.name })),
        activeFile: editorContext?.activeFilePath || null,
        selection: editorContext?.selection || null,
        cursorLine: editorContext?.cursorLine || null,
      });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "messages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "files"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "logs"] });
      if (data.assistant) {
        setActionsMap(prev => ({
          ...prev,
          [data.assistant.id]: {
            updatedPaths: data.updatedPaths || [],
            shellCommandsRun: data.shellCommandsRun || [],
            filesUpdated: data.filesUpdated || 0,
          },
        }));
      }
      if (data.plan) setCurrentPlan(data.plan);
      setAgentState("idle");
      setCurrentPlan(null);
      setPendingMessage(null);
    },
    onError: (err: Error) => {
      setAgentState("idle");
      toast({ title: "Failed to send message", description: err.message, variant: "destructive" });
    },
  });

  const continueMutation = useMutation({
    mutationFn: async ({ sessionId, action }: { sessionId: string; action: "execute" | "continue" | "stop" }) => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/messages/continue`, { sessionId, action });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "messages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "files"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "logs"] });

      if (data.status === "checkpoint") {
        const cp = {
          sessionId: data.sessionId,
          iterationsDone: data.iterationsDone,
          totalIterations: data.totalIterations,
          filesUpdated: data.filesUpdated,
          preview: data.preview,
          isMax: data.isMax,
        };
        setCheckpoint(cp);

        if (data.isMax) {
          setAgentState("executing");
          setTimeout(() => {
            continueMutation.mutate({ sessionId: data.sessionId, action: "continue" });
          }, 500);
        } else {
          setAgentState("checkpoint");
        }
      } else if (data.status === "done" || data.status === "stopped") {
        if (data.assistant) {
          setActionsMap(prev => ({
            ...prev,
            [data.assistant.id]: {
              updatedPaths: data.updatedPaths || [],
              shellCommandsRun: data.shellCommandsRun || [],
              filesUpdated: data.filesUpdated ?? 0,
            },
          }));
        }
        setAgentState("idle");
        setCheckpoint(null);
        setCurrentPlan(null);
        setPendingMessage(null);
        setIsMaxMode(false);
      }
    },
    onError: (err: Error) => {
      setAgentState("idle");
      toast({ title: "Execution error", description: err.message, variant: "destructive" });
    },
  });

  const clearMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/projects/${projectId}/messages`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "messages"] });
      setActionsMap({});
      setAgentState("idle");
      setCurrentPlan(null);
      setCheckpoint(null);
      setPendingMessage(null);
      setPendingSessionId(null);
      setIsMaxMode(false);
    },
  });

  const handleSend = (text?: string) => {
    const trimmed = (text ?? input).trim();
    if ((!trimmed && attachments.length === 0) || agentState !== "idle") return;
    const toSend = trimmed || "Please look at the attached file.";
    const atts = [...attachments];
    setInput("");
    setAttachments([]);

    const modeInfo = MODES.find(m => m.id === effectiveMode)!;

    if (modeInfo.twoPhase) {
      setPendingMessage({ content: toSend, atts });
      setAgentState("thinking");
      thinkMutation.mutate({ content: toSend, atts, modeToUse: effectiveMode });
    } else {
      sendStreaming(toSend, atts, effectiveMode);
    }
  };

  const handleApprovePlan = () => {
    if (!pendingSessionId) return;
    setAgentState("executing");
    continueMutation.mutate({ sessionId: pendingSessionId, action: "execute" });
  };

  const handleCancelPlan = () => {
    setAgentState("idle");
    setCurrentPlan(null);
    setPendingMessage(null);
    setCheckpoint(null);
    setPendingSessionId(null);
    setIsMaxMode(false);
  };

  const handleStopMax = () => {
    if (checkpoint?.sessionId) {
      continueMutation.mutate({ sessionId: checkpoint.sessionId, action: "stop" });
    } else if (pendingSessionId) {
      setAgentState("idle");
      setCurrentPlan(null);
      setCheckpoint(null);
      setPendingSessionId(null);
      setIsMaxMode(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    for (const file of files) {
      if (file.size > 10 * 1024 * 1024) {
        toast({ title: "File too large", description: "Max 10MB per attachment", variant: "destructive" });
        continue;
      }
      const reader = new FileReader();
      reader.onload = (ev) => {
        const result = ev.target?.result as string;
        const base64 = result.split(",")[1];
        const att: Attachment = { name: file.name, type: file.type, data: base64 };
        if (file.type.startsWith("image/")) att.preview = result;
        setAttachments(prev => [...prev, att]);
      };
      reader.readAsDataURL(file);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  };

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messagesQuery.data, agentState, currentPlan, checkpoint]);

  const messages = messagesQuery.data || [];
  const currentModeInfo = MODES.find(m => m.id === effectiveMode)!;
  const isProcessing = agentState === "thinking" || agentState === "executing" || continueMutation.isPending;
  const quickActions = MODE_QUICK_ACTIONS[effectiveMode] || [];

  const getPlaceholder = () => {
    if (agentState === "pending_approval") {
      return isMaxMode ? "Review the plan, then click Start Max Build..." : "Review the plan above, then click Start Execution...";
    }
    if (agentState === "checkpoint") return "Click Continue to proceed or Stop to finish...";
    if (agentState === "executing" && isMaxMode) return "Max mode running autonomously...";
    const prompts: Record<AgentMode, string> = {
      lite: "Quick edit — describe a small change...",
      economy: "Minimal fix — describe the exact issue...",
      power: "Describe the feature or fix you need...",
      agent: "Describe the complex task to build...",
      max: "Describe the complete app or feature to build autonomously...",
      test: "What should I test? Or: run and fix all tests...",
      optimize: "What should I optimize? Or: full performance audit...",
    };
    return prompts[effectiveMode] || "Ask the agent to write code, fix errors, add features...";
  };

  const baseMode = mode === "test" || mode === "optimize" ? "power" : mode;

  return (
    <div className="h-full flex flex-col" data-testid="panel-agent">
      <div className="px-3 py-2 border-b flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <Sparkles className="w-3.5 h-3.5 text-primary" />
          <span className="text-sm font-semibold">AI Agent</span>
          <Badge variant="outline" className={`text-[10px] gap-1 border ${currentModeInfo.bgColor} ${currentModeInfo.color}`}>
            {currentModeInfo.icon}
            {dynamicModelLabel || currentModeInfo.model}
          </Badge>
        </div>
        <div className="flex items-center gap-1">
          {messages.length > 0 && agentState === "idle" && (
            <button
              className="p-1 rounded hover:bg-muted text-muted-foreground transition-colors"
              onClick={() => clearMutation.mutate()}
              data-testid="button-clear-messages"
              title="Clear conversation"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="px-3 py-1.5 border-b bg-muted/20 shrink-0">
        <Popover>
          <PopoverTrigger asChild>
            <button
              className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[11px] border transition-all ${currentModeInfo.bgColor} ${currentModeInfo.color} hover:opacity-90`}
              disabled={agentState !== "idle"}
              data-testid="button-mode-selector"
            >
              {currentModeInfo.icon}
              <span className="font-medium flex-1 text-left">{currentModeInfo.label}</span>
              <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 border-current/30 font-mono">
                {dynamicModelLabel || currentModeInfo.model}
              </Badge>
              <ChevronDown className="w-3 h-3 shrink-0" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-1.5" align="start" sideOffset={4}>
            <div className="space-y-0.5">
              <button
                className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-[11px] transition-all ${
                  effectiveMode === "lite"
                    ? "bg-sky-500/10 text-sky-400"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                }`}
                onClick={() => { setMode("lite"); setTestEnabled(false); setOptimizeEnabled(false); }}
                data-testid="button-mode-lite"
              >
                <Zap className="w-3 h-3 shrink-0" />
                <span className="font-medium flex-1 text-left">Lite</span>
                <span className="text-[10px] text-muted-foreground">Quick edits</span>
              </button>

              <div className="px-1 py-1">
                <div className="text-[10px] text-muted-foreground font-medium px-1.5 pb-1">Autonomous</div>
                <div className="space-y-0.5 pl-1">
                  {(["economy", "power"] as AgentMode[]).map(m => {
                    const info = MODES.find(mi => mi.id === m)!;
                    return (
                      <button
                        key={m}
                        className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-[11px] transition-all ${
                          baseMode === m || (m === "power" && baseMode === "agent")
                            ? `${info.bgColor} ${info.color}`
                            : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                        }`}
                        onClick={() => { setMode(m); setTestEnabled(false); setOptimizeEnabled(false); }}
                        data-testid={`button-mode-${m}`}
                      >
                        {info.icon}
                        <span className="font-medium flex-1 text-left">{info.label}</span>
                        <span className="text-[10px] text-muted-foreground">{info.shortDesc}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="border-t border-border/30 mt-1.5 pt-1 space-y-0">
                  <ToggleSwitch
                    enabled={testEnabled}
                    onToggle={() => { setTestEnabled(!testEnabled); if (!testEnabled) setOptimizeEnabled(false); }}
                    label="App testing"
                    icon={<FlaskConical className="w-3 h-3" />}
                    disabled={agentState !== "idle"}
                  />
                  <ToggleSwitch
                    enabled={optimizeEnabled}
                    onToggle={() => { setOptimizeEnabled(!optimizeEnabled); if (!optimizeEnabled) setTestEnabled(false); }}
                    label="Code optimizations"
                    icon={<Gauge className="w-3 h-3" />}
                    disabled={agentState !== "idle"}
                  />
                </div>
              </div>

              <button
                className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-[11px] transition-all ${
                  effectiveMode === "max"
                    ? "bg-rose-500/10 text-rose-400"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                }`}
                onClick={() => { setMode("max"); setTestEnabled(false); setOptimizeEnabled(false); }}
                data-testid="button-mode-max"
              >
                <Rocket className="w-3 h-3 shrink-0" />
                <span className="font-medium flex-1 text-left">Max</span>
                <span className="text-[10px] text-muted-foreground">Hands-off</span>
              </button>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        {messagesQuery.isLoading && (
          <div className="space-y-4 py-2">
            <div className="flex justify-end">
              <div className="space-y-1.5 w-[75%]">
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-2/3" />
              </div>
            </div>
            <div className="flex gap-2.5">
              <Skeleton className="w-6 h-6 rounded-full shrink-0" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-5/6" />
                <Skeleton className="h-3 w-3/4" />
              </div>
            </div>
            <div className="flex justify-end">
              <Skeleton className="h-3 w-1/2" />
            </div>
            <div className="flex gap-2.5">
              <Skeleton className="w-6 h-6 rounded-full shrink-0" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-4/5" />
              </div>
            </div>
          </div>
        )}
        {!messagesQuery.isLoading && messages.length === 0 && agentState === "idle" && (
          <div className="text-center py-3">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-2">
              {effectiveMode === "max" ? <Rocket className="w-5 h-5 text-rose-400" /> :
               effectiveMode === "test" ? <FlaskConical className="w-5 h-5 text-teal-400" /> :
               effectiveMode === "optimize" ? <Gauge className="w-5 h-5 text-amber-400" /> :
               <Bot className="w-5 h-5 text-primary" />}
            </div>
            <p className="text-sm font-semibold mb-1">SudoAI Agent</p>
            <p className={`text-[11px] mb-3 ${currentModeInfo.color}`}>
              {currentModeInfo.fullDesc}
            </p>
            <div className="flex flex-col gap-1.5">
              {quickActions.map(a => (
                <button
                  key={a.label}
                  className="text-xs px-3 py-1.5 rounded-lg border bg-card hover:bg-accent transition-colors text-left flex items-center gap-2"
                  onClick={() => handleSend(a.prompt)}
                  data-testid={`button-quick-action-${a.label.replace(/\s+/g, "-").toLowerCase()}`}
                >
                  <Sparkles className="w-3 h-3 text-primary shrink-0" />
                  {a.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className="space-y-0.5" data-testid={`message-${msg.id}`}>
            {msg.role === "user" && (
              <div className="flex justify-end">
                <div className="max-w-[88%] rounded-2xl px-3 py-2.5 text-xs group relative bg-primary text-primary-foreground rounded-tr-sm">
                  <div className="absolute -left-7 top-1">
                    <CopyButton text={msg.content} />
                  </div>
                  <p style={{ whiteSpace: "pre-wrap" }}>{msg.content}</p>
                </div>
              </div>
            )}

            {msg.role === "assistant" && actionsMap[msg.id] && (
              <ActionsSummaryBadge actions={actionsMap[msg.id]} />
            )}

            {msg.role === "assistant" && actionsMap[msg.id] && (
              <InlineActions actions={actionsMap[msg.id]} />
            )}

            {msg.role === "assistant" && (
              <div className="flex justify-start">
                <div className="max-w-[88%] rounded-2xl px-3 py-2.5 text-xs bg-muted rounded-tl-sm">
                  <CodeBlock content={msg.content} />
                </div>
              </div>
            )}
          </div>
        ))}

        {isStreaming && (
          <div className="flex gap-2.5">
            <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center shrink-0 mt-0.5">
              <Bot className="w-3.5 h-3.5 text-primary animate-pulse" />
            </div>
            <div className="flex-1 space-y-1.5">
              {streamActions.length > 0 && (
                <div className="space-y-1">
                  {streamActions.map((action, i) => (
                    <div key={i} className={`flex items-center gap-1.5 text-[11px] rounded px-2 py-1 ${
                      action.type === "edit" ? "bg-blue-500/10 text-blue-400" :
                      action.type === "shell" ? "bg-green-500/10 text-green-400" :
                      action.type === "error" ? "bg-red-500/10 text-red-400" :
                      action.type === "checkpoint" ? "bg-emerald-500/10 text-emerald-400" :
                      "bg-muted text-muted-foreground"
                    }`}>
                      {action.type === "edit" && <FileEdit className="w-3 h-3" />}
                      {action.type === "shell" && <Terminal className="w-3 h-3" />}
                      {action.type === "error" && <AlertTriangle className="w-3 h-3" />}
                      {action.type === "checkpoint" && <CheckCircle2 className="w-3 h-3" />}
                      <span className="truncate">
                        {action.type === "edit" && `Edited ${action.path}`}
                        {action.type === "shell" && `$ ${action.command}`}
                        {action.type === "error" && (action.message || "Error detected")}
                        {action.type === "checkpoint" && "Checkpoint saved"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {streamFileDiffs.length > 0 && (
                <div className="space-y-1">
                  {streamFileDiffs.map((diff, i) => (
                    <FileDiffBlock key={`diff-${i}`} data={diff} />
                  ))}
                </div>
              )}
              {streamShellOutputs.length > 0 && (
                <div className="space-y-1">
                  {streamShellOutputs.map((so, i) => (
                    <ShellOutputBlock key={`shell-${i}`} data={so} projectId={projectId} />
                  ))}
                </div>
              )}
              {streamingText ? (
                <div className="rounded-xl bg-muted px-3 py-2.5 text-xs text-foreground whitespace-pre-wrap">
                  {streamingText}
                  <span className="inline-block w-1.5 h-3.5 bg-primary/60 animate-pulse ml-0.5 -mb-0.5" />
                </div>
              ) : (
                <div className="rounded-xl bg-muted px-3 py-2.5 text-xs text-muted-foreground flex items-center gap-1.5">
                  <Loader2 className="w-3 h-3 animate-spin text-primary" />
                  {agentState === "thinking" ? "Analyzing..." : "Working..."}
                </div>
              )}
            </div>
          </div>
        )}

        {agentState === "thinking" && !isStreaming && !currentModeInfo.twoPhase && (
          <AgentThinking projectId={projectId} mode={effectiveMode} />
        )}

        {agentState === "thinking" && currentModeInfo.twoPhase && (
          <div className="flex gap-2.5">
            <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center shrink-0 mt-0.5">
              <Brain className="w-3.5 h-3.5 text-primary animate-pulse" />
            </div>
            <div className={`rounded-xl px-3 py-2.5 text-xs text-muted-foreground flex items-center gap-1.5 ${
              effectiveMode === "max" ? "bg-rose-500/10" : "bg-muted"
            }`}>
              <Loader2 className="w-3 h-3 animate-spin text-primary" />
              {effectiveMode === "max"
                ? "Analyzing with Pro model — building autonomous plan..."
                : "Analyzing your request and building a plan..."}
            </div>
          </div>
        )}

        {agentState === "pending_approval" && currentPlan && (
          <PlanCard
            plan={currentPlan}
            mode={effectiveMode}
            onApprove={handleApprovePlan}
            onSwitchMode={(m) => { setMode(m); }}
            onStop={handleCancelPlan}
            awaitingApproval
            isMax={isMaxMode}
          />
        )}

        {agentState === "executing" && (
          isMaxMode ? (
            checkpoint ? (
              <MaxProgressCard
                checkpoint={checkpoint}
                onStop={handleStopMax}
                isPending={continueMutation.isPending}
              />
            ) : (
              <AgentThinking projectId={projectId} mode={effectiveMode} />
            )
          ) : (
            <AgentThinking projectId={projectId} mode={effectiveMode} />
          )
        )}

        {agentState === "checkpoint" && checkpoint && !checkpoint.isMax && (
          <CheckpointCard
            checkpoint={checkpoint}
            onContinue={() => {
              setAgentState("executing");
              continueMutation.mutate({ sessionId: checkpoint.sessionId, action: "continue" });
            }}
            onStop={() => {
              continueMutation.mutate({ sessionId: checkpoint.sessionId, action: "stop" });
            }}
            isPending={continueMutation.isPending}
          />
        )}

        <div ref={bottomRef} />
      </div>

      {messages.length > 0 && (
        <SessionStats
          messages={messages}
          actionsMap={actionsMap}
          startTime={sessionStartTime}
        />
      )}

      <div className="p-3 border-t shrink-0 space-y-2">
        {editorContext?.activeFile && (
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground bg-muted/40 rounded px-2 py-1">
            <FileCode2 className="w-3 h-3 shrink-0" />
            <span className="truncate">{editorContext.activeFilePath || editorContext.activeFile}</span>
            {editorContext.cursorLine && (
              <span className="text-muted-foreground/60">line {editorContext.cursorLine}</span>
            )}
            {editorContext.selection && (
              <Badge variant="outline" className="text-[9px] px-1 py-0 h-3.5 shrink-0">
                selection
              </Badge>
            )}
          </div>
        )}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {attachments.map((att, i) => (
              <div key={i} className="flex items-center gap-1 bg-muted/80 rounded-md px-2 py-1 text-xs border border-border/50">
                {att.preview ? (
                  <img src={att.preview} alt={att.name} className="w-5 h-5 object-cover rounded" />
                ) : att.type.startsWith("image/") ? (
                  <ImageIcon className="w-3 h-3 text-blue-400 shrink-0" />
                ) : (
                  <FileText className="w-3 h-3 text-muted-foreground shrink-0" />
                )}
                <span className="max-w-[80px] truncate text-muted-foreground">{att.name}</span>
                <button onClick={() => removeAttachment(i)} data-testid={`button-remove-attachment-${i}`}>
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-2 items-end">
          <div className="flex-1 relative">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder={getPlaceholder()}
              disabled={agentState !== "idle"}
              className="resize-none text-xs min-h-[56px] max-h-[140px] pr-2"
              data-testid="input-agent-message"
            />
          </div>
          <div className="flex flex-col gap-1.5 shrink-0">
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              multiple
              accept="image/*,.txt,.md,.json,.csv,.pdf,.ts,.tsx,.js,.jsx,.py,.go,.rs,.html,.css"
              onChange={handleFileSelect}
              data-testid="input-file-attachment"
            />
            <button
              className="h-9 w-9 rounded-md border border-border flex items-center justify-center hover:bg-muted transition-colors text-muted-foreground disabled:opacity-40"
              onClick={() => fileInputRef.current?.click()}
              disabled={agentState !== "idle"}
              title="Attach image or file"
              data-testid="button-attach-file"
            >
              <Paperclip className="w-3.5 h-3.5" />
            </button>
            <Button
              size="icon"
              className={`h-9 w-9 ${effectiveMode === "max" ? "bg-rose-500 hover:bg-rose-600" : effectiveMode === "test" ? "bg-teal-600 hover:bg-teal-700" : effectiveMode === "optimize" ? "bg-amber-600 hover:bg-amber-700" : ""}`}
              onClick={() => handleSend()}
              disabled={(!input.trim() && attachments.length === 0) || agentState !== "idle"}
              data-testid="button-send-message"
            >
              {isProcessing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : effectiveMode === "max" ? (
                <Rocket className="w-3.5 h-3.5" />
              ) : effectiveMode === "test" ? (
                <FlaskConical className="w-3.5 h-3.5" />
              ) : effectiveMode === "optimize" ? (
                <Gauge className="w-3.5 h-3.5" />
              ) : (
                <Send className="w-3.5 h-3.5" />
              )}
            </Button>
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground">
          Enter to send · Shift+Enter newline
          {effectiveMode === "agent" && " · Plans first, then awaits your approval"}
          {effectiveMode === "max" && " · Fully autonomous — runs until done"}
          {effectiveMode === "test" && " · Writes and runs tests automatically"}
          {effectiveMode === "optimize" && " · Deep code analysis with Pro model"}
        </p>
      </div>
    </div>
  );
});

export default AgentPanel;
