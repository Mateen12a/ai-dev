import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Send, Loader2, Bot, Sparkles, Trash2, CheckCircle2,
  FileCode2, Zap, Paperclip, X, Image as ImageIcon, FileText,
  Brain, ChevronDown, ChevronUp, ShieldAlert, AlertTriangle,
  Play, Square, SkipForward, Info, Lightbulb,
  TrendingUp, Clock
} from "lucide-react";
import type { AIMessage, BuildLog } from "@shared/schema";

type AgentMode = "fast" | "power" | "economy" | "autonomy";

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
}

interface Attachment {
  name: string;
  type: string;
  data: string;
  preview?: string;
}

const MODES: { id: AgentMode; label: string; desc: string; color: string; icon: string }[] = [
  { id: "fast", label: "Fast", desc: "1 pass · quick edits", color: "text-blue-500", icon: "⚡" },
  { id: "power", label: "Power", desc: "4 passes · thorough", color: "text-purple-500", icon: "💪" },
  { id: "economy", label: "Economy", desc: "Minimal changes", color: "text-green-500", icon: "🌿" },
  { id: "autonomy", label: "Auto", desc: "8 passes · human-in-loop", color: "text-orange-500", icon: "🤖" },
];

const QUICK_ACTIONS = [
  { label: "Explain the code", prompt: "Explain what this codebase does and how it works" },
  { label: "Fix all errors", prompt: "Find and fix any bugs or issues in the code" },
  { label: "Add a feature", prompt: "What feature would you like me to add?" },
  { label: "Write tests", prompt: "Write unit tests for this project" },
  { label: "Optimize code", prompt: "Review and optimize the code for performance and readability" },
  { label: "Add auth", prompt: "Add JWT authentication with login and register endpoints" },
];

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

