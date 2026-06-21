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
import type { ConvertContext, OutputFileInfo } from "./types";

/**
 * Job runner — executes a converter for a job and manages status transitions,
 * progress throttling, and multi-output bundling.
 *
 * Runs in-process for the MVP (fire-and-forget from the convert route).
 * PRODUCTION UPGRADE: push job ids onto a queue (BullMQ/SQS) and run this in a
 * dedicated worker pool so the web tier stays responsive and work survives
 * restarts.
 */

// Persist progress to metadata.json at most this often (ms) to limit disk I/O.
const PROGRESS_PERSIST_INTERVAL = 1500;

export async function runJob(jobId: string): Promise<void> {
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

  let lastPersist = 0;
  const onProgress = (pct: number) => {
    setProgress(jobId, pct);
    const now = Date.now();
    if (now - lastPersist > PROGRESS_PERSIST_INTERVAL) {
      lastPersist = now;
      // Best-effort, non-blocking persistence of progress.
      void updateJob(jobId, { progress: Math.max(0, Math.min(100, Math.round(pct))) });
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
    const result = await converter.convert(ctx);
    let outputs = result.outputs;
    let bundleName: string | undefined;

    // If a converter produced its own bundle (e.g. archive extract), respect it.
    const alreadyBundled =
      outputs.length === 1 && outputs[0].mime === "application/zip";

    // Multiple outputs → zip them into a single downloadable bundle.
    if (outputs.length > 1 && !alreadyBundled) {
      bundleName = await bundleOutputs(jobId, outputs);
    }

    await recordOutputs(jobId, outputs, bundleName);
    await setStatus(jobId, "completed", {
      progress: 100,
      // Carry over any params the converter annotated (e.g. extractedCount).
      params: job.params,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Conversion failed unexpectedly.";
    await setStatus(jobId, "failed", { error: message, progress: 100 });
  }
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
