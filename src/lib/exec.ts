import { spawn } from "node:child_process";

/**
 * Safe external-process execution.
 *
 * SECURITY: we only ever use spawn() with an explicit argument array and
 * `shell: false` (the default). User-controlled values are passed as separate
 * array elements, never interpolated into a command string, so there is no
 * shell to inject into. Every call is bounded by a timeout and a max output
 * buffer so a hung or runaway tool can't wedge the server.
 */

export interface ExecOptions {
  /** Working directory for the child process. */
  cwd?: string;
  /** Hard timeout in ms; the process is killed if exceeded. */
  timeoutMs?: number;
  /** Extra environment variables (merged over process.env). */
  env?: NodeJS.ProcessEnv;
  /** Called with stderr chunks as they arrive (e.g. to parse progress). */
  onStderr?: (chunk: string) => void;
  /** Called with stdout chunks as they arrive. */
  onStdout?: (chunk: string) => void;
  /** Max bytes to retain from stdout/stderr (default 4 MB each). */
  maxBufferBytes?: number;
}

export interface ExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export class ExecError extends Error {
  code: number | null;
  stderr: string;
  constructor(message: string, code: number | null, stderr: string) {
    super(message);
    this.name = "ExecError";
    this.code = code;
    this.stderr = stderr;
  }
}

/**
 * Run `bin args[]` and resolve with the result. Rejects with ExecError on a
 * non-zero exit code, spawn failure (e.g. binary not found), or timeout.
 */
export function execFile(
  bin: string,
  args: string[],
  opts: ExecOptions = {},
): Promise<ExecResult> {
  const {
    cwd,
    timeoutMs = 5 * 60 * 1000,
    env,
    onStderr,
    onStdout,
    maxBufferBytes = 4 * 1024 * 1024,
  } = opts;

  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;

    const child = spawn(bin, args, {
      cwd,
      env: env ? { ...process.env, ...env } : process.env,
      shell: false, // <- critical: no shell interpretation
      windowsHide: true,
    });

    const killTimer = setTimeout(() => {
      if (settled) return;
      child.kill("SIGKILL");
      finish(
        new ExecError(
          `${bin} timed out after ${timeoutMs}ms`,
          null,
          stderr,
        ),
      );
    }, timeoutMs);

    function finish(err: Error | null, result?: ExecResult) {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      if (err) reject(err);
      else resolve(result!);
    }

    child.on("error", (err) => {
      // e.g. ENOENT when the binary isn't installed.
      finish(
        new ExecError(
          `Failed to start "${bin}": ${err.message}`,
          null,
          stderr,
        ),
      );
    });

    child.stdout?.on("data", (d: Buffer) => {
      const s = d.toString();
      onStdout?.(s);
      if (stdoutBytes < maxBufferBytes) {
        stdout += s;
        stdoutBytes += d.length;
      }
    });

    child.stderr?.on("data", (d: Buffer) => {
      const s = d.toString();
      onStderr?.(s);
      if (stderrBytes < maxBufferBytes) {
        stderr += s;
        stderrBytes += d.length;
      }
    });

    child.on("close", (code) => {
      if (code === 0) {
        finish(null, { code, stdout, stderr });
      } else {
        finish(
          new ExecError(
            `${bin} exited with code ${code}`,
            code,
            stderr || stdout,
          ),
        );
      }
    });
  });
}

/** True if a binary is runnable (used to feature-detect ffmpeg, poppler, etc.). */
export async function isToolAvailable(
  bin: string,
  versionArg = "-version",
): Promise<boolean> {
  try {
    await execFile(bin, [versionArg], { timeoutMs: 5000 });
    return true;
  } catch {
    return false;
  }
}
