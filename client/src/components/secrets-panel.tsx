import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Eye, EyeOff, KeyRound, Loader2 } from "lucide-react";
import type { ProjectSecret } from "@shared/schema";

interface SecretsPanelProps {
  projectId: string;
}

export default function SecretsPanel({ projectId }: SecretsPanelProps) {
  const { toast } = useToast();
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);

  const { data: secrets, isLoading } = useQuery<ProjectSecret[]>({
    queryKey: ["/api/projects", projectId, "secrets"],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/secrets`);
      return res.json();
    },
  });

  const addMutation = useMutation({
    mutationFn: async ({ key, value }: { key: string; value: string }) => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/secrets`, { key, value });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "secrets"] });
      setNewKey("");
      setNewValue("");
      setAdding(false);
      toast({ title: "Secret added" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to add secret", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/projects/${projectId}/secrets/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "secrets"] });
      toast({ title: "Secret deleted" });
    },
  });

  const handleAdd = () => {
    if (!newKey.trim() || !newValue.trim()) return;
    addMutation.mutate({ key: newKey.trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_"), value: newValue });
  };

  return (
    <div className="h-full flex flex-col" data-testid="panel-secrets">
      <div className="p-4 border-b flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Environment Secrets</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Injected as env vars during shell execution</p>
        </div>
        <Button size="sm" onClick={() => setAdding(!adding)} data-testid="button-add-secret">
          <Plus className="w-3.5 h-3.5 mr-1" /> Add Secret
        </Button>
      </div>

      {adding && (
        <div className="p-4 border-b bg-muted/30 space-y-2">
          <Input
            placeholder="KEY_NAME"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "_"))}
            className="font-mono text-sm h-8"
            data-testid="input-secret-key"
          />
          <Input
            type="password"
            placeholder="secret value"
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            className="font-mono text-sm h-8"
            data-testid="input-secret-value"
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={handleAdd} disabled={!newKey || !newValue || addMutation.isPending} data-testid="button-save-secret">
              {addMutation.isPending && <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />}
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center p-8">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : secrets?.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-8 text-center">
            <KeyRound className="w-8 h-8 text-muted-foreground mb-3" />
            <p className="text-sm font-medium">No secrets yet</p>
            <p className="text-xs text-muted-foreground mt-1">Add environment variables for your project</p>
          </div>
        ) : (
          <div className="divide-y">
            {secrets?.map((secret) => (
              <div key={secret.id} className="flex items-center gap-3 px-4 py-3 group hover:bg-muted/30" data-testid={`row-secret-${secret.id}`}>
                <KeyRound className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="font-mono text-xs font-medium text-foreground">{secret.key}</p>
                  <p className="font-mono text-xs text-muted-foreground mt-0.5">
                    {revealed.has(secret.id) ? secret.value : "••••••••••••"}
                  </p>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    className="p-1 rounded hover:bg-muted"
                    onClick={() => setRevealed(prev => {
                      const next = new Set(prev);
                      if (next.has(secret.id)) next.delete(secret.id);
                      else next.add(secret.id);
                      return next;
                    })}
                    data-testid={`button-toggle-secret-${secret.id}`}
                  >
                    {revealed.has(secret.id) ? <EyeOff className="w-3.5 h-3.5 text-muted-foreground" /> : <Eye className="w-3.5 h-3.5 text-muted-foreground" />}
                  </button>
                  <button
                    className="p-1 rounded hover:bg-destructive/10 text-destructive"
                    onClick={() => deleteMutation.mutate(secret.id)}
                    data-testid={`button-delete-secret-${secret.id}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <Badge variant="outline" className="text-[10px] shrink-0">ENV</Badge>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
