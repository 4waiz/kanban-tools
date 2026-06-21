"use client";

import type { Job, OutputOption, InputKind } from "./types";

/**
 * Typed client for the conversion API. Thin wrappers over fetch with consistent
 * error handling. Used by the UI; never imported on the server.
 */

export type PublicJob = Omit<Job, "token">;

export interface DetectResponse {
  kind: InputKind;
  mime?: string;
  ext?: string;
  outputs: OutputOption[];
}

async function asError(res: Response): Promise<string> {
  try {
    const data = await res.json();
    return data?.error || `Request failed (${res.status})`;
  } catch {
    return `Request failed (${res.status})`;
  }
}

export async function detectFiles(
  files: { name: string; type?: string; size?: number }[],
): Promise<DetectResponse> {
  const res = await fetch("/api/detect", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ files }),
  });
  if (!res.ok) throw new Error(await asError(res));
  return res.json();
}

export async function detectUrl(url: string): Promise<DetectResponse> {
  const res = await fetch("/api/detect", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) throw new Error(await asError(res));
  return res.json();
}

export async function uploadFiles(
  files: File[],
  onProgress?: (pct: number) => void,
): Promise<{ job: PublicJob; token: string }> {
  // Use XHR for upload progress (fetch lacks an upload progress event).
  return new Promise((resolve, reject) => {
    const form = new FormData();
    for (const f of files) form.append("file", f, f.name);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch {
          reject(new Error("Malformed server response."));
        }
      } else {
        try {
          reject(new Error(JSON.parse(xhr.responseText).error || "Upload failed."));
        } catch {
          reject(new Error(`Upload failed (${xhr.status}).`));
        }
      }
    };
    xhr.onerror = () => reject(new Error("Network error during upload."));
    xhr.send(form);
  });
}

export async function startConvert(
  jobId: string,
  token: string,
  outputId: string,
  params?: Record<string, string | number | boolean>,
): Promise<PublicJob> {
  const res = await fetch("/api/convert", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jobId, token, outputId, params }),
  });
  if (!res.ok) throw new Error(await asError(res));
  const data = await res.json();
  return data.job;
}

export async function startLinkDownload(
  url: string,
  confirmed: boolean,
): Promise<{ job: PublicJob; token: string }> {
  const res = await fetch("/api/link", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url, confirmed }),
  });
  if (!res.ok) throw new Error(await asError(res));
  return res.json();
}

export async function fetchJob(jobId: string, token: string): Promise<PublicJob> {
  const res = await fetch(
    `/api/jobs/${encodeURIComponent(jobId)}?token=${encodeURIComponent(token)}`,
    { cache: "no-store" },
  );
  if (!res.ok) throw new Error(await asError(res));
  const data = await res.json();
  return data.job;
}

export async function deleteJobRequest(
  jobId: string,
  token: string,
): Promise<boolean> {
  const res = await fetch(
    `/api/jobs/${encodeURIComponent(jobId)}?token=${encodeURIComponent(token)}`,
    { method: "DELETE" },
  );
  if (!res.ok) throw new Error(await asError(res));
  const data = await res.json();
  return !!data.ok;
}

export function downloadUrl(
  jobId: string,
  token: string,
  file?: string,
): string {
  const base = `/api/jobs/${encodeURIComponent(jobId)}/download?token=${encodeURIComponent(token)}`;
  return file ? `${base}&file=${encodeURIComponent(file)}` : base;
}

export interface Capabilities {
  tools: Record<string, boolean>;
  limits: { maxFileSizeMb: number; jobTtlMinutes: number };
}

export async function fetchCapabilities(): Promise<Capabilities> {
  const res = await fetch("/api/capabilities", { cache: "no-store" });
  if (!res.ok) throw new Error(await asError(res));
  return res.json();
}

/**
 * Poll a job until it reaches a terminal state or the signal aborts.
 * Calls onUpdate on every tick.
 */
export async function pollJob(
  jobId: string,
  token: string,
  onUpdate: (job: PublicJob) => void,
  signal?: AbortSignal,
): Promise<PublicJob> {
  let delay = 600;
  for (;;) {
    if (signal?.aborted) throw new Error("aborted");
    const job = await fetchJob(jobId, token);
    onUpdate(job);
    if (job.status === "completed" || job.status === "failed") return job;
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(2000, Math.round(delay * 1.25)); // gentle backoff
  }
}
