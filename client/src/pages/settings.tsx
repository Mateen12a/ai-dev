import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useTheme } from "@/components/theme-provider";
import { Settings as SettingsIcon, Palette, Bell, Code2, Globe, Moon, Sun } from "lucide-react";

export default function Settings() {
  const { theme, toggleTheme } = useTheme();

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-3xl mx-auto p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-settings-title">Settings</h1>
          <p className="text-sm text-muted-foreground mt-1">Configure your development environment</p>
        </div>

        <Card>
          <CardContent className="p-5 space-y-5">
            <div className="flex items-center gap-2">
              <Palette className="w-4 h-4 text-primary" />
              <h3 className="text-sm font-semibold">Appearance</h3>
            </div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label className="text-sm">Dark Mode</Label>
                <p className="text-xs text-muted-foreground mt-0.5">Toggle between light and dark themes</p>
              </div>
              <div className="flex items-center gap-2">
                <Sun className="w-4 h-4 text-muted-foreground" />
                <Switch
                  checked={theme === "dark"}
                  onCheckedChange={toggleTheme}
                  data-testid="switch-dark-mode"
                />
                <Moon className="w-4 h-4 text-muted-foreground" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5 space-y-5">
            <div className="flex items-center gap-2">
              <Code2 className="w-4 h-4 text-primary" />
              <h3 className="text-sm font-semibold">Editor</h3>
            </div>
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <Label className="text-sm">Auto Save</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">Automatically save files after changes</p>
                </div>
                <Switch defaultChecked data-testid="switch-auto-save" />
              </div>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <Label className="text-sm">Word Wrap</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">Wrap long lines in the editor</p>
                </div>
                <Switch data-testid="switch-word-wrap" />
              </div>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <Label className="text-sm">Tab Size</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">Number of spaces per tab</p>
                </div>
                <Input
                  type="number"
                  defaultValue="2"
                  className="w-20"
                  min={1}
                  max={8}
                  data-testid="input-tab-size"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5 space-y-5">
            <div className="flex items-center gap-2">
              <Bell className="w-4 h-4 text-primary" />
              <h3 className="text-sm font-semibold">Notifications</h3>
            </div>
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <Label className="text-sm">Build Notifications</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">Get notified when builds complete</p>
                </div>
                <Switch defaultChecked data-testid="switch-build-notify" />
              </div>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <Label className="text-sm">Deploy Notifications</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">Get notified when deployments finish</p>
                </div>
                <Switch defaultChecked data-testid="switch-deploy-notify" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5 space-y-5">
            <div className="flex items-center gap-2">
              <Globe className="w-4 h-4 text-primary" />
              <h3 className="text-sm font-semibold">Platform</h3>
            </div>
            <div className="space-y-3 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Version</span>
                <Badge variant="outline" className="text-[10px]">v1.0.0</Badge>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Runtime</span>
                <span className="font-medium">Node.js 20 LTS</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Database</span>
                <span className="font-medium">PostgreSQL 15</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
