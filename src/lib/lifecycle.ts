import "server-only";
import { config } from "./config";
import { logger } from "./logger";
import { sweepExpiredJobs, recoverInterruptedJobs } from "./jobs";
import { drainQueue } from "./runner";

/**
 * Process lifecycle: startup tasks and graceful shutdown.
 *
 * Invoked once from `instrumentation.ts` (Next.js's server-bootstrap hook), so
 * everything here runs a single time per process - not lazily per request as the
 * first version did. Idempotent via a globalThis guard to survive dev reloads.
 *
 * Startup:
 *  1. Recover jobs interrupted by a previous crash (mark stuck → failed).
 *  2. Run an initial cleanup sweep, then schedule it on an interval.
 *
 * Shutdown (SIGTERM/SIGINT):
 *  - Stop accepting new work and let in-flight conversions finish within a grace
 *    window before exiting, so a deploy/restart doesn't kill active jobs.
 */

const GLOBAL_KEY = "__kanban_lifecycle__";

interface LifecycleState {
  started: boolean;
  cleanupTimer?: NodeJS.Timeout;
  shuttingDown: boolean;
}

function state(): LifecycleState {
  const g = globalThis as unknown as Record<string, LifecycleState | undefined>;
  if (!g[GLOBAL_KEY]) g[GLOBAL_KEY] = { started: false, shuttingDown: false };
  return g[GLOBAL_KEY]!;
}

export async function startup(): Promise<void> {
  const s = state();
  if (s.started) return;
  s.started = true;

  logger.info("server.startup", {
    jobsDir: config.jobsDir,
    concurrency: config.worker.concurrency,
    maxFileSizeMb: config.maxFileSizeMb,
    jobTtlMinutes: Math.round(config.jobTtlMs / 60000),
  });

  // 1. Crash recovery.
  try {
    await recoverInterruptedJobs();
  } catch (err) {
    logger.error("server.recovery_failed", { err });
  }

  // 2. Cleanup worker.
  const sweep = async () => {
    try {
      const removed = await sweepExpiredJobs();
      if (removed > 0) logger.info("cleanup.swept", { removed });
    } catch (err) {
      logger.error("cleanup.failed", { err });
    }
  };
  void sweep();
  s.cleanupTimer = setInterval(sweep, config.cleanupIntervalMs);
  s.cleanupTimer.unref?.();

  // 3. Shutdown handlers.
  registerShutdown();
}

function registerShutdown(): void {
  const handle = (signal: NodeJS.Signals) => {
    void shutdown(signal);
  };
  // Avoid duplicate listeners across hot reloads.
  process.removeAllListeners("SIGTERM");
  process.removeAllListeners("SIGINT");
  process.on("SIGTERM", handle);
  process.on("SIGINT", handle);
}

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  const s = state();
  if (s.shuttingDown) return;
  s.shuttingDown = true;
  logger.info("server.shutdown_begin", { signal });

  if (s.cleanupTimer) clearInterval(s.cleanupTimer);

  const drained = await drainQueue(config.worker.shutdownGraceMs);
  logger.info("server.shutdown_complete", { drained });

  // Give logs a tick to flush, then exit.
  setTimeout(() => process.exit(0), 50).unref?.();
}
