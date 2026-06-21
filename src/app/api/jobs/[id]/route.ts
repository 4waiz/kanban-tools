import { guard, json, errorJson, withRequestId } from "@/lib/api";
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
  const g = guard(req);
  if ("response" in g) return g.response;
  const { ctx } = g;

  const { id } = await params;
  if (!isValidJobId(id))
    return withRequestId(errorJson("Invalid job id.", 400), ctx.requestId);

  const token = new URL(req.url).searchParams.get("token");
  const job = await getAuthorizedJob(id, token);
  if (!job)
    return withRequestId(
      errorJson("Job not found or not authorized.", 404),
      ctx.requestId,
    );

  return withRequestId(json({ job: publicJob(job) }), ctx.requestId);
}

/**
 * DELETE /api/jobs/:id?token=...
 * Deletes the job and all of its files. Token-gated.
 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const g = guard(req);
  if ("response" in g) return g.response;
  const { ctx } = g;

  const { id } = await params;
  if (!isValidJobId(id))
    return withRequestId(errorJson("Invalid job id.", 400), ctx.requestId);

  const token = new URL(req.url).searchParams.get("token");
  const job = await getAuthorizedJob(id, token);
  if (!job)
    return withRequestId(
      errorJson("Job not found or not authorized.", 404),
      ctx.requestId,
    );

  const ok = await deleteJob(id);
  ctx.log.info("job.deleted", { jobId: id, ok });
  return withRequestId(json({ ok }), ctx.requestId);
}
