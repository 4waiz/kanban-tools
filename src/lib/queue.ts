import "server-only";
import { logger } from "./logger";

/**
 * Bounded in-process work queue with a fixed-size worker pool.
 *
 * Why this exists: the MVP ran conversions fire-and-forget in the request
 * handler, so N concurrent uploads could spawn N FFmpeg/Sharp processes and
 * exhaust CPU/RAM. This queue caps concurrency and bounds the backlog, giving
 * predictable resource usage on a single node - the standard pattern before you
 * reach for an external queue (Redis/BullMQ) at multi-node scale.
 *
 * Guarantees:
 *  - At most `concurrency` tasks run simultaneously.
 *  - At most `maxQueueDepth` tasks may wait; beyond that, enqueue is rejected
 *    (backpressure) so we fail fast instead of accumulating unbounded memory.
 *  - `drain()` lets a graceful shutdown wait for in-flight tasks to finish.
 */

export interface QueueOptions {
  concurrency: number;
  maxQueueDepth: number;
  name?: string;
}

export class QueueFullError extends Error {
  constructor(message = "The server is busy. Please try again shortly.") {
    super(message);
    this.name = "QueueFullError";
  }
}

interface QueuedTask {
  run: () => Promise<void>;
  label: string;
}

export class WorkQueue {
  private readonly concurrency: number;
  private readonly maxQueueDepth: number;
  private readonly name: string;
  private waiting: QueuedTask[] = [];
  private active = 0;
  private draining = false;
  private idleResolvers: Array<() => void> = [];

  constructor(opts: QueueOptions) {
    this.concurrency = Math.max(1, opts.concurrency);
    this.maxQueueDepth = Math.max(0, opts.maxQueueDepth);
    this.name = opts.name ?? "queue";
  }

  /** Number of tasks currently running. */
  get activeCount(): number {
    return this.active;
  }

  /** Number of tasks waiting to start. */
  get pendingCount(): number {
    return this.waiting.length;
  }

  /**
   * Enqueue a task. Resolves/rejects with the task's own result. Throws
   * QueueFullError synchronously if the backlog is full or we're shutting down.
   */
  enqueue<T>(label: string, task: () => Promise<T>): Promise<T> {
    if (this.draining) {
      throw new QueueFullError("The server is shutting down. Please retry.");
    }
    if (this.waiting.length >= this.maxQueueDepth) {
      throw new QueueFullError();
    }
    return new Promise<T>((resolve, reject) => {
      const run = async () => {
        try {
          const result = await task();
          resolve(result);
        } catch (err) {
          reject(err);
        }
      };
      this.waiting.push({ run, label });
      this.pump();
    });
  }

  private pump(): void {
    while (this.active < this.concurrency && this.waiting.length > 0) {
      const task = this.waiting.shift()!;
      this.active++;
      logger.debug("queue.task_start", {
        queue: this.name,
        label: task.label,
        active: this.active,
        pending: this.waiting.length,
      });
      void task
        .run()
        .catch(() => {
          /* result already routed to the caller's promise */
        })
        .finally(() => {
          this.active--;
          logger.debug("queue.task_done", {
            queue: this.name,
            label: task.label,
            active: this.active,
            pending: this.waiting.length,
          });
          if (this.active === 0 && this.waiting.length === 0) {
            const resolvers = this.idleResolvers;
            this.idleResolvers = [];
            for (const r of resolvers) r();
          }
          this.pump();
        });
    }
  }

  /**
   * Stop accepting new tasks and resolve once all in-flight + queued tasks
   * complete, or the timeout elapses. Used during graceful shutdown.
   */
  async drain(timeoutMs: number): Promise<boolean> {
    this.draining = true;
    if (this.active === 0 && this.waiting.length === 0) return true;
    logger.info("queue.draining", {
      queue: this.name,
      active: this.active,
      pending: this.waiting.length,
      timeoutMs,
    });
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), timeoutMs);
      timer.unref?.();
      this.idleResolvers.push(() => {
        clearTimeout(timer);
        resolve(true);
      });
    });
  }
}
