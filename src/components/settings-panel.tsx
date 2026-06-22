"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { Sun, Moon, Monitor, ShieldCheck, Cpu, Info } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { getSettings, saveSettings, type AppSettings } from "@/lib/local-store";
import { getBrowserCapabilities, type BrowserCapabilities } from "@/lib/capabilities";

export function SettingsPanel() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  const [settings, setSettings] = React.useState<AppSettings>({ defaultQuality: 80 });
  const [caps, setCaps] = React.useState<BrowserCapabilities | null>(null);

  React.useEffect(() => {
    setMounted(true);
    setSettings(getSettings());
    getBrowserCapabilities().then(setCaps).catch(() => setCaps(null));
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
            <ThemeOption active={theme === "light"} onClick={() => setTheme("light")} icon={<Sun className="h-5 w-5" />} label="Light" />
            <ThemeOption active={theme === "dark"} onClick={() => setTheme("dark")} icon={<Moon className="h-5 w-5" />} label="Dark" />
            <ThemeOption active={theme === "system"} onClick={() => setTheme("system")} icon={<Monitor className="h-5 w-5" />} label="System" />
          </div>
        </CardContent>
      </Card>

      {/* Conversion defaults */}
      <Card>
        <CardHeader>
          <CardTitle>Conversion defaults</CardTitle>
          <CardDescription>Preferences applied to new conversions, stored locally.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="max-w-xs space-y-2">
            <Label htmlFor="quality">Default image quality</Label>
            <Input
              id="quality"
              type="number"
              min={10}
              max={100}
              value={settings.defaultQuality}
              onChange={(e) => update("defaultQuality", Math.max(10, Math.min(100, Number(e.target.value) || 80)))}
            />
            <p className="text-xs text-muted-foreground">Used as the starting quality for JPG/WebP/AVIF.</p>
          </div>
        </CardContent>
      </Card>

      {/* Privacy */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" /> Privacy
          </CardTitle>
          <CardDescription>How your files are handled.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-start gap-2 rounded-lg bg-secondary/50 p-3 text-sm text-muted-foreground">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            Everything runs in your browser. Files are never uploaded to a server,
            and results live only in this tab until you download them.
          </div>
        </CardContent>
      </Card>

      {/* Browser capabilities */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Cpu className="h-4 w-4" /> This browser
          </CardTitle>
          <CardDescription>What this browser can do client-side.</CardDescription>
        </CardHeader>
        <CardContent>
          {caps ? (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <CapRow label="Images (Canvas)" ok />
              <CapRow label="PDF to image (pdf.js)" ok />
              <CapRow label="Archives (ZIP)" ok />
              <CapRow label="Video / audio (ffmpeg.wasm)" ok={caps.crossOriginIsolated} note={!caps.crossOriginIsolated ? "needs COOP/COEP" : undefined} />
              <CapRow label="WebP encode" ok={caps.webpEncode} />
              <CapRow label="AVIF encode" ok={caps.avifEncode} note={!caps.avifEncode ? "falls back to PNG" : undefined} />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Checking browser…</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function CapRow({ label, ok, note }: { label: string; ok: boolean; note?: string }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
      <span>
        {label}
        {note ? <span className="ml-1 text-xs text-muted-foreground">({note})</span> : null}
      </span>
      <Badge variant={ok ? "default" : "secondary"}>{ok ? "Ready" : "Off"}</Badge>
    </div>
  );
}

function ThemeOption({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex flex-col items-center gap-2 rounded-lg border-2 p-4 transition-colors",
        active ? "border-primary bg-primary/5 text-foreground" : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground",
      )}
    >
      {icon}
      <span className="text-sm font-medium">{label}</span>
    </button>
  );
}
