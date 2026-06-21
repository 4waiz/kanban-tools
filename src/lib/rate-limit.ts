import { config } from "./config";

/**
 * Minimal in-memory sliding-window rate limiter, keyed by client identifier
 * (IP address). Suitable for a single-instance MVP.
 *
 * PRODUCTION UPGRADE: replace the Map with Redis (INCR + EXPIRE) so limits hold
 * across multiple instances, and key by authenticated user id where available.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

// Opportunistic cleanup so the Map doesn't grow unbounded.
let lastSweep = 0;
function sweep(now: number) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, b] of buckets) {
    if (b.resetAt <= now) buckets.delete(key);
  }
}

export interface RateLimitResult {
  ok: boolean;
  /** Requests remaining in the current window. */
  remaining: number;
  /** Epoch ms when the window resets. */
  resetAt: number;
  /** Seconds the client should wait before retrying (when blocked). */
  retryAfter: number;
}

export function rateLimit(
  key: string,
  opts?: { windowMs?: number; max?: number },
): RateLimitResult {
  const windowMs = opts?.windowMs ?? config.rateLimit.windowMs;
  const max = opts?.max ?? config.rateLimit.max;
  const now = Date.now();
  sweep(now);

  let b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    b = { count: 0, resetAt: now + windowMs };
    buckets.set(key, b);
  }

  b.count += 1;
  const remaining = Math.max(0, max - b.count);
  const ok = b.count <= max;
  return {
    ok,
    remaining,
    resetAt: b.resetAt,
    retryAfter: ok ? 0 : Math.ceil((b.resetAt - now) / 1000),
  };
}

/** Best-effort client IP from a Next.js request's headers. */
export function clientKey(req: Request): string {
  const h = req.headers;
  const fwd = h.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return (
    h.get("x-real-ip") ||
    h.get("cf-connecting-ip") ||
    "local"
  );
}

/**
 * A stable, non-reversible client identifier derived from the IP. Used to tag
 * jobs for per-client concurrency limits without persisting raw IP addresses.
 */
export function hashedClientKey(req: Request): string {
  // Lightweight FNV-1a hash — we only need a stable opaque bucket id, not crypto.
  const ip = clientKey(req);
  let h = 0x811c9dc5;
  for (let i = 0; i < ip.length; i++) {
    h ^= ip.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return "c_" + (h >>> 0).toString(16);
}
