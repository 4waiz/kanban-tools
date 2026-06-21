import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Filesystem helpers used across the job store and converters.
 *
 *  - `writeFileAtomic` writes to a temp file then renames over the target.
 *    rename() is atomic on the same filesystem, so a crash mid-write can never
 *    leave a half-written metadata.json or output file behind.
 *  - `dirSize` / `pathExists` support the disk-usage guard.
 */

/** Atomically write a file (temp + rename). Same dir → same filesystem. */
export async function writeFileAtomic(
  filePath: string,
  data: string | Buffer,
): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  // Unique temp name in the same directory.
  const tmp = path.join(
    dir,
    `.tmp-${path.basename(filePath)}-${process.pid}-${randomSuffix()}`,
  );
  let handle: fs.FileHandle | null = null;
  try {
    handle = await fs.open(tmp, "wx");
    await handle.writeFile(data);
    // Flush to disk so the rename can't expose an empty file after a crash.
    await handle.sync().catch(() => {
      /* sync may be unsupported on some FS; best-effort */
    });
    await handle.close();
    handle = null;
    await fs.rename(tmp, filePath);
  } catch (err) {
    if (handle) await handle.close().catch(() => {});
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

/** Recursively compute the total size (bytes) of a directory. */
export async function dirSize(dir: string): Promise<number> {
  let total = 0;
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += await dirSize(full);
    } else if (entry.isFile()) {
      try {
        total += (await fs.stat(full)).size;
      } catch {
        /* file vanished mid-scan */
      }
    }
  }
  return total;
}

export async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

function randomSuffix(): string {
  // Avoids Math.random for nothing security-sensitive here, but keep it simple.
  return (
    Date.now().toString(36) + Math.floor(Math.random() * 1e9).toString(36)
  );
}
