import { guard, capacityGuard, json, errorJson, withRequestId } from "@/lib/api";
import { config } from "@/lib/config";
import { validatePublicUrl } from "@/lib/security";
import { createJob, updateJob, publicJob } from "@/lib/jobs";
import { enqueueJob, QueueFullError } from "@/lib/runner";
import type { InputFileInfo } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/link
 * Body: { url, confirmed }
 * Creates a "link" job and enqueues the download. Requires the explicit rights
 * confirmation; refuses without it. See src/lib/converters/link.ts for the
 * legal/safety posture (no DRM/login/private content, no access-control bypass).
 */
export async function POST(req: Request) {
  const g = guard(req);
  if ("response" in g) return g.response;
  const { ctx } = g;

  if (!config.link.enabled) {
    return withRequestId(
      errorJson("The link downloader is disabled on this server.", 403),
      ctx.requestId,
    );
  }

  const cap = await capacityGuard(ctx);
  if (cap) return cap;

  let body: { url?: string; confirmed?: boolean };
  try {
    body = await req.json();
  } catch {
    return withRequestId(errorJson("Invalid JSON body."), ctx.requestId);
  }

  const url = String(body.url ?? "").trim();
  const check = validatePublicUrl(url);
  if (!check.ok)
    return withRequestId(
      errorJson(check.reason ?? "Invalid URL."),
      ctx.requestId,
    );

  // Hard requirement: the rights confirmation checkbox.
  if (body.confirmed !== true) {
    return withRequestId(
      errorJson(
        "You must confirm you have the right to download this content.",
        403,
      ),
      ctx.requestId,
    );
  }

  // A link job has a synthetic input describing the URL.
  const inputs: InputFileInfo[] = [
    {
      storedName: "link",
      originalName: check.url!.toString(),
      mime: "text/uri-list",
      ext: "",
      size: 0,
    },
  ];
  const job = await createJob({
    inputs,
    inputKind: "link",
    clientKey: ctx.clientKey,
  });
  await updateJob(job.id, {
    outputId: "link:download",
    params: { url: check.url!.toString(), confirmed: true },
    status: "pending",
  });

  try {
    void enqueueJob(job.id).catch(() => {
      /* terminal errors recorded on the job */
    });
  } catch (err) {
    if (err instanceof QueueFullError) {
      await updateJob(job.id, { status: "failed", error: err.message });
      return withRequestId(errorJson(err.message, 503), ctx.requestId);
    }
    throw err;
  }

  ctx.log.info("link.enqueued", { jobId: job.id, host: check.url!.hostname });

  return withRequestId(
    json({ job: publicJob(job), token: job.token }),
    ctx.requestId,
  );
}
