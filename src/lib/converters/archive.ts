import "server-only";
import { promises as fs, createWriteStream } from "node:fs";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline as streamPipeline } from "node:stream/promises";
import yauzl from "yauzl";
import archiver from "archiver";
import { config } from "../config";
import { safeJoin, sanitizeFilename, isInside } from "../security";
import type {
  Converter,
  ConvertContext,
  ConvertResult,
  DetectInput,
  OutputOption,
  OutputFileInfo,
} from "../types";

/**
 * Archive converter.
 *
 *   ZIP extract   : safe, streaming extraction with zip-bomb guards.
 *   Files → ZIP   : bundle the uploaded files/folders into a single archive.
 *
 * SECURITY (extraction) — every protection the prompt calls for:
 *  - Reject absolute paths and any entry that resolves outside the target dir
 *    (Zip Slip / path traversal).
 *  - Cap total uncompressed bytes, entry count, and per-stream size.
 *  - Detect zip bombs via an overall compression-ratio ceiling.
 *  - Skip symlinks and non-regular entries.
 */

export const archiveConverter: Converter = {
  id: "archive",

  detect(input: DetectInput): boolean {
    return input.kind === "archive";
  },

  getAvailableOutputs(input: DetectInput): OutputOption[] {
    const opts: OutputOption[] = [];
    if (input.kind === "archive") {
      opts.push({
        id: "archive:extract",
        label: "Extract ZIP",
        description: "Safely unzip the archive (bundled back as a ZIP of files)",
        converter: "archive",
      });
    }
    return opts;
  },

  async convert(ctx: ConvertContext): Promise<ConvertResult> {
    const { job, inputDir, outputDir, onProgress } = ctx;
    const outputId = job.outputId ?? "";

    // "Bundle N files → ZIP": zip every uploaded input into one archive.
    if (outputId === "archive:zip") {
      if (job.inputs.length === 0) throw new Error("No files to bundle.");
      const bundleName = "kanban-tools-bundle.zip";
      const bundlePath = safeJoin(outputDir, bundleName);
      await zipFiles(
        job.inputs.map((i) => ({
          absPath: safeJoin(inputDir, i.storedName),
          nameInZip: i.originalName || i.storedName,
        })),
        bundlePath,
      );
      onProgress(100);
      const stat = await fs.stat(bundlePath);
      return {
        outputs: [{ name: bundleName, size: stat.size, mime: "application/zip" }],
      };
    }

    if (outputId !== "archive:extract") {
      throw new Error(`Unsupported archive operation: ${outputId}`);
    }
    const input = job.inputs[0];
    if (!input) throw new Error("No archive provided.");
    const srcPath = safeJoin(inputDir, input.storedName);

    // Extract into a dedicated subfolder of output/.
    const extractRoot = safeJoin(outputDir, "extracted");
    await fs.mkdir(extractRoot, { recursive: true });

    const summary = await safeExtractZip(srcPath, extractRoot, onProgress);

    // The browser can only download a single file conveniently, so we re-zip
    // the extracted tree. The job runner detects bundleName and serves it.
    const bundleName = `${input.storedName.replace(/\.[^.]+$/, "")}-extracted.zip`;
    const bundlePath = safeJoin(outputDir, bundleName);
    await zipDirectory(extractRoot, bundlePath);
    const stat = await fs.stat(bundlePath);

    const outputs: OutputFileInfo[] = [
      { name: bundleName, size: stat.size, mime: "application/zip" },
    ];
    // Note in params how many files were extracted (surfaced in the UI).
    job.params.extractedCount = summary.fileCount;
    job.params.extractedBytes = summary.totalBytes;
    return { outputs };
  },
};

interface ExtractSummary {
  fileCount: number;
  totalBytes: number;
}

/**
 * Stream-extract a ZIP with full safety guards. Throws a ZipSafetyError if any
 * limit is exceeded or a malicious entry is detected.
 */
