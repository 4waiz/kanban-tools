import { unzip, zip, type Unzipped } from "fflate";
import type {
  Converter,
  ConvertContext,
  ConvertResult,
  DetectInput,
  OutputOption,
  OutputArtifact,
} from "../types";
import { sanitizeFilename } from "../security";

/**
 * Browser archive converter — ZIP extract + create, using fflate (tiny, fast,
 * pure JS). Even though extraction happens on the user's own machine, we keep
 * the same safety guards as the server version: entry-count cap, total-size cap,
 * and a compression-ratio (zip-bomb) check. Entry names are sanitized so a
 * crafted archive can't suggest traversal paths in the re-bundled output.
 */

// Conservative in-browser limits (RAM-bound).
const MAX_ENTRIES = 5000;
const MAX_TOTAL_BYTES = 512 * 1024 * 1024; // 512 MB uncompressed
const MAX_RATIO = 120;

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
        description: "Unzip the archive (re-bundled as a clean ZIP of files)",
        converter: "archive",
      });
    }
    return opts;
  },

  async convert(ctx: ConvertContext): Promise<ConvertResult> {
    const { files, outputId, onProgress } = ctx;

    if (outputId === "archive:zip") {
      return bundleFiles(files, onProgress);
    }
    if (outputId !== "archive:extract") {
      throw new Error(`Unsupported archive operation: ${outputId}`);
    }

    const file = files[0];
    if (!file) throw new Error("No archive provided.");
    const compressed = new Uint8Array(await file.arrayBuffer());
    onProgress(20);

    const entries = await unzipAsync(compressed);
    onProgress(60);

    // Safety accounting.
    const names = Object.keys(entries);
    if (names.length > MAX_ENTRIES) {
      throw new Error(`Archive has too many entries (limit ${MAX_ENTRIES}).`);
    }
    let totalUncompressed = 0;
    for (const n of names) totalUncompressed += entries[n].length;
    if (totalUncompressed > MAX_TOTAL_BYTES) {
      throw new Error("Archive expands beyond the allowed size.");
    }
    if (compressed.length > 4096 && totalUncompressed / compressed.length > MAX_RATIO) {
      throw new Error("This archive looks like a zip bomb (suspicious ratio).");
    }

    // Re-bundle the extracted files into a clean ZIP with sanitized names so the
    // user gets a single download. Directory entries (empty) are skipped.
    const safeEntries: Record<string, Uint8Array> = {};
    let fileCount = 0;
    for (const rawName of names) {
      const bytes = entries[rawName];
      if (rawName.endsWith("/") || bytes.length === 0) continue; // directory marker
      const safe = safePathInZip(rawName);
      if (!safe) continue;
      safeEntries[uniqueName(safeEntries, safe)] = bytes;
      fileCount++;
    }
    if (fileCount === 0) throw new Error("The archive contained no files.");

    onProgress(80);
    const zipped = await zipAsync(safeEntries);
    onProgress(100);

    const stem = file.name.replace(/\.[^.]+$/, "") || "archive";
    const blob = new Blob([asArrayBuffer(zipped)], { type: "application/zip" });
    return {
      outputs: [
        { name: `${stem}-extracted.zip`, blob, mime: "application/zip", size: blob.size },
      ],
    };
  },
};

async function bundleFiles(
  files: File[],
  onProgress: (p: number) => void,
): Promise<ConvertResult> {
  if (files.length === 0) throw new Error("No files to bundle.");
  const entries: Record<string, Uint8Array> = {};
  let done = 0;
  for (const f of files) {
    const bytes = new Uint8Array(await f.arrayBuffer());
    const name = uniqueName(entries, sanitizeFilename(f.name || "file"));
    entries[name] = bytes;
    done++;
    onProgress(Math.round((done / files.length) * 70));
  }
  const zipped = await zipAsync(entries);
  onProgress(100);
  const blob = new Blob([asArrayBuffer(zipped)], { type: "application/zip" });
  return {
    outputs: [
      { name: "kanban-tools-bundle.zip", blob, mime: "application/zip", size: blob.size },
    ],
  };
}

/** Promisified fflate unzip. */
function unzipAsync(data: Uint8Array): Promise<Unzipped> {
  return new Promise((resolve, reject) => {
    unzip(data, (err, out) => (err ? reject(err) : resolve(out)));
  });
}

/** Promisified fflate zip (max compression). */
function zipAsync(entries: Record<string, Uint8Array>): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    zip(entries, { level: 9 }, (err, out) => (err ? reject(err) : resolve(out)));
  });
}

/**
 * Sanitize a zip entry path: reject absolute/traversal, sanitize each segment,
 * and rebuild a safe relative path. Returns null if nothing safe remains.
 */
function safePathInZip(raw: string): string | null {
  if (raw.includes("..") || raw.startsWith("/") || /^[a-z]:[\\/]/i.test(raw)) {
    return null;
  }
  const segments = raw
    .split(/[\\/]/)
    .filter((s) => s && s !== "." && s !== "..");
  if (segments.length === 0) return null;
  const safe = segments.map((s) => sanitizeFilename(s)).filter(Boolean);
  return safe.length ? safe.join("/") : null;
}

function uniqueName(existing: Record<string, unknown>, name: string): string {
  if (!(name in existing)) return name;
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  let n = 1;
  let candidate = `${stem}-${n}${ext}`;
  while (candidate in existing) candidate = `${stem}-${++n}${ext}`;
  return candidate;
}

/** Copy a Uint8Array's bytes into a standalone ArrayBuffer for Blob/BlobPart. */
function asArrayBuffer(u8: Uint8Array): ArrayBuffer {
  return u8.slice().buffer;
}
