import "server-only";
import { promises as fs } from "node:fs";
import sharp from "sharp";
import { safeJoin } from "../security";
import type {
  Converter,
  ConvertContext,
  ConvertResult,
  DetectInput,
  OutputOption,
  OutputFileInfo,
} from "../types";

/**
 * Image converter - backed by Sharp (libvips). No external binary required,
 * which makes it the most portable converter in the app.
 *
 * Capabilities: format conversion (PNG/JPG/WebP/AVIF), resize by width/height,
 * compress by quality, and a high-quality "2x upscale" (Lanczos resize).
 */

const OUTPUT_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  avif: "image/avif",
};

function qualityParam(def = 80) {
  return {
    key: "quality",
    label: "Quality",
    type: "number" as const,
    min: 10,
    max: 100,
    step: 1,
    default: def,
    unit: "%",
  };
}

export const imageConverter: Converter = {
  id: "image",

  detect(input: DetectInput): boolean {
    return input.kind === "image";
  },

  getAvailableOutputs(input: DetectInput): OutputOption[] {
    if (input.kind !== "image") return [];
    const formats: { id: string; label: string }[] = [
      { id: "png", label: "PNG" },
      { id: "jpg", label: "JPG" },
      { id: "webp", label: "WebP" },
      { id: "avif", label: "AVIF" },
    ];

    const opts: OutputOption[] = formats.map((f) => ({
      id: `image:${f.id}`,
      label: f.label,
      description: `Convert to ${f.label}`,
      converter: "image",
      params: f.id === "png" ? [] : [qualityParam(f.id === "avif" ? 55 : 80)],
    }));

    opts.push({
      id: "image:resize",
      label: "Resize",
      description: "Resize by width and/or height (keeps aspect ratio)",
      converter: "image",
      params: [
        { key: "width", label: "Width", type: "number", min: 1, max: 20000, unit: "px" },
        { key: "height", label: "Height", type: "number", min: 1, max: 20000, unit: "px" },
        {
          key: "format",
          label: "Output format",
          type: "select",
          default: "keep",
          options: [
            { value: "keep", label: "Keep original" },
            { value: "png", label: "PNG" },
            { value: "jpg", label: "JPG" },
            { value: "webp", label: "WebP" },
            { value: "avif", label: "AVIF" },
          ],
        },
      ],
    });

    opts.push({
      id: "image:compress",
      label: "Compress",
      description: "Reduce file size at a chosen quality",
      converter: "image",
      params: [qualityParam(70)],
    });

    opts.push({
      id: "image:upscale",
      label: "Upscale 2×",
      description: "Double the resolution with high-quality resampling",
      converter: "image",
      params: [
        {
          key: "factor",
          label: "Scale",
          type: "select",
          default: "2",
          options: [
            { value: "2", label: "2×" },
            { value: "3", label: "3×" },
            { value: "4", label: "4×" },
          ],
        },
      ],
    });

    return opts;
  },

  async convert(ctx: ConvertContext): Promise<ConvertResult> {
    const { job, inputDir, outputDir, onProgress } = ctx;
    const outputId = job.outputId ?? "";
    const outputs: OutputFileInfo[] = [];

    // Each uploaded image is processed independently; results may be zipped
    // later by the job runner if there's more than one.
    const total = job.inputs.length || 1;
    let done = 0;

    for (const input of job.inputs) {
      const srcPath = safeJoin(inputDir, input.storedName);
      const stem = input.storedName.replace(/\.[^.]+$/, "");

      // Decide target format + pipeline based on the chosen operation.
      const { ext, pipeline } = await buildPipeline(outputId, srcPath, job.params, input.ext);

      const outName = `${stem}.${ext}`;
      const outPath = safeJoin(outputDir, outName);
      await pipeline.toFile(outPath);

      const stat = await fs.stat(outPath);
      outputs.push({
        name: outName,
        size: stat.size,
        mime: OUTPUT_MIME[ext] ?? `image/${ext}`,
      });

      done++;
      onProgress(Math.round((done / total) * 100));
    }

    return { outputs };
  },
};

/**
 * Build a Sharp pipeline + the resolved output extension for an operation.
 * `.rotate()` (with no args) auto-orients using EXIF before any resize.
 */
async function buildPipeline(
  outputId: string,
  srcPath: string,
  params: Record<string, string | number | boolean>,
  srcExt: string,
): Promise<{ ext: string; pipeline: sharp.Sharp }> {
  const img = sharp(srcPath, { failOn: "none" }).rotate();

  // image:<fmt> - straight format conversion (with optional quality).
  if (outputId.startsWith("image:") && OUTPUT_MIME[outputId.split(":")[1]]) {
    const fmt = outputId.split(":")[1];
    return { ext: fmt, pipeline: applyFormat(img, fmt, num(params.quality)) };
  }

  if (outputId === "image:compress") {
    // Compress: keep the source format where it makes sense, drop to JPEG/WebP
    // quality. PNG is re-encoded with max compression effort.
    const fmt = normalizeKeepFormat(srcExt);
    return { ext: fmt, pipeline: applyFormat(img, fmt, num(params.quality, 70)) };
  }

  if (outputId === "image:resize") {
    const width = optNum(params.width);
    const height = optNum(params.height);
    const resized = img.resize({
      width,
      height,
      fit: "inside",
      withoutEnlargement: false,
    });
    const fmtSel = str(params.format, "keep");
    const fmt = fmtSel === "keep" ? normalizeKeepFormat(srcExt) : fmtSel;
    return { ext: fmt, pipeline: applyFormat(resized, fmt, num(params.quality, 82)) };
  }

  if (outputId === "image:upscale") {
    const factor = Math.max(2, Math.min(4, parseInt(str(params.factor, "2"), 10) || 2));
    const meta = await img.metadata();
    const targetW = meta.width ? Math.round(meta.width * factor) : undefined;
    const upscaled = img.resize({
      width: targetW,
      kernel: "lanczos3",
      withoutEnlargement: false,
    });
    const fmt = normalizeKeepFormat(srcExt);
    return { ext: fmt, pipeline: applyFormat(upscaled, fmt, 90) };
  }

  // Fallback: re-encode to PNG.
  return { ext: "png", pipeline: applyFormat(img, "png") };
}

function applyFormat(img: sharp.Sharp, fmt: string, quality = 80): sharp.Sharp {
  switch (fmt) {
    case "jpg":
    case "jpeg":
      return img.jpeg({ quality, mozjpeg: true });
    case "webp":
      return img.webp({ quality });
    case "avif":
      return img.avif({ quality });
    case "png":
    default:
      return img.png({ compressionLevel: 9, effort: 7 });
  }
}

/** Map an arbitrary source extension to a format Sharp can write. */
function normalizeKeepFormat(ext: string): string {
  const e = (ext || "").toLowerCase();
  if (e === "jpeg" || e === "jpg") return "jpg";
  if (e === "webp") return "webp";
  if (e === "avif") return "avif";
  if (e === "png") return "png";
  // Unsupported-to-write source (gif/tiff/bmp/heic) → safe, lossless PNG.
  return "png";
}

function num(v: unknown, fallback = 80): number {
  const n = typeof v === "number" ? v : parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? Math.max(1, Math.min(100, n)) : fallback;
}
function optNum(v: unknown): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const n = typeof v === "number" ? v : parseInt(String(v), 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}
function str(v: unknown, fallback: string): string {
  return v === undefined || v === null || v === "" ? fallback : String(v);
}
