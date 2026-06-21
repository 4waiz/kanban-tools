import { promises as fs } from "node:fs";
import { guard, json, errorJson } from "@/lib/api";
import { config } from "@/lib/config";
import { sanitizeFilename, safeJoin } from "@/lib/security";
import { detectType } from "@/lib/detect";
import { createJob, inputDirFor, publicJob } from "@/lib/jobs";
import type { InputFileInfo, InputKind } from "@/lib/types";

export const runtime = "nodejs";
// Uploads can be large; never try to statically optimize this.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/upload  (multipart/form-data)
 * Fields:
 *   file: one or more File parts
 * Creates a job, writes the (sanitized) files into its isolated input dir, and
 * returns the public job plus the per-job token the client must keep.
 */
export async function POST(req: Request) {
  const limited = guard(req);
  if (limited) return limited;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return errorJson("Expected multipart/form-data with file parts.");
  }

  const parts = form.getAll("file").filter((p): p is File => p instanceof File);
  if (parts.length === 0) {
    return errorJson("No files were uploaded.");
  }

  // Enforce the aggregate size limit before writing anything.
  let totalSize = 0;
  for (const f of parts) totalSize += f.size;
  if (totalSize > config.maxFileSizeBytes) {
    return errorJson(
      `Upload exceeds the ${config.maxFileSizeMb} MB limit.`,
      413,
    );
  }

  // Detect the primary kind from the first file (using magic bytes).
  const firstBuf = Buffer.from(await parts[0].slice(0, 32).arrayBuffer());
  const firstDet = detectType(parts[0].name, parts[0].type, firstBuf);

  // For a single file, the job kind is its detected kind. For multiple files we
  // keep the first file's kind but the UI also offers "bundle to ZIP".
  const inputKind: InputKind = firstDet.kind;

  // Build the input file list with unique, sanitized stored names.
  const inputs: InputFileInfo[] = [];
  const usedNames = new Set<string>();
  for (const f of parts) {
    let stored = sanitizeFilename(f.name || "file");
    // Ensure uniqueness within the job.
    let candidate = stored;
    let n = 1;
    while (usedNames.has(candidate)) {
      const dot = stored.lastIndexOf(".");
      candidate =
        dot > 0
          ? `${stored.slice(0, dot)}-${n}${stored.slice(dot)}`
          : `${stored}-${n}`;
      n++;
    }
    stored = candidate;
    usedNames.add(stored);

    const head = Buffer.from(await f.slice(0, 32).arrayBuffer());
    const det = detectType(f.name, f.type, head);
    inputs.push({
      storedName: stored,
      originalName: f.name || stored,
      mime: det.mime,
      ext: det.ext,
      size: f.size,
    });
  }

  // Create the job (also makes input/ and output/ dirs).
  const job = await createJob({ inputs, inputKind });

  // Stream each file to disk inside the job's input dir.
  const inDir = inputDirFor(job.id);
  for (let i = 0; i < parts.length; i++) {
    const f = parts[i];
    const dest = safeJoin(inDir, inputs[i].storedName);
    const buf = Buffer.from(await f.arrayBuffer());
    await fs.writeFile(dest, buf);
  }

  return json({
    job: publicJob(job),
    token: job.token,
  });
}
