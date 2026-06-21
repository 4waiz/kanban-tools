import { guard, json, errorJson, withRequestId } from "@/lib/api";
import { getAuthorizedJob, updateJob, publicJob } from "@/lib/jobs";
import { converterForOutput } from "@/lib/converters/registry";
import { enqueueJob, QueueFullError } from "@/lib/runner";
import { isValidJobId } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/convert
 * Body: { jobId, token, outputId, params? }
 * Authorizes the job, records the chosen operation + params, and enqueues the
 * conversion on the bounded worker pool. The client then polls /api/jobs/:id.
 */
export async function POST(req: Request) {
  const g = guard(req);
  if ("response" in g) return g.response;
  const { ctx } = g;

  let body: {
    jobId?: string;
    token?: string;
    outputId?: string;
    params?: Record<string, string | number | boolean>;
  };
  try {
    body = await req.json();
  } catch {
    return withRequestId(errorJson("Invalid JSON body."), ctx.requestId);
  }

  const { jobId, token, outputId, params } = body;
  if (!jobId || !isValidJobId(jobId))
    return withRequestId(errorJson("Invalid job id."), ctx.requestId);
  if (!outputId)
    return withRequestId(errorJson("No output format selected."), ctx.requestId);

  const job = await getAuthorizedJob(jobId, token);
  if (!job)
    return withRequestId(
      errorJson("Job not found or not authorized.", 404),
      ctx.requestId,
    );

  if (job.status === "processing") {
    return withRequestId(
      errorJson("This job is already processing.", 409),
      ctx.requestId,
    );
  }

  const converter = converterForOutput(outputId);
  if (!converter) {
    return withRequestId(
      errorJson(`Unsupported output format: ${outputId}`),
      ctx.requestId,
    );
  }

  // Merge sanitized params (numbers/strings/booleans only).
  const safeParams: Record<string, string | number | boolean> = {
    ...job.params,
  };
  if (params && typeof params === "object") {
    for (const [k, v] of Object.entries(params)) {
      if (
        typeof v === "string" ||
        typeof v === "number" ||
        typeof v === "boolean"
      ) {
        safeParams[k] = v;
      }
    }
  }

  await updateJob(jobId, {
    outputId,
    params: safeParams,
    status: "pending",
    progress: 0,
    error: undefined,
    outputs: [],
    bundleName: undefined,
  });

  // Enqueue on the bounded pool. If the backlog is full, fail fast with 503.
  try {
    void enqueueJob(jobId).catch(() => {
      /* terminal errors are recorded on the job by the runner */
    });
  } catch (err) {
    if (err instanceof QueueFullError) {
      await updateJob(jobId, { status: "failed", error: err.message });
      return withRequestId(errorJson(err.message, 503), ctx.requestId);
    }
    throw err;
  }

  ctx.log.info("convert.enqueued", { jobId, outputId });

  const updated = await getAuthorizedJob(jobId, token);
  return withRequestId(
    json({ job: updated ? publicJob(updated) : null }),
    ctx.requestId,
  );
}
