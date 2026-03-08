import { useState, useRef } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Link, useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import type { Project } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  ArrowRight, Loader2, Clock, FolderGit2, Terminal, Code2,
  Globe, Server, Database, Github, Upload, ChevronDown, Sparkles, Zap,
  Cpu, Lock, Layers, Search, X
} from "lucide-react";
import { motion } from "framer-motion";
import { SiPython, SiGo, SiRust, SiNodedotjs, SiReact, SiVuedotjs, SiSvelte, SiDjango, SiFlask, SiNextdotjs, SiDocker } from "react-icons/si";
import { format } from "date-fns";

const EXAMPLES = [
  "Build a REST API with JWT authentication and user management",
  "Create a real-time chat app with WebSocket support",
  "Make a todo app with React frontend and Express backend",
  "Build a URL shortener with click analytics",
  "Create a file upload service with image resize",
  "Make a blog API with markdown and comments",
];

interface Template {
  icon: any;
  label: string;
  language: string;
  framework: string;
  color: string;
  desc: string;
  tags: string[];
  category: string;
  prompt: string;
}

const TEMPLATES: Template[] = [
  { icon: Server, label: "Express API", language: "typescript", framework: "express", color: "text-blue-400", desc: "REST API with TypeScript, Express, and middleware", tags: ["api", "rest", "ts"], category: "Backend", prompt: "Build a production-ready Express.js REST API with TypeScript, route handlers, middleware, CORS, and error handling" },
  { icon: SiNextdotjs, label: "Next.js App", language: "typescript", framework: "nextjs", color: "text-white", desc: "Full-stack React with App Router", tags: ["react", "fullstack", "ssr"], category: "Full Stack", prompt: "Create a Next.js 14 app with TypeScript, App Router, Tailwind CSS, and a clean landing page" },
  { icon: SiPython, label: "FastAPI", language: "python", framework: "fastapi", color: "text-yellow-400", desc: "Async Python API with auto-docs", tags: ["python", "api", "async"], category: "Backend", prompt: "Build a FastAPI application with Python, async endpoints, Pydantic models, and auto-generated Swagger docs" },
  { icon: SiGo, label: "Go / Gin", language: "go", framework: "gin", color: "text-cyan-400", desc: "High-performance Go web service", tags: ["go", "api", "fast"], category: "Backend", prompt: "Create a Go web service using Gin framework with REST routes, JSON responses, and middleware" },
  { icon: SiReact, label: "React SPA", language: "typescript", framework: "react", color: "text-sky-400", desc: "React + Vite + Tailwind + ShadCN", tags: ["react", "frontend", "spa"], category: "Frontend", prompt: "Build a React single-page app with TypeScript, Vite, Tailwind CSS, and shadcn/ui components" },
  { icon: SiVuedotjs, label: "Vue 3 App", language: "typescript", framework: "vue", color: "text-green-400", desc: "Vue 3 with Composition API", tags: ["vue", "frontend", "ts"], category: "Frontend", prompt: "Create a Vue 3 application with TypeScript, Composition API, Vue Router, and Tailwind CSS" },
  { icon: SiSvelte, label: "SvelteKit", language: "typescript", framework: "svelte", color: "text-orange-400", desc: "SvelteKit full-stack app", tags: ["svelte", "fullstack"], category: "Full Stack", prompt: "Build a SvelteKit application with TypeScript, server-side routes, form actions, and Tailwind CSS" },
  { icon: SiFlask, label: "Flask App", language: "python", framework: "flask", color: "text-gray-300", desc: "Python web app with Flask", tags: ["python", "web", "flask"], category: "Backend", prompt: "Create a Flask web application with Python, blueprints, Jinja2 templates, and SQLite database" },
  { icon: SiDjango, label: "Django", language: "python", framework: "django", color: "text-green-600", desc: "Full-featured Django web app", tags: ["python", "django", "orm"], category: "Full Stack", prompt: "Build a Django web application with Python, models, views, templates, admin panel, and SQLite" },
  { icon: Database, label: "Postgres API", language: "typescript", framework: "express", color: "text-blue-300", desc: "Express + PostgreSQL + Drizzle ORM", tags: ["db", "postgres", "api"], category: "Backend", prompt: "Build an Express API with TypeScript, PostgreSQL database, Drizzle ORM, and full CRUD endpoints" },
  { icon: SiNodedotjs, label: "Node Worker", language: "typescript", framework: "node", color: "text-lime-400", desc: "Background job processor", tags: ["jobs", "queue", "worker"], category: "Backend", prompt: "Create a Node.js background job worker with TypeScript, queue processing, and task scheduling" },
  { icon: Cpu, label: "AI Chatbot", language: "typescript", framework: "express", color: "text-purple-400", desc: "AI chatbot with OpenAI API", tags: ["ai", "chatbot", "openai"], category: "AI/ML", prompt: "Build an AI chatbot backend with Express, OpenAI API integration, conversation history, and streaming" },
  { icon: SiRust, label: "Rust Service", language: "rust", framework: "actix", color: "text-orange-500", desc: "Fast Rust web service with Actix", tags: ["rust", "performance", "actix"], category: "Backend", prompt: "Create a Rust web service using Actix-web with typed routes, JSON handling, and error types" },
  { icon: Lock, label: "Auth Service", language: "typescript", framework: "express", color: "text-yellow-300", desc: "JWT auth with refresh tokens", tags: ["auth", "jwt", "security"], category: "Backend", prompt: "Build a complete authentication service with Express, JWT tokens, refresh tokens, password hashing, and user management" },
  { icon: Globe, label: "Static Site", language: "html", framework: "vanilla", color: "text-pink-400", desc: "HTML · CSS · Vanilla JS", tags: ["html", "css", "js"], category: "Frontend", prompt: "Create a beautiful static website with HTML, modern CSS, and vanilla JavaScript — no frameworks" },
  { icon: Layers, label: "Monorepo", language: "typescript", framework: "turborepo", color: "text-indigo-400", desc: "Full-stack monorepo with pnpm", tags: ["monorepo", "fullstack", "turbo"], category: "Full Stack", prompt: "Set up a TypeScript monorepo with pnpm workspaces, shared packages, and separate frontend and backend apps" },
];

