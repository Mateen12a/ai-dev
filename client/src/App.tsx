import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { useTheme } from "@/components/theme-provider";
import NotFound from "@/pages/not-found";
import Home from "@/pages/home";
import Workspace from "@/pages/workspace";
import Projects from "@/pages/projects";
import { Moon, Sun, Terminal } from "lucide-react";
import { Link } from "wouter";

function GlobalHeader() {
  const { theme, setTheme } = useTheme();
  const [location] = useLocation();
  if (location.startsWith("/workspace")) return null;

  return (
    <header className="h-12 flex items-center justify-between px-5 border-b bg-card/60 backdrop-blur shrink-0">
      <div className="flex items-center gap-6">
        <Link href="/" className="flex items-center gap-2.5 hover:opacity-80 transition-opacity">
          <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center shadow-sm">
            <Terminal className="w-3.5 h-3.5 text-primary-foreground" />
          </div>
          <span className="font-bold text-sm tracking-tight">SudoAI</span>
        </Link>
        <nav className="hidden sm:flex items-center gap-4 border-l pl-6 ml-0.5">
          <Link href="/projects" className={`text-sm font-medium transition-colors hover:text-primary ${location === "/projects" ? "text-primary" : "text-muted-foreground"}`} data-testid="link-nav-projects">
            Projects
          </Link>
        </nav>
      </div>
      <button
        className="p-2 rounded-md hover:bg-muted text-muted-foreground transition-colors"
        onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        data-testid="button-toggle-theme"
      >
        {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
      </button>
    </header>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/workspace/:id" component={Workspace} />
      <Route path="/projects" component={Projects} />
      <Route component={NotFound} />
    </Switch>
  );
}

function AppContent() {
  const [location] = useLocation();
  const isWorkspace = location.startsWith("/workspace");

  return (
    <div className="flex flex-col h-screen w-full overflow-hidden">
      <GlobalHeader />
      <main className={`flex-1 ${isWorkspace ? "overflow-hidden" : "overflow-y-auto"}`}>
        <Router />
      </main>
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <AppContent />
          <Toaster />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
