import { guard, json, errorJson } from "@/lib/api";
import { config } from "@/lib/config";
import { validatePublicUrl } from "@/lib/security";
import { createJob, updateJob, publicJob } from "@/lib/jobs";
import { runJob } from "@/lib/runner";
import type { InputFileInfo } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/link
 * Body: { url, confirmed }
 * Creates a "link" job and starts the download. Requires the explicit rights
 * confirmation; refuses without it. See src/lib/converters/link.ts for the
 * legal/safety posture (no DRM/login/private content, no access-control bypass).
 */
export async function POST(req: Request) {
  const limited = guard(req);
  if (limited) return limited;

  if (!config.link.enabled) {
    return errorJson("The link downloader is disabled on this server.", 403);
  }

  let body: { url?: string; confirmed?: boolean };
  try {
    body = await req.json();
  } catch {
    return errorJson("Invalid JSON body.");
  }

  const url = String(body.url ?? "").trim();
  const check = validatePublicUrl(url);
  if (!check.ok) return errorJson(check.reason ?? "Invalid URL.");

  // Hard requirement: the rights confirmation checkbox.
  if (body.confirmed !== true) {
    return errorJson(
      "You must confirm you have the right to download this content.",
      403,
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
  const job = await createJob({ inputs, inputKind: "link" });
  await updateJob(job.id, {
    outputId: "link:download",
    params: { url: check.url!.toString(), confirmed: true },
    status: "pending",
  });

  void runJob(job.id);

  const started = await updateJob(job.id, {});
  return json({
    job: started ? publicJob(started) : publicJob(job),
    token: job.token,
  });
}
