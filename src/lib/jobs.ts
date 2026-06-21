import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import { config } from "./config";
import { isValidJobId, safeJoin } from "./security";
import type { Job, JobStatus, InputFileInfo, OutputFileInfo, InputKind } from "./types";

/**
 * Job manager.
 *
 * MVP storage model:
 *  - Each job is a directory: <jobsDir>/<jobId>/
 *      input/        uploaded source files
 *      output/       produced artifacts
 *      metadata.json the serialized Job record
 *  - An in-memory Map is the fast path / source of truth at runtime.
 *  - metadata.json is written on every change so jobs survive a process restart
 *    and so a future external worker could read them.
 *
 * PRODUCTION UPGRADE: move the index to Redis/Postgres and files to object
 * storage (S3/R2). The `JobStore` interface below is intentionally small so
 * that swap is mechanical. Tie `token` to an authenticated user/session.
 */

export interface CreateJobInput {
  inputs: InputFileInfo[];
  inputKind: InputKind;
}

const memory = new Map<string, Job>();

function jobDir(id: string): string {
  if (!isValidJobId(id)) throw new Error("Invalid job id");
  return safeJoin(config.jobsDir, id);
}

export function inputDirFor(id: string): string {
  return safeJoin(jobDir(id), "input");
}
export function outputDirFor(id: string): string {
  return safeJoin(jobDir(id), "output");
}
function metadataPath(id: string): string {
  return safeJoin(jobDir(id), "metadata.json");
}

async function persist(job: Job): Promise<void> {
  await fs.mkdir(jobDir(job.id), { recursive: true });
  await fs.writeFile(
    metadataPath(job.id),
    JSON.stringify(job, null, 2),
    "utf8",
  );
}

/** Create a new job and its directory skeleton. Does not write input files. */
export async function createJob(input: CreateJobInput): Promise<Job> {
  const id = nanoid(16);
  const token = nanoid(32);
  const now = Date.now();
  const job: Job = {
    id,
    token,
    status: "pending",
    createdAt: now,
    updatedAt: now,
    progress: 0,
    params: {},
    inputs: input.inputs,
    outputs: [],
    inputKind: input.inputKind,
  };
  await fs.mkdir(inputDirFor(id), { recursive: true });
  await fs.mkdir(outputDirFor(id), { recursive: true });
  memory.set(id, job);
  await persist(job);
  return job;
}

/** Look up a job, falling back to metadata.json if not in memory. */
export async function getJob(id: string): Promise<Job | null> {
  if (!isValidJobId(id)) return null;
  const cached = memory.get(id);
  if (cached) return cached;
  try {
    const raw = await fs.readFile(metadataPath(id), "utf8");
    const job = JSON.parse(raw) as Job;
    memory.set(id, job);
    return job;
  } catch {
    return null;
  }
}

/**
 * Authorize an action against a job: id must exist AND the token must match.
 * Knowing a job id is not sufficient to read/delete its files.
 */
export async function getAuthorizedJob(
  id: string,
  token: string | null | undefined,
): Promise<Job | null> {
  const job = await getJob(id);
  if (!job) return null;
  if (!token || token !== job.token) return null;
  return job;
}

/** Apply a partial update, bump updatedAt, and persist. */
export async function updateJob(
  id: string,
  patch: Partial<Omit<Job, "id" | "token" | "createdAt">>,
): Promise<Job | null> {
  const job = await getJob(id);
  if (!job) return null;
  Object.assign(job, patch, { updatedAt: Date.now() });
  memory.set(id, job);
  await persist(job);
  return job;
}

export async function setStatus(
  id: string,
  status: JobStatus,
  extra?: Partial<Job>,
): Promise<Job | null> {
  return updateJob(id, { status, ...extra });
}

export async function setProgress(id: string, progress: number): Promise<void> {
  const job = memory.get(id);
  if (!job) return;
  job.progress = Math.max(0, Math.min(100, Math.round(progress)));
  job.updatedAt = Date.now();
  // Progress updates are frequent; keep them in memory and only persist
  // occasionally to avoid hammering the disk. Status changes always persist.
}

export async function recordOutputs(
  id: string,
  outputs: OutputFileInfo[],
  bundleName?: string,
): Promise<Job | null> {
  return updateJob(id, { outputs, bundleName });
}

/** Delete a job's files and drop it from the index. Idempotent. */
export async function deleteJob(id: string): Promise<boolean> {
  if (!isValidJobId(id)) return false;
  memory.delete(id);
  try {
    await fs.rm(jobDir(id), { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

/** Recent jobs from memory, newest first (used by status polling / debugging). */
export function listRecentJobs(limit = 20): Job[] {
  return [...memory.values()]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
}

/**
 * Delete jobs whose age exceeds the TTL. Scans both memory and the on-disk
 * directory (to catch jobs left over from a previous process). Returns the
 * number of jobs removed.
 */
export async function sweepExpiredJobs(now = Date.now()): Promise<number> {
  let removed = 0;

  // In-memory jobs.
  for (const job of [...memory.values()]) {
    if (now - job.updatedAt > config.jobTtlMs) {
      await deleteJob(job.id);
      removed++;
    }
  }

  // On-disk jobs not tracked in memory (e.g. after a restart).
  let entries: string[] = [];
  try {
    entries = await fs.readdir(config.jobsDir);
  } catch {
    return removed; // dir doesn't exist yet
  }
  for (const name of entries) {
    if (memory.has(name) || !isValidJobId(name)) continue;
    try {
      const meta = await fs.readFile(
        safeJoin(config.jobsDir, name, "metadata.json"),
        "utf8",
      );
      const job = JSON.parse(meta) as Job;
      if (now - job.updatedAt > config.jobTtlMs) {
        await fs.rm(safeJoin(config.jobsDir, name), {
          recursive: true,
          force: true,
        });
        removed++;
      }
    } catch {
      // No/invalid metadata — fall back to directory mtime.
      try {
        const stat = await fs.stat(safeJoin(config.jobsDir, name));
        if (now - stat.mtimeMs > config.jobTtlMs) {
          await fs.rm(safeJoin(config.jobsDir, name), {
            recursive: true,
            force: true,
          });
          removed++;
        }
      } catch {
        /* ignore */
      }
    }
  }

  return removed;
}

/** Public, token-free view of a job for client responses. */
export function publicJob(job: Job) {
  const { token: _token, ...rest } = job;
  void _token;
  return rest;
}

export type { Job };
export { jobDir };
