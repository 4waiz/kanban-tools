"use client";

import { zip } from "fflate";
import { nanoid } from "nanoid";
import { detectType } from "./detect";
import { getAvailableOutputs, converterForOutput } from "./converters/registry";
import { sanitizeFilename } from "./security";
import type {
  ClientJob,
  DetectInput,
  OutputOption,
  OutputArtifact,
  ParamValue,
} from "./types";

/**
 * The client-side conversion engine. Everything runs in the browser:
 * detection, conversion (Canvas / pdf.js / ffmpeg.wasm / fflate), and bundling.
 * The UI talks only to this module — there is no server.
 */

export type { ClientJob } from "./types";

/** Detect the kind + available outputs for a set of files (no upload). */
export async function detectFiles(files: File[]): Promise<{
  kind: DetectInput["kind"];
  outputs: OutputOption[];
}> {
  if (files.length === 0) return { kind: "unknown", outputs: [] };
  const first = files[0];
  const head = new Uint8Array(await first.slice(0, 32).arrayBuffer());
  const det = detectType(first.name, first.type, head);
  const input: DetectInput = {
    kind: det.kind,
    mime: det.mime,
    ext: det.ext,
    fileCount: files.length,
  };
  const outputs = getAvailableOutputs(input);
  if (files.length > 1) {
    outputs.push({
      id: "archive:zip",
      label: `Bundle ${files.length} files to ZIP`,
      description: "Combine all selected files into a single ZIP archive",
      converter: "archive",
    });
  }
  return { kind: det.kind, outputs };
}

export interface RunHandlers {
  onProgress?: (pct: number) => void;
  onStatus?: (text: string) => void;
}

/**
 * Run a conversion fully in the browser. Returns a completed ClientJob with
 * in-memory Blob artifacts (and a zip bundle when there's more than one output).
 */
export async function runConversion(
  files: File[],
  outputId: string,
  params: Record<string, ParamValue>,
  handlers: RunHandlers = {},
): Promise<ClientJob> {
  const id = nanoid(12);
  const first = files[0];
  const head = first
    ? new Uint8Array(await first.slice(0, 32).arrayBuffer())
    : undefined;
  const det = first ? detectType(first.name, first.type, head) : null;

  const job: ClientJob = {
    id,
    status: "processing",
    createdAt: Date.now(),
    progress: 0,
    outputId,
    inputKind: det?.kind ?? "unknown",
    inputs: files.map((f) => ({ name: f.name, size: f.size, mime: f.type })),
    outputs: [],
  };

  const converter = converterForOutput(outputId);
  if (!converter) {
    job.status = "failed";
    job.error = `Unsupported output: ${outputId}`;
    return job;
  }

  try {
    const result = await converter.convert({
      files,
      outputId,
      params,
      onProgress: (p) => {
        job.progress = p;
        handlers.onProgress?.(p);
      },
      onStatus: (t) => {
        job.statusText = t;
        handlers.onStatus?.(t);
      },
    });

    job.outputs = result.outputs;

    // Bundle multiple outputs into one ZIP (unless the converter already
    // produced a single zip itself).
    const alreadyZip =
      result.outputs.length === 1 && result.outputs[0].mime === "application/zip";
    if (result.outputs.length > 1 && !alreadyZip) {
      job.bundle = await bundleOutputs(result.outputs);
    }

    job.status = "completed";
    job.progress = 100;
    return job;
  } catch (err) {
    job.status = "failed";
    job.error = err instanceof Error ? err.message : "Conversion failed.";
    return job;
  }
}

/** Zip a set of artifacts into one downloadable bundle. */
async function bundleOutputs(outputs: OutputArtifact[]): Promise<OutputArtifact> {
  const entries: Record<string, Uint8Array> = {};
  for (const o of outputs) {
    const bytes = new Uint8Array(await o.blob.arrayBuffer());
    let name = sanitizeFilename(o.name);
    let n = 1;
    while (name in entries) {
      const dot = name.lastIndexOf(".");
      name =
        dot > 0
          ? `${name.slice(0, dot)}-${n}${name.slice(dot)}`
          : `${name}-${n}`;
      n++;
    }
    entries[name] = bytes;
  }
  const zipped = await new Promise<Uint8Array>((resolve, reject) =>
    zip(entries, { level: 9 }, (e, d) => (e ? reject(e) : resolve(d))),
  );
  const blob = new Blob([zipped.slice().buffer], { type: "application/zip" });
  return {
    name: "kanban-tools-result.zip",
    blob,
    mime: "application/zip",
    size: blob.size,
  };
}

/** The single file a "Download" button should serve for a finished job. */
export function downloadTarget(job: ClientJob): OutputArtifact | null {
  if (job.bundle) return job.bundle;
  if (job.outputs.length === 1) return job.outputs[0];
  if (job.outputs.length > 1) return job.outputs[0]; // fallback; UI lists the rest
  return null;
}

/** Trigger a browser download for a Blob artifact. */
export function saveArtifact(artifact: OutputArtifact): void {
  const url = URL.createObjectURL(artifact.blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = artifact.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke after a tick so the download can start.
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