function PlanCard({
  plan,
  mode,
  onApprove,
  onSwitchMode,
  onStop,
  awaitingApproval,
}: {
  plan: ThinkPlan;
  mode: AgentMode;
  onApprove?: () => void;
  onSwitchMode?: (m: AgentMode) => void;
  onStop?: () => void;
  awaitingApproval?: boolean;
}) {
  const [expanded, setExpanded] = useState(true);
  const conf = CONFIDENCE_CONFIG[plan.assessment.confidence];
  const hasRisks = plan.assessment.risks.length > 0;
  const hasBlockers = plan.assessment.blockers.length > 0;

  return (
    <div className="rounded-xl border border-border/60 bg-card overflow-hidden text-xs" data-testid="card-plan">
      {/* Header */}
      <div
        className="flex items-center gap-2 px-3 py-2 bg-muted/40 border-b border-border/40 cursor-pointer select-none"
        onClick={() => setExpanded(v => !v)}
      >
        <Brain className="w-3.5 h-3.5 text-primary shrink-0" />
        <span className="font-semibold text-[11px] flex-1">Agent's Plan</span>
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
          {/* Thinking */}
          <div className="text-muted-foreground leading-relaxed italic text-[11px] border-l-2 border-primary/30 pl-2.5">
            {plan.thinking}
          </div>

          {/* Plan steps */}
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

          {/* Risks */}
          {hasRisks && (
            <div className="rounded-lg bg-yellow-500/5 border border-yellow-500/20 p-2 space-y-1">
              <div className="flex items-center gap-1.5 text-yellow-500 font-medium text-[10px]">
                <AlertTriangle className="w-3 h-3" /> Risks to watch
              </div>
              {plan.assessment.risks.map((r, i) => (
                <div key={i} className="text-muted-foreground text-[11px] flex items-start gap-1.5">
                  <span className="shrink-0 mt-0.5">•</span>{r}
                </div>
              ))}
            </div>
          )}

          {/* Blockers */}
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

          {/* Mode recommendation */}
          {plan.assessment.recommendedMode && plan.assessment.recommendedMode !== mode && (
            <div className="rounded-lg bg-blue-500/5 border border-blue-500/20 p-2 flex items-center gap-2">
              <Lightbulb className="w-3.5 h-3.5 text-blue-400 shrink-0" />
              <div className="flex-1 text-[11px] text-blue-400">
                Switch to <strong>{plan.assessment.recommendedMode}</strong> mode for this task
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

          {/* Clarification */}
          {plan.assessment.clarificationNeeded && (
            <div className="rounded-lg bg-muted/60 border border-border p-2 flex items-start gap-2">
              <Info className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
              <div className="text-[11px] text-muted-foreground">{plan.assessment.clarificationNeeded}</div>
            </div>
          )}

          {/* Autonomy approval buttons */}
          {awaitingApproval && onApprove && (
            <div className="flex gap-2 pt-1">
              <Button
                size="sm"
                className="flex-1 h-7 text-xs gap-1.5"
                onClick={onApprove}
                data-testid="button-approve-plan"
              >
                <Play className="w-3 h-3" /> Start Execution
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
        <span className="text-[10px] text-orange-400/70">{checkpoint.iterationsDone}/{checkpoint.totalIterations} iterations</span>
      </div>
      <div className="p-3 space-y-2.5">
        {/* Progress bar */}
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
          {checkpoint.filesUpdated} file{checkpoint.filesUpdated !== 1 ? "s" : ""} updated in this batch
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
          <p className="text-[11px] text-muted-foreground/70 italic leading-relaxed">{preview}{preview.length < reasoning.length ? "…" : ""}</p>
        </div>
      )}
    </div>
  );
}

function AgentThinking({ projectId }: { projectId: string }) {
  const { data: logs = [] } = useQuery<BuildLog[]>({
    queryKey: ["/api/projects", projectId, "logs"],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/logs`);
      return res.json();
    },
    refetchInterval: 600,
  });

  const specialPrefixes = ["__PLAN__", "__CHECKPOINT__", "__RECOMMEND__", "__THINKING__"];
  const agentLogs = logs
    .filter(l => l.stage === "agent" && !specialPrefixes.some(p => l.message.startsWith(p)))
    .slice(-6);

  // Latest reasoning from the agent
  const thinkingLogs = logs.filter(l => l.stage === "agent" && l.message.startsWith("__THINKING__"));
  const latestReasoning = thinkingLogs.length > 0
    ? thinkingLogs[thinkingLogs.length - 1].message.replace("__THINKING__", "")
    : null;

  return (
    <div className="flex gap-2.5">
      <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center shrink-0 mt-0.5">
        <Bot className="w-3.5 h-3.5 text-primary" />
      </div>
      <div className="flex-1 space-y-2 max-w-[90%]">
        <div className="bg-muted rounded-xl px-3 py-2.5 min-w-[160px]">
          {agentLogs.length > 0 ? (
            <div className="space-y-1.5">
              {agentLogs.map((log, i) => (
                <div key={log.id ?? i} className="flex items-start gap-1.5 text-xs">
                  {i === agentLogs.length - 1 ? (
                    <Loader2 className="w-3 h-3 animate-spin text-primary shrink-0 mt-0.5" />
                  ) : (
                    <CheckCircle2 className="w-3 h-3 text-green-500 shrink-0 mt-0.5" />
                  )}
                  <span className={`${log.type === "error" ? "text-red-400" : log.message.startsWith("$") ? "text-yellow-400 font-mono" : "text-muted-foreground"} leading-relaxed`}>
                    {log.message.length > 80 ? log.message.slice(0, 80) + "…" : log.message}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Brain className="w-3 h-3 animate-pulse text-primary" />
              <span>Thinking…</span>
            </div>
          )}
        </div>
        {latestReasoning && <ReasoningBubble reasoning={latestReasoning} />}
      </div>
    </div>
  );
}

interface AgentPanelProps {
  projectId: string;
}

export default function AgentPanel({ projectId }: AgentPanelProps) {
  const { toast } = useToast();
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<AgentMode>("power");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [filesUpdatedMap, setFilesUpdatedMap] = useState<Record<string, number>>({});
  const [agentState, setAgentState] = useState<AgentState>("idle");
  const [currentPlan, setCurrentPlan] = useState<ThinkPlan | null>(null);
  const [pendingMessage, setPendingMessage] = useState<{ content: string; atts: Attachment[] } | null>(null);
  const [checkpoint, setCheckpoint] = useState<AutonomyCheckpoint | null>(null);
  const [pendingSessionId, setPendingSessionId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const messagesQuery = useQuery<AIMessage[]>({
    queryKey: ["/api/projects", projectId, "messages"],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/messages`);
      return res.json();
    },
  });

  // Think phase mutation (autonomy mode only)
  const thinkMutation = useMutation({
    mutationFn: async ({ content, atts }: { content: string; atts: Attachment[] }) => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/messages`, {
        content,
        mode: "autonomy",
        phase: "think",
        attachments: atts.map(a => ({ type: a.type, data: a.data, name: a.name })),
      });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "messages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "logs"] });
      if (data.status === "pending_approval" && data.plan) {
        setCurrentPlan(data.plan);
        setPendingSessionId(data.sessionId);
        setAgentState("pending_approval");
      }
    },
    onError: (err: Error) => {
      setAgentState("idle");
      toast({ title: "Think phase failed", description: err.message, variant: "destructive" });
    },
  });

  // Execute mutation (non-autonomy modes, or after approval)
  const sendMutation = useMutation({
    mutationFn: async ({ content, atts }: { content: string; atts: Attachment[] }) => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/messages`, {
        content,
        mode,
        attachments: atts.map(a => ({ type: a.type, data: a.data, name: a.name })),
      });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "messages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "files"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "logs"] });
      if (data.assistant && data.filesUpdated > 0) {
        setFilesUpdatedMap(prev => ({ ...prev, [data.assistant.id]: data.filesUpdated }));
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

  // Autonomy continue mutation
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
        setCheckpoint({
          sessionId: data.sessionId,
          iterationsDone: data.iterationsDone,
          totalIterations: data.totalIterations,
          filesUpdated: data.filesUpdated,
          preview: data.preview,
        });
        setAgentState("checkpoint");
      } else if (data.status === "done" || data.status === "stopped") {
        if (data.assistant) {
          setFilesUpdatedMap(prev => ({ ...prev, [data.assistant.id]: data.filesUpdated ?? 0 }));
        }
        setAgentState("idle");
        setCheckpoint(null);
        setCurrentPlan(null);
        setPendingMessage(null);
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
      setFilesUpdatedMap({});
      setAgentState("idle");
      setCurrentPlan(null);
      setCheckpoint(null);
      setPendingMessage(null);
      setPendingSessionId(null);
    },
  });

  const handleSend = (text?: string) => {
    const trimmed = (text ?? input).trim();
    if ((!trimmed && attachments.length === 0) || agentState !== "idle") return;
    const toSend = trimmed || "Please look at the attached file.";
    const atts = [...attachments];
    setInput("");
    setAttachments([]);

    if (mode === "autonomy") {
      // Two-phase: think first, then execute on approval
      setPendingMessage({ content: toSend, atts });
      setAgentState("thinking");
      thinkMutation.mutate({ content: toSend, atts });
    } else {
      setAgentState("thinking");
      sendMutation.mutate({ content: toSend, atts });
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
  const currentMode = MODES.find(m => m.id === mode)!;
  const isProcessing = agentState === "thinking" || agentState === "executing" || continueMutation.isPending;

  return (
    <div className="h-full flex flex-col" data-testid="panel-agent">
      {/* Header */}
      <div className="p-3 border-b flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold">AI Agent</span>
          <Badge variant="outline" className="text-[10px] gap-1">
            <Zap className="w-2.5 h-2.5" />
            Gemini 2.0 Flash
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

      {/* Mode selector */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b bg-muted/30 shrink-0">
        {MODES.map(m => (
          <button
            key={m.id}
            className={`flex-1 text-[10px] py-1 px-1 rounded transition-all font-medium ${
              mode === m.id
                ? `bg-background shadow-sm border border-border ${m.color}`
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => { if (agentState === "idle") setMode(m.id); }}
            disabled={agentState !== "idle"}
            data-testid={`button-mode-${m.id}`}
            title={m.desc}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Autonomy info strip */}
      {mode === "autonomy" && agentState === "idle" && (
        <div className="px-3 py-1.5 bg-orange-500/5 border-b border-orange-500/10 flex items-center gap-1.5">
          <Brain className="w-3 h-3 text-orange-400 shrink-0" />
          <p className="text-[10px] text-orange-400/80">Auto mode: thinks first, then asks for your approval before executing</p>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        {messages.length === 0 && agentState === "idle" && (
          <div className="text-center py-4">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3">
              <Bot className="w-5 h-5 text-primary" />
            </div>
            <p className="text-sm font-semibold mb-1">SudoAI Agent</p>
            <p className="text-xs text-muted-foreground mb-1 leading-relaxed max-w-[240px] mx-auto">
              I analyze, plan, and build — then keep you in control of every step.
            </p>
            <p className={`text-[10px] mb-4 ${currentMode.color}`}>
              {currentMode.icon} {currentMode.label} — {currentMode.desc}
            </p>
            <div className="flex flex-col gap-1.5">
              {QUICK_ACTIONS.map(a => (
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
          <div key={msg.id} className="space-y-1.5" data-testid={`message-${msg.id}`}>
            <div className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[88%] rounded-2xl px-3 py-2.5 text-xs ${
                msg.role === "assistant"
                  ? "bg-muted rounded-tl-sm"
                  : "bg-primary text-primary-foreground rounded-tr-sm"
              }`}>
                {msg.role === "assistant" ? (
                  <CodeBlock content={msg.content} />
                ) : (
                  <p style={{ whiteSpace: "pre-wrap" }}>{msg.content}</p>
                )}
              </div>
            </div>

            {msg.role === "assistant" && filesUpdatedMap[msg.id] > 0 && (
              <div className="flex items-center gap-1.5 mt-0.5">
                <div className="flex items-center gap-1 text-[10px] text-green-500 bg-green-500/10 border border-green-500/20 rounded-full px-2 py-0.5">
                  <CheckCircle2 className="w-2.5 h-2.5" />
                  <span>{filesUpdatedMap[msg.id]} file{filesUpdatedMap[msg.id] !== 1 ? "s" : ""} updated</span>
                </div>
              </div>
            )}
          </div>
        ))}

        {/* Thinking indicator (non-autonomy or autonomy execute phase) */}
        {(agentState === "thinking" && mode !== "autonomy") && (
          <AgentThinking projectId={projectId} />
        )}

        {/* Autonomy think phase — inline status */}
        {agentState === "thinking" && mode === "autonomy" && (
          <div className="flex gap-2.5">
            <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center shrink-0 mt-0.5">
              <Brain className="w-3.5 h-3.5 text-primary animate-pulse" />
            </div>
            <div className="bg-muted rounded-xl px-3 py-2.5 text-xs text-muted-foreground flex items-center gap-1.5">
              <Loader2 className="w-3 h-3 animate-spin text-primary" />
              Analyzing your request and building a plan…
            </div>
          </div>
        )}

        {/* Pending approval plan card */}
        {agentState === "pending_approval" && currentPlan && (
          <PlanCard
            plan={currentPlan}
            mode={mode}
            onApprove={handleApprovePlan}
            onSwitchMode={(m) => { setMode(m); }}
            onStop={handleCancelPlan}
            awaitingApproval
          />
        )}

        {/* Executing phase */}
        {agentState === "executing" && <AgentThinking projectId={projectId} />}

        {/* Checkpoint card */}
        {agentState === "checkpoint" && checkpoint && (
          <div className="space-y-2">
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
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div className="p-3 border-t shrink-0 space-y-2">
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
              placeholder={
                agentState === "pending_approval"
                  ? "Review the plan above, then click Start Execution…"
                  : agentState === "checkpoint"
                  ? "Click Continue to proceed or Stop to finish…"
                  : "Ask the agent to write code, fix errors, add features…"
              }
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
              className="h-9 w-9"
              onClick={() => handleSend()}
              disabled={(!input.trim() && attachments.length === 0) || agentState !== "idle"}
              data-testid="button-send-message"
            >
              {isProcessing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Send className="w-3.5 h-3.5" />
              )}
            </Button>
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground">
          Enter to send · Shift+Enter newline
          {mode === "autonomy" ? " · Auto mode: plans first, then awaits your approval" : ""}
        </p>
      </div>
    </div>
  );
}

