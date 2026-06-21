import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/health — liveness probe.
 * Cheap and dependency-free: if the process can serve this, it's alive. Use for
 * container/orchestrator liveness checks (restart on failure).
 */
export function GET() {
  return NextResponse.json(
    { status: "ok", uptime: Math.round(process.uptime()) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
