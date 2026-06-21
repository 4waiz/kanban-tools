import "server-only";
import {
  getJob,
  setStatus,
  setProgress,
  updateJob,
  recordOutputs,
  inputDirFor,
  outputDirFor,
  jobDir,
} from "./jobs";
import { converterForOutput } from "./converters/registry";
import { zipFiles } from "./converters/archive";
import { safeJoin } from "./security";
import { config } from "./config";
import { logger } from "./logger";
import { WorkQueue, QueueFullError } from "./queue";
import type { ConvertContext, OutputFileInfo } from "./types";

/**
 * Job runner + the singleton work queue.
 *
 * Conversions are CPU/RAM heavy (FFmpeg, Sharp, Ghostscript). Running them
 * fire-and-forget in the request process - as the first cut did - lets a burst
 * of uploads exhaust the machine. Instead we funnel every job through a single
 * bounded WorkQueue: at most `WORKER_CONCURRENCY` run at once, with a bounded
 * backlog that applies backpressure.
 *
 * The queue lives on globalThis so Next.js dev hot-reloads don't create
 * multiple copies.
 */

const PROGRESS_PERSIST_INTERVAL = 1500;
const GLOBAL_KEY = "__kanban_job_queue__";

function getQueue(): WorkQueue {
  const g = globalThis as unknown as Record<string, WorkQueue | undefined>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new WorkQueue({
      concurrency: config.worker.concurrency,
      maxQueueDepth: config.worker.maxQueueDepth,
      name: "jobs",
    });
    logger.info("queue.created", {
      concurrency: config.worker.concurrency,
      maxQueueDepth: config.worker.maxQueueDepth,
    });
  }
  return g[GLOBAL_KEY]!;
}

export function queueStats() {
  const q = getQueue();
  return { active: q.activeCount, pending: q.pendingCount };
}

/** For graceful shutdown: stop taking work and wait for in-flight jobs. */
export async function drainQueue(timeoutMs: number): Promise<boolean> {
  return getQueue().drain(timeoutMs);
}

export { QueueFullError };

/**
 * Enqueue a job for processing. Throws QueueFullError synchronously if the
 * backlog is full (the caller maps that to HTTP 503). The returned promise
 * resolves when the job finishes, but callers typically don't await it - they
 * poll job status instead.
 */
export function enqueueJob(jobId: string): Promise<void> {
  const queue = getQueue();
  return queue.enqueue(`job:${jobId}`, () => runJob(jobId));
}

async function runJob(jobId: string): Promise<void> {
  const log = logger.child({ jobId });
  const job = await getJob(jobId);
  if (!job) return;
  if (!job.outputId) {
    await setStatus(jobId, "failed", { error: "No output format selected." });
    return;
  }

  const converter = converterForOutput(job.outputId);
  if (!converter) {
    await setStatus(jobId, "failed", {
      error: `No converter handles "${job.outputId}".`,
    });
    return;
  }

  await setStatus(jobId, "processing", { progress: 0 });
  const startedAt = Date.now();
  log.info("job.start", { outputId: job.outputId, kind: job.inputKind });

  let lastPersist = 0;
  const onProgress = (pct: number) => {
    setProgress(jobId, pct);
    const now = Date.now();
    if (now - lastPersist > PROGRESS_PERSIST_INTERVAL) {
      lastPersist = now;
      void updateJob(jobId, {
        progress: Math.max(0, Math.min(100, Math.round(pct))),
      });
    }
  };

  const ctx: ConvertContext = {
    job,
    jobDir: jobDir(jobId),
    inputDir: inputDirFor(jobId),
    outputDir: outputDirFor(jobId),
    onProgress,
  };

  try {
    // Hard timeout backstop in addition to each tool's own timeout.
    const result = await withTimeout(
      converter.convert(ctx),
      config.worker.jobTimeoutMs,
      "This conversion took too long and was stopped.",
    );
    const outputs = result.outputs;
    let bundleName: string | undefined;

    const alreadyBundled =
      outputs.length === 1 && outputs[0].mime === "application/zip";
    if (outputs.length > 1 && !alreadyBundled) {
      bundleName = await bundleOutputs(jobId, outputs);
    }

    await recordOutputs(jobId, outputs, bundleName);
    await setStatus(jobId, "completed", {
      progress: 100,
      params: job.params,
    });
    log.info("job.completed", {
      ms: Date.now() - startedAt,
      outputs: outputs.length,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Conversion failed unexpectedly.";
    await setStatus(jobId, "failed", { error: message, progress: 100 });
    log.error("job.failed", { ms: Date.now() - startedAt, err });
  }
}

/** Reject if a promise doesn't settle within ms. */
function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    timer.unref?.();
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/** Zip every produced output into one archive in the output dir. */
async function bundleOutputs(
  jobId: string,
  outputs: OutputFileInfo[],
): Promise<string> {
  const outputDir = outputDirFor(jobId);
  const bundleName = `kanban-tools-${jobId}.zip`;
  const bundlePath = safeJoin(outputDir, bundleName);
  await zipFiles(
    outputs.map((o) => ({
      absPath: safeJoin(outputDir, o.name),
      nameInZip: o.name,
    })),
    bundlePath,
  );
  return bundleName;
}

/** Compute the single file a download request should serve for a job. */
export function resolveDownloadName(job: {
  bundleName?: string;
  outputs: OutputFileInfo[];
}): string | null {
  if (job.bundleName) return job.bundleName;
  if (job.outputs.length === 1) return job.outputs[0].name;
  return null;
}
