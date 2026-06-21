import "server-only";
import { config } from "./config";
import { sweepExpiredJobs } from "./jobs";

/**
 * Background cleanup worker.
 *
 * Auto-deletes expired job files on an interval. Started lazily and exactly once
 * per server process via `ensureCleanupWorker()`, which every API route calls.
 *
 * PRODUCTION UPGRADE: in a multi-instance deployment this belongs in a single
 * dedicated worker / cron job (or object-store lifecycle rules), not in every
 * web instance. The `globalThis` guard keeps it to one timer even across Next.js
 * dev hot-reloads.
 */

const GLOBAL_KEY = "__kanban_cleanup_worker__";

interface WorkerState {
  started: boolean;
  timer?: NodeJS.Timeout;
}

function state(): WorkerState {
  const g = globalThis as unknown as Record<string, WorkerState | undefined>;
  if (!g[GLOBAL_KEY]) g[GLOBAL_KEY] = { started: false };
  return g[GLOBAL_KEY]!;
}

export function ensureCleanupWorker(): void {
  const s = state();
  if (s.started) return;
  s.started = true;

  // Run one sweep shortly after boot, then on the configured interval.
  const run = async () => {
    try {
      const removed = await sweepExpiredJobs();
      if (removed > 0) {
        // eslint-disable-next-line no-console
        console.log(`[cleanup] removed ${removed} expired job(s)`);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[cleanup] sweep failed:", err);
    }
  };

  // Kick off an initial sweep without blocking the request path.
  void run();

  s.timer = setInterval(run, config.cleanupIntervalMs);
  // Don't keep the process alive solely for cleanup.
  s.timer.unref?.();
}
