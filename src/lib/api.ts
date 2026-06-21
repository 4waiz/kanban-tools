import "server-only";
import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { rateLimit, clientKey, hashedClientKey } from "./rate-limit";
import { ensureCleanupWorker } from "./cleanup";
import { config } from "./config";
import { logger } from "./logger";
import { countActiveJobsForClient, getTotalDiskUsage } from "./jobs";

/**
 * Shared helpers for route handlers: JSON responses, rate limiting, capacity
 * guards, request-id propagation, and ensuring startup ran. Keeps handlers thin
 * and consistent.
 */

export function json(data: unknown, init?: ResponseInit): NextResponse {
  return NextResponse.json(data, init);
}

export function errorJson(message: string, status = 400): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

export interface RequestContext {
  requestId: string;
  clientIp: string;
  clientKey: string;
  log: ReturnType<typeof logger.child>;
}

/**
 * Call at the top of every route. Ensures startup ran, applies rate limiting,
 * and returns either a short-circuit response (rate-limited) or a per-request
 * context (request id, client key, scoped logger).
 */
export function guard(
  req: Request,
): { response: NextResponse } | { ctx: RequestContext } {
  ensureCleanupWorker();
  const requestId = req.headers.get("x-request-id") || nanoid(12);
  const clientIp = clientKey(req);
  const ck = hashedClientKey(req);
  const log = logger.child({ requestId, route: new URL(req.url).pathname });

  const rl = rateLimit(clientIp);
  if (!rl.ok) {
    log.warn("ratelimit.blocked", { retryAfter: rl.retryAfter });
    return {
      response: NextResponse.json(
        { error: "Too many requests. Please slow down." },
        {
          status: 429,
          headers: {
            "Retry-After": String(rl.retryAfter),
            "X-RateLimit-Remaining": String(rl.remaining),
            "X-Request-Id": requestId,
          },
        },
      ),
    };
  }

  return { ctx: { requestId, clientIp, clientKey: ck, log } };
}

/**
 * Capacity guard for job-creating routes (upload, link). Enforces the per-client
 * active-job cap and the global disk-usage quota. Returns a response to
 * short-circuit, or null to proceed.
 */
export async function capacityGuard(
  ctx: RequestContext,
): Promise<NextResponse | null> {
  // Per-client concurrency.
  const active = countActiveJobsForClient(ctx.clientKey);
  if (active >= config.limits.maxJobsPerClient) {
    ctx.log.warn("capacity.client_limit", { active });
    return NextResponse.json(
      {
        error: `You have ${active} jobs in progress. Please wait for them to finish.`,
      },
      { status: 429, headers: { "X-Request-Id": ctx.requestId } },
    );
  }

  // Global disk quota.
  try {
    const used = await getTotalDiskUsage();
    if (used >= config.limits.maxTotalDiskBytes) {
      ctx.log.error("capacity.disk_full", { used });
      return NextResponse.json(
        { error: "The server is at capacity. Please try again later." },
        { status: 503, headers: { "X-Request-Id": ctx.requestId } },
      );
    }
  } catch {
    /* disk check is best-effort */
  }

  return null;
}

/** Attach the request id to an outgoing response (chainable). */
export function withRequestId(res: NextResponse, requestId: string): NextResponse {
  res.headers.set("X-Request-Id", requestId);
  return res;
}
