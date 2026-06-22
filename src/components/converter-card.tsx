"use client";

import * as React from "react";
import {
  UploadCloud,
  File as FileIcon,
  X,
  ArrowRight,
  Download,
  RotateCcw,
  Loader2,
  Lock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { StatusPill } from "@/components/status-pill";
import { ParamControls } from "@/components/param-controls";
import { useToast } from "@/components/ui/toast";
import { cn, formatBytes } from "@/lib/utils";
import type { OutputOption, OutputParamSpec, ClientJob, ParamValue } from "@/lib/types";
import {
  detectFiles,
  runConversion,
  downloadTarget,
  saveArtifact,
} from "@/lib/engine";
import { upsertRecentJob } from "@/lib/local-store";

type Phase = "idle" | "detecting" | "ready" | "working" | "done" | "error";

/**
 * The central command card: drag-and-drop files, auto-detect the type, pick an
 * output, and convert - all in the browser. Files never leave the device.
 *
 * `presetOutputId` lets the Tools page deep-link a specific operation.
 */
export function ConverterCard({
  presetOutputId,
  className,
}: {
  presetOutputId?: string;
  className?: string;
}) {
  const { toast } = useToast();

  const [phase, setPhase] = React.useState<Phase>("idle");
  const [dragActive, setDragActive] = React.useState(false);
  const [files, setFiles] = React.useState<File[]>([]);
  const [outputs, setOutputs] = React.useState<OutputOption[]>([]);
  const [selectedOutputId, setSelectedOutputId] = React.useState<string>("");
  const [params, setParams] = React.useState<Record<string, ParamValue>>({});
  const [progress, setProgress] = React.useState(0);
  const [statusText, setStatusText] = React.useState("");
  const [job, setJob] = React.useState<ClientJob | null>(null);
  const [errorMsg, setErrorMsg] = React.useState("");

  const inputRef = React.useRef<HTMLInputElement>(null);
  const folderRef = React.useRef<HTMLInputElement>(null);

  const selectedOption = outputs.find((o) => o.id === selectedOutputId);
  const selectedUnavailable = selectedOption?.unavailableReason;

  const runDetection = React.useCallback(
    async (fs: File[]) => {
      if (fs.length === 0) return;
      setPhase("detecting");
      setErrorMsg("");
      try {
        const res = await detectFiles(fs);
        setOutputs(res.outputs);
        // Prefer the preset; else the first AVAILABLE option; else first.
        const preferred =
          (presetOutputId && res.outputs.find((o) => o.id === presetOutputId)?.id) ||
          res.outputs.find((o) => !o.unavailableReason)?.id ||
          res.outputs[0]?.id ||
          "";
        setSelectedOutputId(preferred);
        setParams({});
        if (res.outputs.length === 0) {
          setPhase("error");
          setErrorMsg("We couldn't find a supported conversion for this file.");
        } else {
          setPhase("ready");
        }
      } catch (e) {
        setPhase("error");
        setErrorMsg((e as Error).message);
      }
    },
    [presetOutputId],
  );

  function addFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    const next = [...files, ...Array.from(list)];
    setFiles(next);
    void runDetection(next);
  }

  function removeFile(idx: number) {
    const next = files.filter((_, i) => i !== idx);
    setFiles(next);
    if (next.length === 0) reset();
    else void runDetection(next);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
  }

  async function handleConvert() {
    if (!selectedOutputId) {
      toast({ variant: "error", title: "Pick an output format first." });
      return;
    }
    if (selectedUnavailable) {
      toast({ variant: "error", title: "Not available in-browser", description: selectedUnavailable });
      return;
    }
    setPhase("working");
    setProgress(0);
    setStatusText("");
    setErrorMsg("");
    try {
      const result = await runConversion(
        files,
        selectedOutputId,
        cleanParams(params),
        {
          onProgress: setProgress,
          onStatus: setStatusText,
        },
      );
      setJob(result);
      if (result.status === "completed") {
        setPhase("done");
        upsertRecentJob({
          id: result.id,
          label: files[0]?.name ?? "files",
          outputLabel: selectedOption?.label,
          kind: result.inputKind,
          status: "completed",
          createdAt: result.createdAt,
        });
        toast({ variant: "success", title: "Done", description: "Your file is ready." });
      } else {
        setPhase("error");
        setErrorMsg(result.error || "Conversion failed.");
        toast({ variant: "error", title: "Conversion failed", description: result.error });
      }
    } catch (e) {
      setPhase("error");
      setErrorMsg((e as Error).message);
      toast({ variant: "error", title: "Conversion failed", description: (e as Error).message });
    }
  }

  function reset() {
    setPhase("idle");
    setFiles([]);
    setOutputs([]);
    setSelectedOutputId("");
    setParams({});
    setProgress(0);
    setStatusText("");
    setJob(null);
    setErrorMsg("");
  }

  const busy = phase === "working" || phase === "detecting";

  return (
    <div className={cn("w-full rounded-xl border border-border bg-card shadow-sm", className)}>
      <div className="p-5 sm:p-6">
        {files.length === 0 ? (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={onDrop}
            className={cn(
              "group flex w-full flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-14 text-center transition-colors",
              dragActive
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/50 hover:bg-secondary/40",
            )}
          >
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-secondary text-muted-foreground transition-colors group-hover:bg-primary/10 group-hover:text-primary">
              <UploadCloud className="h-7 w-7" />
            </div>
            <p className="text-base font-semibold">Drag &amp; drop files here</p>
            <p className="mt-1 text-sm text-muted-foreground">
              or click to browse - images, PDF, video, audio, ZIP
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Files are processed in your browser and never uploaded.
            </p>
            <div className="mt-5 flex items-center gap-2">
              <span className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground">
                Choose files
              </span>
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  folderRef.current?.click();
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.stopPropagation();
                    folderRef.current?.click();
                  }
                }}
                className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-secondary"
              >
                Choose folder
              </span>
            </div>
          </button>
        ) : (
          <FileList files={files} onRemove={removeFile} disabled={busy} />
        )}

        <input ref={inputRef} type="file" multiple className="hidden" onChange={(e) => addFiles(e.target.files)} />
        <input
          ref={folderRef}
          type="file"
          multiple
          className="hidden"
          // @ts-expect-error - non-standard but widely supported
          webkitdirectory=""
          directory=""
          onChange={(e) => addFiles(e.target.files)}
        />

        {phase === "detecting" && (
          <div className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Detecting input type…
          </div>
        )}

        {phase === "ready" && outputs.length > 0 && (
          <div className="mt-6 space-y-4">
            <Separator />
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1 space-y-2">
                <label className="text-xs font-medium text-muted-foreground">Output format</label>
                <Select
                  value={selectedOutputId}
                  onValueChange={(v) => {
                    setSelectedOutputId(v);
                    setParams({});
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Choose an output" />
                  </SelectTrigger>
                  <SelectContent>
                    {outputs.map((o) => (
                      <SelectItem key={o.id} value={o.id} disabled={!!o.unavailableReason}>
                        {o.label}
                        {o.unavailableReason ? " (server only)" : ""}
                        {o.description && !o.unavailableReason ? (
                          <span className="text-muted-foreground"> - {o.description}</span>
                        ) : null}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={handleConvert} disabled={busy || !selectedOutputId || !!selectedUnavailable} className="sm:w-40">
                Convert <ArrowRight className="h-4 w-4" />
              </Button>
            </div>

            {selectedUnavailable && (
              <div className="flex items-start gap-2 rounded-lg border border-border bg-secondary/40 p-3 text-sm text-muted-foreground">
                <Lock className="mt-0.5 h-4 w-4 shrink-0" />
                {selectedUnavailable}
              </div>
            )}

            {!selectedUnavailable && selectedOption?.params && selectedOption.params.length > 0 && (
              <ParamControls
                specs={selectedOption.params as OutputParamSpec[]}
                values={params}
                onChange={(k, v) => setParams((p) => ({ ...p, [k]: v }))}
              />
            )}
          </div>
        )}

        {phase === "working" && (
          <div className="mt-6 space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">{statusText || "Processing…"}</span>
              <StatusPill status="processing" />
            </div>
            <Progress value={progress} />
            <p className="text-xs text-muted-foreground">
              {progress}% - running locally in your browser.
            </p>
          </div>
        )}

        {phase === "done" && job && (
          <div className="mt-6">
            <Separator className="mb-4" />
            <ResultPanel job={job} onReset={reset} />
          </div>
        )}

        {phase === "error" && (
          <div className="mt-6 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
            <div className="mb-2 flex items-center gap-2">
              <StatusPill status="failed" />
            </div>
            <p className="text-sm text-foreground">{errorMsg || "Something went wrong."}</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={reset}>
              <RotateCcw className="h-4 w-4" /> Start over
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function FileList({
  files,
  onRemove,
  disabled,
}: {
  files: File[];
  onRemove: (idx: number) => void;
  disabled?: boolean;
}) {
  const total = files.reduce((s, f) => s + f.size, 0);
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">
        {files.length} file{files.length > 1 ? "s" : ""} ·{" "}
        <span className="text-muted-foreground">{formatBytes(total)}</span>
      </p>
      <ul className="max-h-56 space-y-2 overflow-auto pr-1">
        {files.map((f, i) => (
          <li key={`${f.name}-${i}`} className="flex items-center gap-3 rounded-lg border border-border bg-background p-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-secondary text-muted-foreground">
              <FileIcon className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{f.name}</p>
              <p className="text-xs text-muted-foreground">{formatBytes(f.size)}</p>
            </div>
            {!disabled && (
              <button
                onClick={() => onRemove(i)}
                className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                aria-label={`Remove ${f.name}`}
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ResultPanel({ job, onReset }: { job: ClientJob; onReset: () => void }) {
  const target = downloadTarget(job);
  const single = job.outputs.length === 1 && !job.bundle;
  return (
    <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4">
      <div className="mb-3 flex items-center justify-between">
        <StatusPill status="completed" />
        <span className="text-xs text-muted-foreground">
          {job.bundle ? "Bundled as ZIP" : `${job.outputs.length} file${job.outputs.length > 1 ? "s" : ""}`}
        </span>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Button className="flex-1" onClick={() => target && saveArtifact(target)} disabled={!target}>
          <Download className="h-4 w-4" />
          {single && target ? `Download ${target.name}` : "Download result"}
        </Button>
        <Button variant="ghost" onClick={onReset} className="w-full sm:w-auto">
          <RotateCcw className="h-4 w-4" /> New
        </Button>
      </div>

      {job.outputs.length > 1 && (
        <ul className="mt-3 space-y-1 text-xs">
          {job.outputs.slice(0, 8).map((o) => (
            <li key={o.name} className="flex items-center justify-between gap-2">
              <button
                className="truncate text-left text-primary hover:underline"
                onClick={() => saveArtifact(o)}
              >
                {o.name}
              </button>
              <span className="text-muted-foreground">{formatBytes(o.size)}</span>
            </li>
          ))}
          {job.outputs.length > 8 && (
            <li className="italic text-muted-foreground">
              +{job.outputs.length - 8} more (use Download result for all)
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

function cleanParams(params: Record<string, ParamValue>): Record<string, ParamValue> {
  const out: Record<string, ParamValue> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v === "" || v === undefined || v === null) continue;
    out[k] = v;
  }
  return out;
}