const STATUS_COLOR: Record<string, string> = {
  deployed: "bg-green-500",
  running: "bg-blue-500",
  building: "bg-yellow-500",
  idle: "bg-muted-foreground",
};

export default function Home() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [prompt, setPrompt] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [importMode, setImportMode] = useState<"github" | "zip">("github");
  const [githubUrl, setGithubUrl] = useState("");
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: projects } = useQuery<Project[]>({ queryKey: ["/api/projects"] });

  const createMutation = useMutation({
    mutationFn: async (data: { prompt: string; language: string; framework: string }) => {
      const name = generateName(data.prompt);
      const res = await apiRequest("POST", "/api/projects", {
        name,
        description: data.prompt.substring(0, 200),
        prompt: data.prompt,
        language: data.language,
        framework: data.framework,
        status: "idle",
        buildStatus: "none",
      });
      return res.json();
    },
    onSuccess: (project) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      navigate(`/workspace/${project.id}`);
    },
    onError: (err: Error) => {
      toast({ title: "Failed to create project", description: err.message, variant: "destructive" });
    },
  });

  const [showAllTemplates, setShowAllTemplates] = useState(false);
  const [templateSearch, setTemplateSearch] = useState("");
  const [templateCategory, setTemplateCategory] = useState<string>("All");

  const handleCreate = (tmpl?: Template) => {
    const p = prompt.trim();
    if (!p && !tmpl) return;
    const template = tmpl || TEMPLATES[0];
    createMutation.mutate({ prompt: p || template.prompt, language: template.language, framework: template.framework });
  };

  const handleTemplateClick = (tmpl: Template) => {
    if (prompt.trim()) {
      createMutation.mutate({ prompt: prompt.trim(), language: tmpl.language, framework: tmpl.framework });
    } else {
      createMutation.mutate({ prompt: tmpl.prompt, language: tmpl.language, framework: tmpl.framework });
    }
    setShowAllTemplates(false);
  };

  const templateCategories = ["All", ...Array.from(new Set(TEMPLATES.map(t => t.category)))];
  const filteredTemplates = TEMPLATES.filter(t => {
    const matchCat = templateCategory === "All" || t.category === templateCategory;
    const matchSearch = !templateSearch.trim() || t.label.toLowerCase().includes(templateSearch.toLowerCase()) || t.desc.toLowerCase().includes(templateSearch.toLowerCase()) || t.tags.some(tag => tag.includes(templateSearch.toLowerCase()));
    return matchCat && matchSearch;
  });

  const handleGitHubImport = async () => {
    if (!githubUrl.trim()) return;
    setIsImporting(true);
    try {
      const res = await apiRequest("POST", "/api/projects/import/github", { repoUrl: githubUrl.trim() });
      const data = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      setShowImport(false);
      if (data.project) {
        toast({ title: `Imported ${data.imported} files from GitHub` });
        navigate(`/workspace/${data.project.id}`);
      } else {
        toast({ title: "Import failed", description: data.error || "Unknown error", variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: "Import failed", description: err.message, variant: "destructive" });
    } finally {
      setIsImporting(false);
    }
  };

  const handleZipImport = async () => {
    if (!zipFile) return;
    setIsImporting(true);
    const formData = new FormData();
    formData.append("file", zipFile);
    formData.append("name", zipFile.name.replace(".zip", ""));
    try {
      const res = await fetch("/api/projects/import/zip", { method: "POST", body: formData });
      const data = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      setShowImport(false);
      if (data.project) {
        toast({ title: `Extracted ${data.imported} files from ZIP` });
        navigate(`/workspace/${data.project.id}`);
      } else {
        toast({ title: "Import failed", description: data.error || "Unknown error", variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: "Import failed", description: err.message, variant: "destructive" });
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="min-h-full bg-background flex flex-col">
      <div className="flex-1 flex flex-col items-center justify-center px-4 py-16">
        <motion.div initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-10">
          <div className="flex items-center justify-center gap-2 mb-5">
            <div className="w-11 h-11 rounded-2xl bg-primary flex items-center justify-center shadow-lg">
              <Terminal className="w-5 h-5 text-primary-foreground" />
            </div>
          </div>
          <h1 className="text-4xl font-bold tracking-tight mb-3" data-testid="text-home-title">
            What do you want to build?
          </h1>
          <p className="text-muted-foreground text-base max-w-md mx-auto">
            Describe your app and Gemini AI will design, generate, and run it instantly.
          </p>
        </motion.div>

        {/* Prompt Box */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="w-full max-w-2xl">
          <div className="relative rounded-xl border bg-card shadow-sm focus-within:ring-2 focus-within:ring-ring">
            <Textarea
              ref={textareaRef}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleCreate(); }}
              placeholder="e.g. Build a REST API with auth and user management..."
              className="resize-none border-0 focus-visible:ring-0 text-sm min-h-[100px] rounded-xl pr-14 bg-transparent"
              data-testid="input-project-prompt"
            />
            <div className="absolute bottom-3 right-3">
              <Button
                size="icon"
                onClick={() => handleCreate()}
                disabled={!prompt.trim() || createMutation.isPending}
                data-testid="button-create-from-prompt"
              >
                {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
              </Button>
            </div>
          </div>

          {/* Example prompts */}
          <div className="flex flex-wrap gap-2 mt-3">
            {EXAMPLES.slice(0, 3).map((ex) => (
              <button
                key={ex}
                className="text-xs px-3 py-1.5 rounded-full border bg-card hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
                onClick={() => { setPrompt(ex); textareaRef.current?.focus(); }}
                data-testid={`button-example-${ex.substring(0, 10).replace(/\s/g, "-")}`}
              >
                {ex}
              </button>
            ))}
          </div>
        </motion.div>

        {/* Templates */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="w-full max-w-2xl mt-8">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-4">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Start from a template</p>
              <Link href="/projects" className="text-xs font-medium text-primary hover:underline" data-testid="link-my-projects">
                My Projects
              </Link>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowAllTemplates(true)}
                className="flex items-center gap-1.5 text-xs text-primary hover:underline transition-colors"
                data-testid="button-browse-templates"
              >
                Browse all ({TEMPLATES.length})
              </button>
              <button
                onClick={() => setShowImport(true)}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors border rounded-md px-2.5 py-1 bg-card hover:bg-accent"
                data-testid="button-import-project"
              >
                <Upload className="w-3.5 h-3.5" />
                Import
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {TEMPLATES.slice(0, 8).map((tmpl) => (
              <button
                key={tmpl.label}
                className="p-4 rounded-xl border bg-card text-left transition-all hover-elevate hover:border-primary/40 group"
                onClick={() => handleTemplateClick(tmpl)}
                disabled={createMutation.isPending}
                data-testid={`button-template-${tmpl.label}`}
              >
                {createMutation.isPending ? (
                  <Loader2 className="w-5 h-5 mb-2 animate-spin text-muted-foreground" />
                ) : (
                  <tmpl.icon className={`w-5 h-5 mb-2 ${tmpl.color} group-hover:scale-110 transition-transform`} />
                )}
                <p className="text-sm font-semibold">{tmpl.label}</p>
                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{tmpl.desc}</p>
              </button>
            ))}
          </div>
        </motion.div>

        {/* Features strip */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }} className="flex flex-wrap items-center justify-center gap-4 mt-10 text-xs text-muted-foreground">
          {["Gemini AI code generation", "Real bash shell", "Live preview", "Git version control", "Secrets manager", "GitHub import"].map(f => (
            <span key={f} className="flex items-center gap-1.5">
              <Zap className="w-3 h-3 text-primary" />
              {f}
            </span>
          ))}
        </motion.div>
      </div>

      {/* Recent Projects */}
      {projects && projects.length > 0 && (
        <div className="border-t bg-card/30 px-4 py-6 shrink-0">
          <div className="max-w-2xl mx-auto">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
              <Clock className="w-3 h-3" /> Recent Projects
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              {projects.slice(0, 6).map((project) => (
                <button
                  key={project.id}
                  className="flex items-center gap-3 p-3 rounded-lg border bg-card text-left hover-elevate transition-all"
                  onClick={() => navigate(`/workspace/${project.id}`)}
                  data-testid={`button-recent-project-${project.id}`}
                >
                  <FolderGit2 className="w-4 h-4 text-primary shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{project.name}</p>
                    <div className="flex items-center gap-1 mt-0.5">
                      <Badge variant="outline" className="text-[10px] py-0">{project.language}</Badge>
                      <div className={`w-1.5 h-1.5 rounded-full ${STATUS_COLOR[project.status] || "bg-muted-foreground"}`} />
                    </div>
                  </div>
                  <ArrowRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* All Templates Browser */}
      <Dialog open={showAllTemplates} onOpenChange={setShowAllTemplates}>
        <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col" data-testid="dialog-all-templates">
          <DialogHeader className="shrink-0">
            <DialogTitle>Templates</DialogTitle>
            <DialogDescription>Pick a template to start your project instantly</DialogDescription>
          </DialogHeader>

          <div className="space-y-3 shrink-0">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Search templates..."
                value={templateSearch}
                onChange={e => setTemplateSearch(e.target.value)}
                className="pl-9"
                data-testid="input-template-search"
              />
            </div>
            <div className="flex gap-2 flex-wrap">
              {templateCategories.map(cat => (
                <button
                  key={cat}
                  className={`text-xs px-3 py-1 rounded-full border transition-colors ${templateCategory === cat ? "bg-primary text-primary-foreground border-primary" : "bg-card hover:bg-muted border-border"}`}
                  onClick={() => setTemplateCategory(cat)}
                  data-testid={`filter-cat-${cat}`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto min-h-0 mt-2 -mx-1 px-1">
            {filteredTemplates.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No templates found</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {filteredTemplates.map(tmpl => (
                  <button
                    key={tmpl.label}
                    className="p-4 rounded-xl border bg-card text-left hover:border-primary/50 hover:bg-muted/40 transition-all group flex gap-4 items-start"
                    onClick={() => handleTemplateClick(tmpl)}
                    disabled={createMutation.isPending}
                    data-testid={`button-template-all-${tmpl.label}`}
                  >
                    <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                      <tmpl.icon className={`w-5 h-5 ${tmpl.color}`} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold">{tmpl.label}</p>
                        <Badge variant="outline" className="text-[9px] px-1 py-0">{tmpl.category}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{tmpl.desc}</p>
                      <div className="flex gap-1 mt-1.5 flex-wrap">
                        {tmpl.tags.map(tag => (
                          <span key={tag} className="text-[10px] px-1.5 py-0 bg-muted rounded text-muted-foreground font-mono">{tag}</span>
                        ))}
                      </div>
                    </div>
                    {createMutation.isPending && <Loader2 className="w-4 h-4 animate-spin shrink-0 mt-1" />}
                  </button>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Import Dialog */}
      <Dialog open={showImport} onOpenChange={setShowImport}>
        <DialogContent className="sm:max-w-md" data-testid="dialog-import">
          <DialogHeader>
            <DialogTitle>Import Project</DialogTitle>
            <DialogDescription>Import from GitHub or upload a ZIP file</DialogDescription>
          </DialogHeader>

          <div className="flex rounded-lg border overflow-hidden mb-4">
            <button
              className={`flex-1 flex items-center justify-center gap-2 py-2 text-sm font-medium transition-colors ${importMode === "github" ? "bg-primary text-primary-foreground" : "hover:bg-muted text-muted-foreground"}`}
              onClick={() => setImportMode("github")}
              data-testid="tab-import-github"
            >
              <Github className="w-4 h-4" />
              GitHub
            </button>
            <button
              className={`flex-1 flex items-center justify-center gap-2 py-2 text-sm font-medium transition-colors ${importMode === "zip" ? "bg-primary text-primary-foreground" : "hover:bg-muted text-muted-foreground"}`}
              onClick={() => setImportMode("zip")}
              data-testid="tab-import-zip"
            >
              <Upload className="w-4 h-4" />
              ZIP File
            </button>
          </div>

          {importMode === "github" ? (
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">Repository URL</label>
                <Input
                  placeholder="https://github.com/username/repo"
                  value={githubUrl}
                  onChange={(e) => setGithubUrl(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleGitHubImport(); }}
                  data-testid="input-github-url"
                />
                <p className="text-[11px] text-muted-foreground mt-1">Public repositories only. Clones with depth 1.</p>
              </div>
              <Button
                className="w-full"
                onClick={handleGitHubImport}
                disabled={!githubUrl.trim() || isImporting}
                data-testid="button-confirm-github-import"
              >
                {isImporting ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Cloning...</> : <><Github className="w-4 h-4 mr-2" />Import from GitHub</>}
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <div
                className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 hover:bg-muted/30 transition-colors"
                onClick={() => fileInputRef.current?.click()}
                data-testid="dropzone-zip"
              >
                <Upload className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                {zipFile ? (
                  <p className="text-sm font-medium">{zipFile.name}</p>
                ) : (
                  <>
                    <p className="text-sm font-medium">Click to upload ZIP</p>
                    <p className="text-xs text-muted-foreground mt-1">Max 50MB</p>
                  </>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".zip"
                  className="hidden"
                  onChange={(e) => setZipFile(e.target.files?.[0] || null)}
                  data-testid="input-zip-file"
                />
              </div>
              <Button
                className="w-full"
                onClick={handleZipImport}
                disabled={!zipFile || isImporting}
                data-testid="button-confirm-zip-import"
              >
                {isImporting ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Extracting...</> : <><Upload className="w-4 h-4 mr-2" />Import ZIP</>}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function generateName(prompt: string): string {
  const words = prompt.toLowerCase().split(/\s+/).filter(w => w.length > 3 && !/^(with|that|and|the|for|from|into|using|build|make|create)$/.test(w)).slice(0, 3);
  if (words.length === 0) return `project-${Date.now().toString(36)}`;
  return words.join("-").replace(/[^a-z0-9-]/g, "").substring(0, 40) || `project-${Date.now().toString(36)}`;
}
