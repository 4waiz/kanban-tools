import type {
  Converter,
  ConvertContext,
  ConvertResult,
  DetectInput,
  OutputOption,
  OutputArtifact,
  ParamValue,
} from "../types";

/**
 * Browser image converter — uses the Canvas 2D API and `createImageBitmap`.
 * Runs entirely in the tab; no WASM, no server. Covers format conversion
 * (PNG/JPG/WebP, AVIF where the browser can encode it), resize, compress, and
 * high-quality upscaling.
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
    const formats = [
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
      label: "Upscale",
      description: "Enlarge 2-4x with smooth resampling",
      converter: "image",
      params: [
        {
          key: "factor",
          label: "Scale",
          type: "select",
          default: "2",
          options: [
            { value: "2", label: "2x" },
            { value: "3", label: "3x" },
            { value: "4", label: "4x" },
          ],
        },
      ],
    });

    return opts;
  },

  async convert(ctx: ConvertContext): Promise<ConvertResult> {
    const { files, outputId, params, onProgress } = ctx;
    const outputs: OutputArtifact[] = [];
    const total = files.length || 1;
    let done = 0;

    for (const file of files) {
      const artifact = await convertOne(file, outputId, params);
      outputs.push(artifact);
      done++;
      onProgress(Math.round((done / total) * 100));
    }
    return { outputs };
  },
};

async function convertOne(
  file: File,
  outputId: string,
  params: Record<string, ParamValue>,
): Promise<OutputArtifact> {
  const bitmap = await createImageBitmap(file);
  const stem = file.name.replace(/\.[^.]+$/, "") || "image";
  const srcExt = (file.name.match(/\.([a-z0-9]+)$/i)?.[1] || "").toLowerCase();

  let targetW = bitmap.width;
  let targetH = bitmap.height;
  let fmt = "png";
  let quality = 0.8;

  if (OUTPUT_MIME[outputId.split(":")[1]] && outputId.startsWith("image:")) {
    fmt = outputId.split(":")[1];
    quality = num(params.quality, fmt === "avif" ? 55 : 80) / 100;
  } else if (outputId === "image:compress") {
    fmt = keepFormat(srcExt);
    quality = num(params.quality, 70) / 100;
  } else if (outputId === "image:resize") {
    const w = optNum(params.width);
    const h = optNum(params.height);
    const scaled = fitInside(bitmap.width, bitmap.height, w, h);
    targetW = scaled.w;
    targetH = scaled.h;
    const sel = str(params.format, "keep");
    fmt = sel === "keep" ? keepFormat(srcExt) : sel;
    quality = 0.82;
  } else if (outputId === "image:upscale") {
    const factor = Math.max(2, Math.min(4, parseInt(str(params.factor, "2"), 10) || 2));
    targetW = Math.round(bitmap.width * factor);
    targetH = Math.round(bitmap.height * factor);
    fmt = keepFormat(srcExt);
    quality = 0.9;
  }

  const mime = OUTPUT_MIME[fmt] ?? "image/png";
  let blob = await drawToBlob(bitmap, targetW, targetH, mime, quality);
  bitmap.close?.();

  // Some browsers can't ENCODE avif/webp; canvas silently falls back to png.
  // Detect that and correct the extension so the file isn't mislabeled.
  let realFmt = fmt;
  if ((fmt === "avif" || fmt === "webp") && blob.type !== mime) {
    realFmt = blob.type === "image/webp" ? "webp" : "png";
  }
  if (!blob || blob.size === 0) {
    // Last-resort fallback to PNG.
    blob = await drawToBlob(await createImageBitmap(file), targetW, targetH, "image/png", 1);
    realFmt = "png";
  }

  const name = `${stem}.${realFmt}`;
  return { name, blob, mime: blob.type || mime, size: blob.size };
}

function drawToBlob(
  bitmap: ImageBitmap,
  w: number,
  h: number,
  mime: string,
  quality: number,
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, w);
  canvas.height = Math.max(1, h);
  const cx = canvas.getContext("2d");
  if (!cx) throw new Error("Canvas is not available in this browser.");
  cx.imageSmoothingEnabled = true;
  cx.imageSmoothingQuality = "high";
  cx.drawImage(bitmap, 0, 0, w, h);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (b) resolve(b);
        else reject(new Error("Failed to encode the image."));
      },
      mime,
      mime === "image/png" ? undefined : quality,
    );
  });
}

function fitInside(
  srcW: number,
  srcH: number,
  maxW?: number,
  maxH?: number,
): { w: number; h: number } {
  if (!maxW && !maxH) return { w: srcW, h: srcH };
  if (maxW && !maxH) return { w: maxW, h: Math.round((maxW / srcW) * srcH) };
  if (!maxW && maxH) return { w: Math.round((maxH / srcH) * srcW), h: maxH };
  // Both: scale to fit the box, preserving aspect.
  const ratio = Math.min(maxW! / srcW, maxH! / srcH);
  return { w: Math.round(srcW * ratio), h: Math.round(srcH * ratio) };
}

function keepFormat(ext: string): string {
  const e = ext.toLowerCase();
  if (e === "jpg" || e === "jpeg") return "jpg";
  if (e === "webp") return "webp";
  if (e === "png") return "png";
  // gif/bmp/tiff/heic source → safe PNG output.
  return "png";
}

function num(v: ParamValue | undefined, fallback: number): number {
  const n = typeof v === "number" ? v : parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? Math.max(1, Math.min(100, n)) : fallback;
}
function optNum(v: ParamValue | undefined): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const n = typeof v === "number" ? v : parseInt(String(v), 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}
function str(v: ParamValue | undefined, fallback: string): string {
  return v === undefined || v === null || v === "" ? fallback : String(v);
}
