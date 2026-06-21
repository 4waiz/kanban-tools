import { guard, json, errorJson } from "@/lib/api";
import { getAuthorizedJob, deleteJob, publicJob } from "@/lib/jobs";
import { isValidJobId } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/jobs/:id?token=...
 * Returns the public job record (status, progress, outputs). Token-gated so a
 * job id alone can't read someone else's job.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const limited = guard(req);
  if (limited) return limited;

  const { id } = await params;
  if (!isValidJobId(id)) return errorJson("Invalid job id.", 400);

  const token = new URL(req.url).searchParams.get("token");
  const job = await getAuthorizedJob(id, token);
  if (!job) return errorJson("Job not found or not authorized.", 404);

  return json({ job: publicJob(job) });
}

/**
 * DELETE /api/jobs/:id?token=...
 * Deletes the job and all of its files. Token-gated.
 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const limited = guard(req);
  if (limited) return limited;

  const { id } = await params;
  if (!isValidJobId(id)) return errorJson("Invalid job id.", 400);

  const token = new URL(req.url).searchParams.get("token");
  const job = await getAuthorizedJob(id, token);
  if (!job) return errorJson("Job not found or not authorized.", 404);

  const ok = await deleteJob(id);
  return json({ ok });
}
