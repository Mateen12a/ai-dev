import { useQuery, useMutation } from "@tanstack/react-query";
import { Project } from "@shared/schema";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Link, useLocation } from "wouter";
import { 
  FolderGit2, 
  Search, 
  Plus, 
  Trash2, 
  ArrowRight,
  Loader2,
  AlertCircle
} from "lucide-react";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  Card, 
  CardContent, 
  CardDescription, 
  CardFooter, 
  CardHeader, 
  CardTitle 
} from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

const STATUS_COLOR: Record<string, string> = {
  deployed: "bg-green-500",
  running: "bg-blue-500",
  building: "bg-yellow-500",
  idle: "bg-muted-foreground",
};

export default function Projects() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [search, setSearch] = useState("");

  const { data: projects, isLoading } = useQuery<Project[]>({ 
    queryKey: ["/api/projects"] 
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/projects/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      toast({ title: "Project deleted successfully" });
    },
    onError: (err: Error) => {
      toast({ 
        title: "Failed to delete project", 
        description: err.message, 
        variant: "destructive" 
      });
    },
  });

  const filteredProjects = projects?.filter(p => 
    p.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="min-h-full bg-background flex flex-col p-6">
      <div className="max-w-6xl mx-auto w-full">
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold tracking-tight" data-testid="text-projects-title">My Projects</h1>
            <p className="text-muted-foreground mt-1" data-testid="text-projects-description">
              Manage and view all your AI-generated projects.
            </p>
          </div>
          <Link href="/">
            <Button data-testid="button-new-project">
              <Plus className="w-4 h-4 mr-2" />
              New Project
            </Button>
          </Link>
        </header>

        <div className="flex items-center gap-2 mb-6">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search projects..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
              data-testid="input-search-projects"
            />
          </div>
        </div>

        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="w-8 h-8 animate-spin mb-4" />
            <p>Loading projects...</p>
          </div>
        ) : filteredProjects && filteredProjects.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredProjects.map((project) => (
              <Card 
                key={project.id} 
                className="hover-elevate transition-all cursor-pointer group flex flex-col"
                onClick={() => navigate(`/workspace/${project.id}`)}
                data-testid={`card-project-${project.id}`}
              >
                <CardHeader className="pb-3 flex flex-row items-start justify-between gap-2">
                  <div className="min-w-0">
                    <CardTitle className="text-lg truncate" data-testid={`text-project-name-${project.id}`}>
                      {project.name}
                    </CardTitle>
                    <CardDescription className="line-clamp-1 mt-1" data-testid={`text-project-desc-${project.id}`}>
                      {project.description || "No description"}
                    </CardDescription>
                  </div>
                  <FolderGit2 className="w-5 h-5 text-primary shrink-0 mt-1" />
                </CardHeader>
                <CardContent className="flex-1 pb-3">
                  <div className="flex flex-wrap gap-2 mb-3">
                    <Badge variant="secondary" className="text-[10px]" data-testid={`badge-project-lang-${project.id}`}>
                      {project.language}
                    </Badge>
                    <Badge variant="outline" className="text-[10px]" data-testid={`badge-project-framework-${project.id}`}>
                      {project.framework}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <div className={`w-2 h-2 rounded-full ${STATUS_COLOR[project.status] || "bg-muted-foreground"}`} />
                    <span className="capitalize" data-testid={`text-project-status-${project.id}`}>{project.status}</span>
                    <span className="mx-1">•</span>
                    <span data-testid={`text-project-date-${project.id}`}>
                      {project.createdAt ? format(new Date(project.createdAt), "MMM d, yyyy") : "Unknown date"}
                    </span>
                  </div>
                </CardContent>
                <CardFooter className="pt-0 flex items-center justify-between">
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="text-muted-foreground hover:text-foreground"
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/workspace/${project.id}`);
                    }}
                    data-testid={`button-open-workspace-${project.id}`}
                  >
                    Open Workspace <ArrowRight className="w-3.5 h-3.5 ml-1" />
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground hover:text-destructive transition-colors h-8 w-8"
                        onClick={(e) => e.stopPropagation()}
                        data-testid={`button-delete-project-${project.id}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent onClick={(e) => e.stopPropagation()}>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will permanently delete "{project.name}" and all its files. This action cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel onClick={(e) => e.stopPropagation()}>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteMutation.mutate(project.id);
                          }}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          data-testid={`button-confirm-delete-${project.id}`}
                        >
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </CardFooter>
              </Card>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-20 text-center border-2 border-dashed rounded-xl">
            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-4">
              <AlertCircle className="w-6 h-6 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold">No projects found</h3>
            <p className="text-muted-foreground max-w-sm mt-1">
              {search ? "No projects match your search criteria." : "You haven't created any projects yet. Start by describing what you want to build."}
            </p>
            {!search && (
              <Link href="/">
                <Button className="mt-4">
                  Create First Project
                </Button>
              </Link>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
