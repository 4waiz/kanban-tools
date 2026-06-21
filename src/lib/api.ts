import "server-only";
import { NextResponse } from "next/server";
import { rateLimit, clientKey } from "./rate-limit";
import { ensureCleanupWorker } from "./cleanup";

/**
 * Shared helpers for route handlers: JSON responses, rate limiting, and ensuring
 * the cleanup worker is running. Keep route handlers thin and consistent.
 */

export function json(data: unknown, init?: ResponseInit): NextResponse {
  return NextResponse.json(data, init);
}

export function errorJson(message: string, status = 400): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

/**
 * Call at the top of every route. Starts the cleanup worker (idempotent) and
 * applies rate limiting. Returns a 429 response to short-circuit if limited,
 * otherwise null to proceed.
 */
export function guard(req: Request): NextResponse | null {
  ensureCleanupWorker();
  const key = clientKey(req);
  const rl = rateLimit(key);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many requests. Please slow down." },
      {
        status: 429,
        headers: {
          "Retry-After": String(rl.retryAfter),
          "X-RateLimit-Remaining": String(rl.remaining),
        },
      },
    );
  }
  return null;
}
