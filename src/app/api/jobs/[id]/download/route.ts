import { promises as fs, createReadStream } from "node:fs";
import { guard, errorJson, withRequestId } from "@/lib/api";
import { getAuthorizedJob, outputDirFor } from "@/lib/jobs";
import { resolveDownloadName } from "@/lib/runner";
import { isValidJobId, safeJoin, sanitizeFilename } from "@/lib/security";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { Readable } from "node:stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/jobs/:id/download?token=...[&file=NAME]
 *
 * Streams the job's result. By default serves the resolved single output (or the
 * auto-generated bundle for multi-output jobs). An optional `file` selects a
 * specific output by name (validated against the job's recorded outputs and
 * resolved safely inside the output dir).
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const g = guard(req);
  if ("response" in g) return g.response;
  const { ctx } = g;

  const { id } = await params;
  if (!isValidJobId(id))
    return withRequestId(errorJson("Invalid job id.", 400), ctx.requestId);

  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  const requestedFile = url.searchParams.get("file");

  const job = await getAuthorizedJob(id, token);
  if (!job)
    return withRequestId(
      errorJson("Job not found or not authorized.", 404),
      ctx.requestId,
    );
  if (job.status !== "completed") {
    return withRequestId(
      errorJson("This job has no downloadable result yet.", 409),
      ctx.requestId,
    );
  }

  // Determine which file to serve.
  let name: string | null;
  if (requestedFile) {
    // Only allow names that are actually recorded outputs (or the bundle).
    const allowed = new Set<string>([
      ...job.outputs.map((o) => o.name),
      ...(job.bundleName ? [job.bundleName] : []),
    ]);
    const safe = sanitizeFilename(requestedFile);
    name = allowed.has(safe) ? safe : null;
    if (!name) return errorJson("Requested file is not part of this job.", 404);
  } else {
    name = resolveDownloadName(job);
  }

  if (!name) return errorJson("No downloadable file for this job.", 404);

  const outDir = outputDirFor(id);
  let filePath: string;
  try {
    filePath = safeJoin(outDir, name);
  } catch {
    return errorJson("Invalid file path.", 400);
  }

  const stat = await fs.stat(filePath).catch(() => null);
  if (!stat || !stat.isFile()) {
    return errorJson("The result file is no longer available.", 410);
  }

  // Pick a content type from the recorded outputs, defaulting to octet-stream.
  const mime =
    job.outputs.find((o) => o.name === name)?.mime ||
    (name === job.bundleName ? "application/zip" : "application/octet-stream");

  const nodeStream = createReadStream(filePath);
  const webStream = Readable.toWeb(nodeStream) as unknown as WebReadableStream<Uint8Array>;

  ctx.log.info("job.download", { jobId: id, file: name, bytes: stat.size });

  return new Response(webStream as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": mime,
      "Content-Length": String(stat.size),
      "Content-Disposition": `attachment; filename="${encodeURIComponent(name)}"`,
      "Cache-Control": "no-store",
      "X-Request-Id": ctx.requestId,
    },
  });
}
