"use client";

import * as React from "react";
import { useSearchParams, useRouter } from "next/navigation";
import * as Icons from "lucide-react";
import { Lock } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ConverterCard } from "@/components/converter-card";
import { cn } from "@/lib/utils";
import {
  TOOLS,
  TOOL_CATEGORIES,
  type ToolDef,
} from "@/lib/tools-catalog";
import {
  getBrowserCapabilities,
  isOutputRunnable,
  type BrowserCapabilities,
} from "@/lib/capabilities";

/** Resolve a lucide icon by name with a safe fallback. */
function Icon({ name, className }: { name: string; className?: string }) {
  const Cmp =
    (Icons as unknown as Record<string, React.ElementType>)[name] ??
    Icons.Wrench;
  return <Cmp className={className} />;
}

export function ToolsGrid() {
  const params = useSearchParams();
  const router = useRouter();
  const [caps, setCaps] = React.useState<BrowserCapabilities | null>(null);
  const [active, setActive] = React.useState<ToolDef | null>(null);

  React.useEffect(() => {
    getBrowserCapabilities()
      .then(setCaps)
      .catch(() => setCaps(null));
  }, []);

  // Open a tool dialog if ?tool=slug is present.
  React.useEffect(() => {
    const slug = params.get("tool");
    if (!slug) return;
    const tool = TOOLS.find((t) => t.slug === slug);
    if (tool) setActive(tool);
  }, [params]);

  function openTool(tool: ToolDef) {
    setActive(tool);
  }

  function closeTool() {
    setActive(null);
    // Drop the ?tool param without a full navigation.
    if (params.get("tool")) router.replace("/tools");
  }

  function availability(tool: ToolDef): { ok: boolean; reason?: string } {
    // Universal converter / multi-file tools have no single preset; always ok.
    if (!tool.presetOutputId && !tool.link) return { ok: true };
    if (tool.link) return { ok: false, reason: "Needs a server (CORS / yt-dlp)." };
    if (!caps) return { ok: true }; // optimistic until caps load
    return isOutputRunnable(tool.presetOutputId!, caps);
  }

  return (
    <>
      <div className="space-y-12">
        {TOOL_CATEGORIES.map((cat) => {
          const tools = TOOLS.filter((t) => t.category === cat);
          if (tools.length === 0) return null;
          return (
            <section key={cat}>
              <div className="mb-4 flex items-center gap-3">
                <h2 className="text-lg font-bold tracking-tight">{cat}</h2>
                <div className="h-px flex-1 bg-border" />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {tools.map((tool) => {
                  const avail = availability(tool);
                  const ok = avail.ok;
                  return (
                    <button
                      key={tool.slug}
                      onClick={() => ok && openTool(tool)}
                      disabled={!ok}
                      className={cn(
                        "edge-tab group relative flex flex-col items-start gap-3 rounded-xl border border-border bg-card p-5 text-left transition-all",
                        ok
                          ? "hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md"
                          : "cursor-not-allowed opacity-60",
                      )}
                    >
                      <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-secondary text-foreground transition-colors group-hover:bg-primary/10 group-hover:text-primary">
                        <Icon name={tool.icon} className="h-5 w-5" />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold leading-tight">
                            {tool.title}
                          </h3>
                          {!ok && (
                            <Badge variant="secondary" className="gap-1">
                              <Lock className="h-3 w-3" /> Server only
                            </Badge>
                          )}
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {tool.description}
                        </p>
                      </div>
                      {!ok && avail.reason && (
                        <p className="text-[11px] text-muted-foreground">
                          {avail.reason}
                        </p>
                      )}
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      <Dialog open={!!active} onOpenChange={(o) => !o && closeTool()}>
        <DialogContent className="max-w-2xl">
          {active && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Icon name={active.icon} className="h-5 w-5 text-primary" />
                  {active.title}
                </DialogTitle>
                <DialogDescription>{active.description}</DialogDescription>
              </DialogHeader>
              <ConverterCard presetOutputId={active.presetOutputId} />
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
