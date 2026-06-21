import { guard, json, errorJson } from "@/lib/api";
import { getAuthorizedJob, updateJob, publicJob } from "@/lib/jobs";
import { converterForOutput } from "@/lib/converters/registry";
import { runJob } from "@/lib/runner";
import { isValidJobId } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/convert
 * Body: { jobId, token, outputId, params? }
 * Authorizes the job, records the chosen operation + params, and kicks off the
 * conversion in the background. The client then polls /api/jobs/:id.
 */
export async function POST(req: Request) {
  const limited = guard(req);
  if (limited) return limited;

  let body: {
    jobId?: string;
    token?: string;
    outputId?: string;
    params?: Record<string, string | number | boolean>;
  };
  try {
    body = await req.json();
  } catch {
    return errorJson("Invalid JSON body.");
  }

  const { jobId, token, outputId, params } = body;
  if (!jobId || !isValidJobId(jobId)) return errorJson("Invalid job id.");
  if (!outputId) return errorJson("No output format selected.");

  const job = await getAuthorizedJob(jobId, token);
  if (!job) return errorJson("Job not found or not authorized.", 404);

  if (job.status === "processing") {
    return errorJson("This job is already processing.", 409);
  }

  const converter = converterForOutput(outputId);
  if (!converter) {
    return errorJson(`Unsupported output format: ${outputId}`);
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

  // Fire-and-forget. Errors are captured inside runJob and reflected in status.
  // PRODUCTION UPGRADE: enqueue instead of running in the request process.
  void runJob(jobId);

  const updated = await getAuthorizedJob(jobId, token);
  return json({ job: updated ? publicJob(updated) : null });
}
