import { promises as fs } from "node:fs";
import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { safeJoin } from "@/lib/security";
import { queueStats } from "@/lib/runner";
import { getTotalDiskUsage } from "@/lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/ready - readiness probe.
 * Verifies the service can actually do work right now: the jobs directory is
 * writable, and we have disk headroom. Returns 503 when not ready so a load
 * balancer can drain this instance. Also reports queue depth for observability.
 */
export async function GET() {
  const checks: Record<string, boolean> = {};
  let ready = true;

  // 1. Jobs dir is writable.
  try {
    await fs.mkdir(config.jobsDir, { recursive: true });
    const probe = safeJoin(config.jobsDir, ".readycheck");
    await fs.writeFile(probe, String(Date.now()));
    await fs.rm(probe, { force: true });
    checks.diskWritable = true;
  } catch {
    checks.diskWritable = false;
    ready = false;
  }

  // 2. Disk headroom.
  let diskUsed = 0;
  try {
    diskUsed = await getTotalDiskUsage();
    checks.diskHeadroom = diskUsed < config.limits.maxTotalDiskBytes;
    if (!checks.diskHeadroom) ready = false;
  } catch {
    checks.diskHeadroom = true; // best-effort; don't fail readiness on a scan error
  }

  const body = {
    status: ready ? "ready" : "not_ready",
    checks,
    queue: queueStats(),
    diskUsedBytes: diskUsed,
  };

  return NextResponse.json(body, {
    status: ready ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
