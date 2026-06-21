"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { Sun, Moon, Monitor, Server, Info, HardDrive } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import {
  getSettings,
  saveSettings,
  type AppSettings,
} from "@/lib/local-store";
import { fetchCapabilities, type Capabilities } from "@/lib/client";

export function SettingsPanel() {
  const { toast } = useToast();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  const [settings, setSettings] = React.useState<AppSettings>({
    maxFileSizeMb: 512,
    jobTtlMinutes: 30,
  });
  const [caps, setCaps] = React.useState<Capabilities | null>(null);

  React.useEffect(() => {
    setMounted(true);
    setSettings(getSettings());
    fetchCapabilities()
      .then(setCaps)
      .catch(() => setCaps(null));
  }, []);

  function update<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    const next = { ...settings, [key]: value };
    setSettings(next);
    saveSettings({ [key]: value });
  }

  if (!mounted) return null;

  return (
    <div className="space-y-6">
      {/* Appearance */}
      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
          <CardDescription>Choose how Kanban Tools looks.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-3">
            <ThemeOption
              active={theme === "light"}
              onClick={() => setTheme("light")}
              icon={<Sun className="h-5 w-5" />}
              label="Light"
            />
            <ThemeOption
              active={theme === "dark"}
              onClick={() => setTheme("dark")}
              icon={<Moon className="h-5 w-5" />}
              label="Dark"
            />
            <ThemeOption
              active={theme === "system"}
              onClick={() => setTheme("system")}
              icon={<Monitor className="h-5 w-5" />}
              label="System"
            />
          </div>
        </CardContent>
      </Card>

      {/* Limits / cleanup (client-side preferences) */}
      <Card>
        <CardHeader>
          <CardTitle>Files &amp; cleanup</CardTitle>
          <CardDescription>
            Your preferences for uploads and retention. The server enforces its
            own limits (shown below); change those via environment variables in
            deployment.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="maxsize">Preferred max file size (MB)</Label>
              <Input
                id="maxsize"
                type="number"
                min={1}
                max={4096}
                value={settings.maxFileSizeMb}
                onChange={(e) =>
                  update("maxFileSizeMb", Number(e.target.value) || 1)
                }
              />
              {caps && (
                <p className="text-xs text-muted-foreground">
                  Server limit: <strong>{caps.limits.maxFileSizeMb} MB</strong>
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="ttl">Temp file retention (minutes)</Label>
              <Input
                id="ttl"
                type="number"
                min={1}
                max={1440}
                value={settings.jobTtlMinutes}
                onChange={(e) =>
                  update("jobTtlMinutes", Number(e.target.value) || 1)
                }
              />
              {caps && (
                <p className="text-xs text-muted-foreground">
                  Server cleanup:{" "}
                  <strong>every {caps.limits.jobTtlMinutes} min</strong>
                </p>
              )}
            </div>
          </div>
          <div className="flex items-start gap-2 rounded-lg bg-secondary/50 p-3 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            These preferences are stored locally in your browser. The actual
            enforced limits and auto-cleanup schedule are configured server-side
            (see <code className="font-mono">.env</code>).
          </div>
        </CardContent>
      </Card>

      {/* Environment capabilities */}
      <Card>
        <CardHeader>
          <CardTitle>Environment</CardTitle>
          <CardDescription>
            Native tools detected on the server. Missing tools disable the
            related conversions.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {caps ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {Object.entries(caps.tools).map(([name, ok]) => (
                <div
                  key={name}
                  className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm"
                >
                  <span className="capitalize">{label(name)}</span>
                  <Badge variant={ok ? "default" : "secondary"}>
                    {ok ? "Ready" : "Off"}
                  </Badge>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Checking environment…
            </p>
          )}
        </CardContent>
      </Card>

      {/* Storage provider placeholder */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server className="h-4 w-4" /> Storage provider
          </CardTitle>
          <CardDescription>
            The MVP stores files on local disk and auto-deletes them. Cloud
            storage is a future upgrade.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between rounded-lg border border-dashed border-border p-4">
            <div className="flex items-center gap-3">
              <HardDrive className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Local disk (temporary)</p>
                <p className="text-xs text-muted-foreground">
                  Per-job folders under the configured temp directory.
                </p>
              </div>
            </div>
            <Badge variant="secondary">Active</Badge>
          </div>
          <Button variant="outline" className="mt-3" disabled>
            Connect cloud storage (coming soon)
          </Button>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button
          variant="ghost"
          onClick={() =>
            toast({
              variant: "success",
              title: "Settings saved",
              description: "Your preferences are stored locally.",
            })
          }
        >
          Saved automatically
        </Button>
      </div>
    </div>
  );
}

function ThemeOption({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex flex-col items-center gap-2 rounded-lg border-2 p-4 transition-colors",
        active
          ? "border-primary bg-primary/5 text-foreground"
          : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground",
      )}
    >
      {icon}
      <span className="text-sm font-medium">{label}</span>
    </button>
  );
}

function label(key: string): string {
  const map: Record<string, string> = {
    image: "Images (Sharp)",
    ffmpeg: "FFmpeg",
    ffprobe: "FFprobe",
    pdftoppm: "PDF raster",
    pdftocairo: "PDF SVG",
    ghostscript: "Ghostscript",
    ytdlp: "yt-dlp",
    linkDownloader: "Link downloader",
  };
  return map[key] ?? key;
}
