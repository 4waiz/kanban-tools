/**
 * Structured logger.
 *
 * Emits single-line JSON in production (machine-parseable for log aggregators)
 * and a compact human format in development. No external dependency.
 *
 * Usage:
 *   import { logger } from "@/lib/logger";
 *   logger.info("job.completed", { jobId, ms });
 *   const log = logger.child({ requestId });  // contextual logger
 */

type Level = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<Level, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const isProd = process.env.NODE_ENV === "production";
const configuredLevel = (process.env.LOG_LEVEL as Level) || (isProd ? "info" : "debug");
const threshold = LEVEL_ORDER[configuredLevel] ?? LEVEL_ORDER.info;

type Fields = Record<string, unknown>;

function serializeError(err: unknown): Fields {
  if (err instanceof Error) {
    return {
      errName: err.name,
      errMessage: err.message,
      // Stacks are useful in prod logs but noisy in dev console.
      ...(isProd ? { stack: err.stack } : {}),
    };
  }
  return { err: String(err) };
}

function emit(level: Level, msg: string, fields?: Fields, base?: Fields) {
  if (LEVEL_ORDER[level] < threshold) return;

  const merged: Fields = { ...base, ...fields };
  // Normalize any Error fields.
  for (const [k, v] of Object.entries(merged)) {
    if (v instanceof Error) {
      delete merged[k];
      Object.assign(merged, serializeError(v));
    }
  }

  if (isProd) {
    const record = {
      level,
      time: new Date().toISOString(),
      msg,
      ...merged,
    };
    const line = JSON.stringify(record);
    if (level === "error") process.stderr.write(line + "\n");
    else process.stdout.write(line + "\n");
  } else {
    // Dev: readable, with fields appended.
    const tag =
      level === "error"
        ? "ERR"
        : level === "warn"
          ? "WRN"
          : level === "info"
            ? "INF"
            : "DBG";
    const extra = Object.keys(merged).length ? " " + JSON.stringify(merged) : "";
    // eslint-disable-next-line no-console
    console[level === "debug" ? "log" : level](`[${tag}] ${msg}${extra}`);
  }
}

export interface Logger {
  debug(msg: string, fields?: Fields): void;
  info(msg: string, fields?: Fields): void;
  warn(msg: string, fields?: Fields): void;
  error(msg: string, fields?: Fields): void;
  child(base: Fields): Logger;
}

function makeLogger(base: Fields = {}): Logger {
  return {
    debug: (msg, fields) => emit("debug", msg, fields, base),
    info: (msg, fields) => emit("info", msg, fields, base),
    warn: (msg, fields) => emit("warn", msg, fields, base),
    error: (msg, fields) => emit("error", msg, fields, base),
    child: (extra) => makeLogger({ ...base, ...extra }),
  };
}

export const logger = makeLogger();
