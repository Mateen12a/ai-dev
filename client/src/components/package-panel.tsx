import { useState, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { ProjectFile } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import {
  Package, Search, Plus, Trash2, Loader2, RefreshCw,
  ArrowUpCircle, ExternalLink
} from "lucide-react";

interface PackagePanelProps {
  projectId: string;
}

interface PackageInfo {
  name: string;
  version: string;
  isDev: boolean;
}

interface NpmSearchResult {
  name: string;
  description: string;
  version: string;
}

export default function PackagePanel({ projectId }: PackagePanelProps) {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [npmResults, setNpmResults] = useState<NpmSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [installing, setInstalling] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const { data: files = [], refetch: refetchFiles } = useQuery<ProjectFile[]>({
    queryKey: ["/api/projects", projectId, "files"],
  });

  const pkgFile = files.find(f => f.name === "package.json" || f.path === "package.json");

  const packages: PackageInfo[] = (() => {
    if (!pkgFile?.content) return [];
    try {
      const pkg = JSON.parse(pkgFile.content);
      const deps: PackageInfo[] = [];
      if (pkg.dependencies) {
        for (const [name, version] of Object.entries(pkg.dependencies)) {
          deps.push({ name, version: version as string, isDev: false });
        }
      }
      if (pkg.devDependencies) {
        for (const [name, version] of Object.entries(pkg.devDependencies)) {
          deps.push({ name, version: version as string, isDev: true });
        }
      }
      return deps.sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      return [];
    }
  })();

  const filteredPackages = search.trim()
    ? packages.filter(p => p.name.toLowerCase().includes(search.toLowerCase()))
    : packages;

  useEffect(() => {
    if (!search.trim() || search.trim().length < 2) {
      setNpmResults([]);
      return;
    }

    const isInstalled = packages.some(p => p.name === search.trim());
    if (isInstalled) {
      setNpmResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(search.trim())}&size=10`);
        const data = await res.json();
        const results: NpmSearchResult[] = (data.objects || []).map((obj: any) => ({
          name: obj.package.name,
          description: obj.package.description || "",
          version: obj.package.version,
        }));
        setNpmResults(results.filter(r => !packages.some(p => p.name === r.name)));
      } catch {
        setNpmResults([]);
      } finally {
        setSearching(false);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [search, packages]);

  const runShellCommand = useCallback(async (command: string) => {
    try {
      const res = await apiRequest("POST", `/api/projects/${projectId}/shell`, { command });
      const result = await res.json();
      return result;
    } catch (err: any) {
      throw err;
    }
  }, [projectId]);

  const isValidPackageName = (name: string): boolean => {
    return /^(@[a-zA-Z0-9_-]+\/)?[a-zA-Z0-9._-]+(@[a-zA-Z0-9._^~><=|-]+)?$/.test(name) && name.length < 214;
  };

  const installPackage = useCallback(async (packageName: string, isDev = false) => {
    if (!isValidPackageName(packageName)) {
      toast({ title: "Invalid package name", description: "Package name contains invalid characters", variant: "destructive" });
      return;
    }
    setInstalling(packageName);
    try {
      const flag = isDev ? " --save-dev" : "";
      await runShellCommand(`npm install ${packageName}${flag}`);
      toast({ title: "Package installed", description: `${packageName} has been installed` });
      await refetchFiles();
    } catch {
      toast({ title: "Install failed", description: `Failed to install ${packageName}`, variant: "destructive" });
    } finally {
      setInstalling(null);
    }
  }, [runShellCommand, toast, refetchFiles]);

  const removePackage = useCallback(async (packageName: string) => {
    if (!isValidPackageName(packageName)) {
      toast({ title: "Invalid package name", variant: "destructive" });
      return;
    }
    setRemoving(packageName);
    try {
      await runShellCommand(`npm uninstall ${packageName}`);
      toast({ title: "Package removed", description: `${packageName} has been removed` });
      await refetchFiles();
    } catch {
      toast({ title: "Remove failed", description: `Failed to remove ${packageName}`, variant: "destructive" });
    } finally {
      setRemoving(null);
    }
  }, [runShellCommand, toast, refetchFiles]);

  if (!pkgFile) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 p-6" data-testid="panel-packages">
        <Package className="w-10 h-10 text-muted-foreground/50" />
        <p className="text-sm text-muted-foreground text-center">
          No package.json found in this project.
        </p>
        <p className="text-xs text-muted-foreground/70 text-center">
          Package management requires a Node.js project with a package.json file.
        </p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col" data-testid="panel-packages">
      <div className="px-3 py-2 border-b bg-card/30 shrink-0 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Package className="w-4 h-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">Packages</h3>
            <Badge variant="outline" className="text-[10px]">{packages.length}</Badge>
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0"
            onClick={() => refetchFiles()}
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>
        </div>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search installed or find new packages..."
            className="h-7 pl-7 text-xs bg-muted/40 border-0 focus-visible:ring-1"
            data-testid="input-package-search"
          />
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {search.trim() && npmResults.length > 0 && (
            <div className="mb-3">
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide px-2 py-1">
                {searching ? "Searching npm..." : "Available on npm"}
              </p>
              {npmResults.map(result => (
                <div
                  key={result.name}
                  className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/50 transition-colors group"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-medium truncate">{result.name}</span>
                      <Badge variant="outline" className="text-[9px] shrink-0">{result.version}</Badge>
                    </div>
                    <p className="text-[10px] text-muted-foreground truncate mt-0.5">{result.description}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-[10px] gap-1"
                      onClick={() => installPackage(result.name)}
                      disabled={installing === result.name}
                    >
                      {installing === result.name ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Plus className="w-3 h-3" />
                      )}
                      Add
                    </Button>
                    <a
                      href={`https://www.npmjs.com/package/${result.name}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-1 rounded hover:bg-muted text-muted-foreground"
                    >
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}

          {searching && npmResults.length === 0 && search.trim() && (
            <div className="flex items-center justify-center py-4 gap-2 text-xs text-muted-foreground">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Searching npm registry...
            </div>
          )}

          <div>
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide px-2 py-1">
              Installed ({filteredPackages.length})
            </p>
            {filteredPackages.length === 0 && (
              <p className="text-xs text-muted-foreground px-2 py-4 text-center">
                {search.trim() ? "No matching packages" : "No packages installed"}
              </p>
            )}
            {filteredPackages.map(pkg => (
              <div
                key={pkg.name}
                className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/50 transition-colors group"
              >
                <Package className="w-3 h-3 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0 flex items-center gap-1.5">
                  <span className="text-xs font-medium truncate">{pkg.name}</span>
                  <Badge variant="outline" className="text-[9px] shrink-0">
                    {pkg.version}
                  </Badge>
                  {pkg.isDev && (
                    <Badge variant="secondary" className="text-[9px] shrink-0">dev</Badge>
                  )}
                </div>
                <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                  <a
                    href={`https://www.npmjs.com/package/${pkg.name}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1 rounded hover:bg-muted text-muted-foreground"
                  >
                    <ExternalLink className="w-3 h-3" />
                  </a>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                    onClick={() => removePackage(pkg.name)}
                    disabled={removing === pkg.name}
                  >
                    {removing === pkg.name ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Trash2 className="w-3 h-3" />
                    )}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