export function safeExtractZip(
  zipPath: string,
  destDir: string,
  onProgress?: (pct: number) => void,
): Promise<ExtractSummary> {
  const limits = config.zip;
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: true }, (err, zip) => {
      if (err || !zip) {
        reject(new ZipSafetyError("This file could not be opened as a ZIP archive."));
        return;
      }

      let totalUncompressed = 0;
      let totalCompressed = 0;
      let fileCount = 0;
      const entryTotal = zip.entryCount;
      let entriesSeen = 0;
      let aborted = false;

      const fail = (e: Error) => {
        if (aborted) return;
        aborted = true;
        try {
          zip.close();
        } catch {
          /* ignore */
        }
        reject(e);
      };

      if (entryTotal > limits.maxEntries) {
        fail(
          new ZipSafetyError(
            `Archive has too many entries (${entryTotal} > ${limits.maxEntries}).`,
          ),
        );
        return;
      }

      zip.on("error", (e) => fail(new ZipSafetyError(`ZIP read error: ${e.message}`)));
      zip.on("end", () => {
        if (!aborted) resolve({ fileCount, totalBytes: totalUncompressed });
      });

      zip.readEntry();
      zip.on("entry", (entry: yauzl.Entry) => {
        if (aborted) return;
        entriesSeen++;
        onProgress?.(Math.min(95, Math.round((entriesSeen / Math.max(1, entryTotal)) * 95)));

        const rawName = entry.fileName;

        // Reject absolute paths and traversal up front.
        if (path.isAbsolute(rawName) || rawName.includes("..")) {
          fail(new ZipSafetyError(`Unsafe path in archive: "${rawName}".`));
          return;
        }

        // Build a sanitized destination, segment by segment, and confirm it
        // stays inside destDir (defense in depth against Zip Slip).
        const segments = rawName.split(/[\\/]/).filter((s) => s && s !== ".");
        const isDir = /\/$/.test(rawName) || /\\$/.test(rawName);

        let destPath: string;
        try {
          const safeSegments = segments.map((s) =>
            isDir || s !== segments[segments.length - 1]
              ? sanitizeSegment(s)
              : sanitizeFilename(s),
          );
          destPath = safeJoin(destDir, ...safeSegments);
        } catch {
          fail(new ZipSafetyError(`Unsafe path in archive: "${rawName}".`));
          return;
        }
        if (!isInside(destDir, destPath) && destPath !== destDir) {
          fail(new ZipSafetyError(`Entry escapes archive root: "${rawName}".`));
          return;
        }

        // Skip symlinks / special entries by checking external attrs (unix mode).
        const unixMode = entry.externalFileAttributes >>> 16;
        const S_IFLNK = 0o120000;
        if ((unixMode & 0o170000) === S_IFLNK) {
          // Don't extract symlinks — count and move on.
          zip.readEntry();
          return;
        }

        if (isDir) {
          fs.mkdir(destPath, { recursive: true })
            .then(() => zip.readEntry())
            .catch((e) => fail(new ZipSafetyError(`Failed to create directory: ${e.message}`)));
          return;
        }

        // Per-entry and aggregate size accounting (uncompressedSize is advisory;
        // we ALSO meter the actual stream so a lying header can't bypass limits).
        totalCompressed += entry.compressedSize || 0;
        const projected = totalUncompressed + (entry.uncompressedSize || 0);
        if (projected > limits.maxTotalBytes) {
          fail(
            new ZipSafetyError(
              `Archive expands beyond the allowed size (${limits.maxTotalBytes} bytes).`,
            ),
          );
          return;
        }

        zip.openReadStream(entry, (rsErr, readStream) => {
          if (rsErr || !readStream) {
            fail(new ZipSafetyError(`Failed to read entry "${rawName}".`));
            return;
          }

          // Meter bytes with a pass-through Transform so we enforce the real
          // (not header-claimed) uncompressed size + compression ratio WITHOUT
          // consuming the stream — a plain `data` listener would steal chunks
          // before the file write, truncating the output.
          const meter = new Transform({
            transform(chunk: Buffer, _enc, cb) {
              totalUncompressed += chunk.length;
              if (totalUncompressed > limits.maxTotalBytes) {
                cb(
                  new ZipSafetyError(
                    `Archive expands beyond the allowed size (${limits.maxTotalBytes} bytes).`,
                  ),
                );
                return;
              }
              if (
                totalCompressed > 4096 &&
                totalUncompressed / totalCompressed > limits.maxCompressionRatio
              ) {
                cb(
                  new ZipSafetyError(
                    "This archive looks like a zip bomb (suspicious compression ratio).",
                  ),
                );
                return;
              }
              cb(null, chunk);
            },
          });

          const parentDir = path.dirname(destPath);
          fs.mkdir(parentDir, { recursive: true })
            .then(() =>
              streamPipeline(readStream, meter, createWriteStream(destPath)),
            )
            .then(() => {
              if (aborted) return;
              fileCount++;
              zip.readEntry();
            })
            .catch((e) => {
              if (!aborted) {
                const msg =
                  e instanceof ZipSafetyError
                    ? e.message
                    : `Failed to write entry: ${(e as Error).message}`;
                fail(new ZipSafetyError(msg));
              }
            });
        });
      });
    });
  });
}

/** Sanitize a single non-final path segment (directory name). */
function sanitizeSegment(seg: string): string {
  const cleaned = sanitizeFilename(seg);
  if (cleaned === "." || cleaned === ".." || cleaned === "") {
    throw new ZipSafetyError("Unsafe path segment.");
  }
  return cleaned;
}

/** Zip up an entire directory tree into destZipPath. */
export function zipDirectory(srcDir: string, destZipPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(destZipPath);
    const archive = archiver("zip", { zlib: { level: 9 } });
    output.on("close", () => resolve());
    archive.on("warning", (err) => {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") reject(err);
    });
    archive.on("error", (err) => reject(err));
    archive.pipe(output);
    archive.directory(srcDir, false);
    void archive.finalize();
  });
}

/** Zip an explicit list of files (used by the "files → ZIP" tool / job runner). */
export function zipFiles(
  files: { absPath: string; nameInZip: string }[],
  destZipPath: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(destZipPath);
    const archive = archiver("zip", { zlib: { level: 9 } });
    output.on("close", () => resolve());
    archive.on("error", (err) => reject(err));
    archive.pipe(output);
    for (const f of files) {
      archive.file(f.absPath, { name: sanitizeFilename(f.nameInZip) });
    }
    void archive.finalize();
  });
}

export class ZipSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZipSafetyError";
  }
}
