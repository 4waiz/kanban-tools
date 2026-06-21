import os from "node:os";
import path from "node:path";

/**
 * Centralized runtime configuration, read from environment variables with safe
 * defaults. Importing this module is side-effect free.
 *
 * PRODUCTION UPGRADE: most of these (storage dir, limits) should be backed by a
 * config service and/or per-tenant overrides rather than process env.
 */

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw == null) return fallback;
  return raw === "1" || raw.toLowerCase() === "true";
}

function cpuCount(): number {
  try {
    return os.cpus()?.length || 2;
  } catch {
    return 2;
  }
}

const MB = 1024 * 1024;

export const config = {
  /** Root directory for all per-job temp folders. */
  jobsDir:
    process.env.CONVERT_JOBS_DIR ||
    path.join(os.tmpdir(), "convert-jobs"),

  /** Max accepted upload size in bytes. */
  maxFileSizeBytes: int("MAX_FILE_SIZE_MB", 512) * MB,
  maxFileSizeMb: int("MAX_FILE_SIZE_MB", 512),

  /** Job retention + cleanup cadence. */
  jobTtlMs: int("JOB_TTL_MINUTES", 30) * 60 * 1000,
  cleanupIntervalMs: int("CLEANUP_INTERVAL_MINUTES", 5) * 60 * 1000,

  /** ZIP extraction safety limits. */
  zip: {
    maxTotalBytes: int("ZIP_MAX_TOTAL_BYTES", 1024 * MB),
    maxEntries: int("ZIP_MAX_ENTRIES", 10_000),
    maxCompressionRatio: int("ZIP_MAX_COMPRESSION_RATIO", 120),
  },

  /** Rate limiting (in-memory token bucket). */
  rateLimit: {
    windowMs: int("RATE_LIMIT_WINDOW_SECONDS", 60) * 1000,
    max: int("RATE_LIMIT_MAX_REQUESTS", 40),
  },

  /** Worker pool / queue limits. */
  worker: {
    // Max conversions running at once. Defaults to (cores - 1), clamped to 1..8.
    concurrency: int(
      "WORKER_CONCURRENCY",
      Math.max(1, Math.min(8, cpuCount() - 1)),
    ),
    // Max jobs allowed to wait in the queue before new work is rejected.
    maxQueueDepth: int("WORKER_MAX_QUEUE_DEPTH", 200),
    // Per-conversion hard timeout (ms) enforced by the runner as a backstop.
    jobTimeoutMs: int("WORKER_JOB_TIMEOUT_SECONDS", 30 * 60) * 1000,
    // Grace period to let in-flight jobs finish on shutdown (ms).
    shutdownGraceMs: int("WORKER_SHUTDOWN_GRACE_SECONDS", 25) * 1000,
  },

  /** Abuse / capacity guards. */
  limits: {
    // Reject uploads once the jobs dir exceeds this many bytes.
    maxTotalDiskBytes: int("MAX_TOTAL_DISK_BYTES", 10 * 1024 * MB), // 10 GB
    // Max concurrent *active* (pending/processing) jobs per client IP.
    maxJobsPerClient: int("MAX_JOBS_PER_CLIENT", 5),
    // Max files in a single upload request.
    maxFilesPerUpload: int("MAX_FILES_PER_UPLOAD", 100),
  },

  /** Link downloader. */
  link: {
    enabled: bool("ENABLE_LINK_DOWNLOADER", true),
    ytdlpPath: process.env.YTDLP_PATH || "yt-dlp",
    maxDownloadBytes: int("LINK_MAX_DOWNLOAD_BYTES", 1024 * MB),
  },

  /** External tool binaries (overridable for Windows / non-PATH installs). */
  tools: {
    ffmpeg: process.env.FFMPEG_PATH || "ffmpeg",
    ffprobe: process.env.FFPROBE_PATH || "ffprobe",
    pdftoppm: process.env.PDFTOPPM_PATH || "pdftoppm",
    pdftocairo: process.env.PDFTOCAIRO_PATH || "pdftocairo",
    ghostscript:
      process.env.GHOSTSCRIPT_PATH ||
      (process.platform === "win32" ? "gswin64c" : "gs"),
  },
} as const;

export type AppConfig = typeof config;
