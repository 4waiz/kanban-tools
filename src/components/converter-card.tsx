"use client";

import * as React from "react";
import {
  UploadCloud,
  Link2,
  File as FileIcon,
  X,
  ArrowRight,
  Download,
  RotateCcw,
  ShieldAlert,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import type { OutputOption, OutputParamSpec } from "@/lib/types";
import {
  detectFiles,
  detectUrl,
  uploadFiles,
  startConvert,
  startLinkDownload,
  pollJob,
  downloadUrl,
  type PublicJob,
} from "@/lib/client";
import { upsertRecentJob, updateRecentJob } from "@/lib/local-store";

type Mode = "files" | "url";
type Phase = "idle" | "detecting" | "ready" | "working" | "done" | "error";

type ParamValue = string | number | boolean;

/**
 * The central command card: drag-and-drop files OR paste a URL, auto-detect the
 * type, pick an output from a dropdown that changes with the input, convert, and
 * download. Implements the full pending→processing→completed/failed lifecycle.
 *
 * `presetOutputId` lets the Tools page deep-link a specific operation.
 */
export function ConverterCard({
  presetOutputId,
  defaultMode = "files",
  className,
}: {
  presetOutputId?: string;
  defaultMode?: Mode;
  className?: string;
}) {
  const { toast } = useToast();

  const [mode, setMode] = React.useState<Mode>(defaultMode);
  const [phase, setPhase] = React.useState<Phase>("idle");
  const [dragActive, setDragActive] = React.useState(false);

  const [files, setFiles] = React.useState<File[]>([]);
  const [url, setUrl] = React.useState("");
  const [confirmRights, setConfirmRights] = React.useState(false);

  const [outputs, setOutputs] = React.useState<OutputOption[]>([]);
  const [selectedOutputId, setSelectedOutputId] = React.useState<string>("");
  const [params, setParams] = React.useState<Record<string, ParamValue>>({});

  const [uploadPct, setUploadPct] = React.useState(0);
  const [job, setJob] = React.useState<PublicJob | null>(null);
  const [token, setToken] = React.useState<string>("");
  const [errorMsg, setErrorMsg] = React.useState<string>("");

  const inputRef = React.useRef<HTMLInputElement>(null);
  const folderRef = React.useRef<HTMLInputElement>(null);
  const pollAbort = React.useRef<AbortController | null>(null);

  const selectedOption = outputs.find((o) => o.id === selectedOutputId);

  // ── Detection ────────────────────────────────────────────────────────────
  const runFileDetection = React.useCallback(
    async (fs: File[]) => {
      if (fs.length === 0) return;
      setPhase("detecting");
      setErrorMsg("");
      try {
        const res = await detectFiles(
          fs.map((f) => ({ name: f.name, type: f.type, size: f.size })),
        );
        setOutputs(res.outputs);
        const initial =
          (presetOutputId &&
            res.outputs.find((o) => o.id === presetOutputId)?.id) ||
          res.outputs[0]?.id ||
          "";
        setSelectedOutputId(initial);
        setParams({});
        setPhase(res.outputs.length ? "ready" : "error");
        if (!res.outputs.length) {
          setErrorMsg(
            "We couldn’t find a supported conversion for this file type.",
          );
        }
      } catch (e) {
        setPhase("error");
        setErrorMsg((e as Error).message);
      }
    },
    [presetOutputId],
  );

  const runUrlDetection = React.useCallback(async () => {
    if (!url.trim()) return;
    setPhase("detecting");
    setErrorMsg("");
    try {
      const res = await detectUrl(url.trim());
      setOutputs(res.outputs);
      setSelectedOutputId(res.outputs[0]?.id || "");
      setPhase("ready");
    } catch (e) {
      setPhase("error");
      setErrorMsg((e as Error).message);
    }
  }, [url]);

  // ── File selection handlers ──────────────────────────────────────────────
  function addFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    const next = [...files, ...Array.from(list)];
    setFiles(next);
    setMode("files");
    void runFileDetection(next);
  }

  function removeFile(idx: number) {
    const next = files.filter((_, i) => i !== idx);
    setFiles(next);
    if (next.length === 0) {
      reset();
    } else {
      void runFileDetection(next);
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
  }

  // ── Convert ──────────────────────────────────────────────────────────────
  async function handleConvert() {
    setErrorMsg("");
    try {
      if (mode === "url") {
        if (!confirmRights) {
          toast({
            variant: "error",
            title: "Confirmation required",
            description:
              "Please confirm you have the right to download this content.",
          });
          return;
        }
        setPhase("working");
        setUploadPct(100);
        const { job: j, token: t } = await startLinkDownload(url.trim(), true);
        setJob(j);
        setToken(t);
        recordRecent(j, t, url.trim(), "Download");
        await track(j.id, t);
        return;
      }

      // files mode
      if (!selectedOutputId) {
        toast({ variant: "error", title: "Pick an output format first." });
        return;
      }
      setPhase("working");
      setUploadPct(0);
      const { job: j, token: t } = await uploadFiles(files, setUploadPct);
      setToken(t);
      const cleanParams = sanitizeParams(params);
      const started = await startConvert(j.id, t, selectedOutputId, cleanParams);
      setJob(started);
      recordRecent(
        started,
        t,
        files[0]?.name ?? "files",
        selectedOption?.label,
      );
      await track(j.id, t);
    } catch (e) {
      setPhase("error");
      setErrorMsg((e as Error).message);
      toast({ variant: "error", title: "Conversion failed", description: (e as Error).message });
    }
  }

  async function track(jobId: string, t: string) {
    pollAbort.current?.abort();
    const ctrl = new AbortController();
    pollAbort.current = ctrl;
    try {
      const final = await pollJob(
        jobId,
        t,
        (j) => {
          setJob(j);
          updateRecentJob(j.id, { status: j.status });
        },
        ctrl.signal,
      );
      if (final.status === "completed") {
        setPhase("done");
        toast({ variant: "success", title: "Done", description: "Your file is ready to download." });
      } else {
        setPhase("error");
        setErrorMsg(final.error || "Conversion failed.");
        toast({ variant: "error", title: "Conversion failed", description: final.error });
      }
    } catch (e) {
      if ((e as Error).message !== "aborted") {
        setPhase("error");
        setErrorMsg((e as Error).message);
      }
    }
  }

  function recordRecent(
    j: PublicJob,
    t: string,
    label: string,
    outputLabel?: string,
  ) {
    upsertRecentJob({
      id: j.id,
      token: t,
      label,
      outputLabel,
      kind: j.inputKind,
      status: j.status,
      createdAt: j.createdAt,
    });
  }

  function reset() {
    pollAbort.current?.abort();
    setPhase("idle");
    setFiles([]);
    setUrl("");
    setConfirmRights(false);
    setOutputs([]);
    setSelectedOutputId("");
    setParams({});
    setUploadPct(0);
    setJob(null);
    setToken("");
    setErrorMsg("");
  }

  React.useEffect(() => () => pollAbort.current?.abort(), []);

  // ── Render ───────────────────────────────────────────────────────────────
  const busy = phase === "working" || phase === "detecting";
  const showResult = (phase === "done" || phase === "error") && job;

  return (
    <div
      className={cn(
        "w-full rounded-xl border border-border bg-card shadow-sm",
        className,
      )}
    >
      {/* Mode switch — files vs URL */}
      <div className="flex items-center gap-1 border-b border-border p-2">
        <ModeTab
          active={mode === "files"}
          onClick={() => setMode("files")}
          icon={<UploadCloud className="h-4 w-4" />}
          label="Upload files"
        />
        <ModeTab
          active={mode === "url"}
          onClick={() => setMode("url")}
          icon={<Link2 className="h-4 w-4" />}
          label="Paste a link"
        />
      </div>

      <div className="p-5 sm:p-6">
        {/* ── FILES MODE ── */}
        {mode === "files" && (
          <>
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
                <p className="text-base font-semibold">
                  Drag &amp; drop files here
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  or click to browse · images, PDF, video, audio, ZIP
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

            {/* hidden inputs */}
            <input
              ref={inputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => addFiles(e.target.files)}
            />
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
          </>
        )}

        {/* ── URL MODE ── */}
        {mode === "url" && (
          <div className="space-y-4">
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative flex-1">
                <Link2 className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="url"
                  placeholder="https://example.com/file.pdf or a public video link"
                  className="pl-9"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onBlur={() => url.trim() && runUrlDetection()}
                  disabled={busy}
                />
              </div>
              <Button
                variant="outline"
                onClick={runUrlDetection}
                disabled={!url.trim() || busy}
              >
                Check link
              </Button>
            </div>

            <div className="flex items-start gap-3 rounded-lg border border-border bg-secondary/40 p-3">
              <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  We only download content you’re allowed to keep. We don’t bypass
                  DRM, paywalls, logins, or private content.
                </p>
                <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-[hsl(var(--primary))]"
                    checked={confirmRights}
                    onChange={(e) => setConfirmRights(e.target.checked)}
                  />
                  I confirm I have the right to download this content.
                </label>
              </div>
            </div>
          </div>
        )}

        {/* ── OUTPUT SELECTION + PARAMS ── */}
        {phase === "ready" && outputs.length > 0 && (
          <div className="mt-6 space-y-4">
            <Separator />
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1 space-y-2">
                <label className="text-xs font-medium text-muted-foreground">
                  Output format
                </label>
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
                      <SelectItem key={o.id} value={o.id}>
                        {o.label}
                        {o.description ? (
                          <span className="text-muted-foreground">
                            {" "}
                            — {o.description}
                          </span>
                        ) : null}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                onClick={handleConvert}
                disabled={busy || !selectedOutputId}
                className="sm:w-40"
              >
                Convert <ArrowRight className="h-4 w-4" />
              </Button>
            </div>

            {selectedOption?.params && selectedOption.params.length > 0 && (
              <ParamControls
                specs={selectedOption.params as OutputParamSpec[]}
                values={params}
                onChange={(k, v) => setParams((p) => ({ ...p, [k]: v }))}
              />
            )}
          </div>
        )}

        {/* URL mode convert button (no dropdown until checked, but allow direct) */}
        {mode === "url" && phase === "ready" && (
          <div className="mt-4">
            <Button
              onClick={handleConvert}
              disabled={busy || !confirmRights || !url.trim()}
              className="w-full"
            >
              <Download className="h-4 w-4" /> Download
            </Button>
          </div>
        )}

        {/* ── DETECTING ── */}
        {phase === "detecting" && (
          <div className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Detecting input type…
          </div>
        )}

        {/* ── WORKING ── */}
        {phase === "working" && (
          <div className="mt-6 space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">
                {uploadPct < 100 && mode === "files"
                  ? "Uploading…"
                  : "Processing…"}
              </span>
              <StatusPill status={job?.status ?? "processing"} />
            </div>
            <Progress
              value={
                uploadPct < 100 && mode === "files"
                  ? uploadPct
                  : job?.progress ?? 10
              }
            />
            <p className="text-xs text-muted-foreground">
              {uploadPct < 100 && mode === "files"
                ? `Uploading ${uploadPct}%`
                : `Working ${job?.progress ?? 0}% — files auto-delete when done.`}
            </p>
          </div>
        )}

        {/* ── RESULT ── */}
        {showResult && job && (
          <div className="mt-6">
            <Separator className="mb-4" />
            {phase === "done" ? (
              <ResultPanel job={job} token={token} onReset={reset} />
            ) : (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
                <div className="mb-2 flex items-center gap-2">
                  <StatusPill status="failed" />
                </div>
                <p className="text-sm text-foreground">
                  {errorMsg || job.error || "Something went wrong."}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={reset}
                >
                  <RotateCcw className="h-4 w-4" /> Start over
                </Button>
              </div>
            )}
          </div>
        )}

        {/* inline error (pre-conversion) */}
        {phase === "error" && !job && errorMsg && (
          <div className="mt-6 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
            {errorMsg}
            <Button
              variant="ghost"
              size="sm"
              className="ml-2"
              onClick={reset}
            >
              Reset
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Subcomponents ────────────────────────────────────────────────────────────

function ModeTab({
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
        "inline-flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
        active
          ? "bg-secondary text-foreground"
          : "text-muted-foreground hover:bg-secondary/50",
      )}
    >
      {icon}
      {label}
    </button>
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
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">
          {files.length} file{files.length > 1 ? "s" : ""} ·{" "}
          <span className="text-muted-foreground">{formatBytes(total)}</span>
        </p>
      </div>
      <ul className="max-h-56 space-y-2 overflow-auto pr-1">
        {files.map((f, i) => (
          <li
            key={`${f.name}-${i}`}
            className="flex items-center gap-3 rounded-lg border border-border bg-background p-2.5"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-secondary text-muted-foreground">
              <FileIcon className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{f.name}</p>
              <p className="text-xs text-muted-foreground">
                {formatBytes(f.size)}
              </p>
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

function ResultPanel({
  job,
  token,
  onReset,
}: {
  job: PublicJob;
  token: string;
  onReset: () => void;
}) {
  const single = job.outputs.length === 1 && !job.bundleName;
  return (
    <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4">
      <div className="mb-3 flex items-center justify-between">
        <StatusPill status="completed" />
        <span className="text-xs text-muted-foreground">
          {job.bundleName
            ? "Bundled as ZIP"
            : `${job.outputs.length} file${job.outputs.length > 1 ? "s" : ""}`}
        </span>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <a href={downloadUrl(job.id, token)} className="flex-1" download>
          <Button className="w-full">
            <Download className="h-4 w-4" />
            {single
              ? `Download ${job.outputs[0].name}`
              : "Download result"}
          </Button>
        </a>
        <a href={`/jobs/${job.id}?token=${encodeURIComponent(token)}`}>
          <Button variant="outline" className="w-full sm:w-auto">
            View details
          </Button>
        </a>
        <Button variant="ghost" onClick={onReset} className="w-full sm:w-auto">
          <RotateCcw className="h-4 w-4" /> New
        </Button>
      </div>

      {job.outputs.length > 1 && (
        <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
          {job.outputs.slice(0, 6).map((o) => (
            <li key={o.name} className="flex justify-between">
              <span className="truncate">{o.name}</span>
              <span>{formatBytes(o.size)}</span>
            </li>
          ))}
          {job.outputs.length > 6 && (
            <li className="italic">+{job.outputs.length - 6} more…</li>
          )}
        </ul>
      )}
    </div>
  );
}

function sanitizeParams(
  params: Record<string, ParamValue>,
): Record<string, ParamValue> {
  const out: Record<string, ParamValue> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v === "" || v === undefined || v === null) continue;
    out[k] = v;
  }
  return out;
}
