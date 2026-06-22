import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";
import type {
  Converter,
  ConvertContext,
  ConvertResult,
  DetectInput,
  OutputOption,
  OutputArtifact,
  ParamValue,
} from "../types";
import { sanitizeFilename } from "../security";

/**
 * Browser video/audio converter — powered by ffmpeg.wasm (FFmpeg compiled to
 * WebAssembly). Runs entirely in the tab.
 *
 * IMPORTANT browser facts:
 *  - This is CPU (WASM), NOT GPU. It's slower than native FFmpeg and bounded by
 *    the tab's memory, so very large videos may fail.
 *  - It needs SharedArrayBuffer, which requires the page to be cross-origin
 *    isolated (COOP/COEP headers — set in public/_headers for Cloudflare Pages).
 *    We check `crossOriginIsolated` and give a clear error if it's missing.
 *  - The ~30 MB core is downloaded on first use and cached, so the first
 *    conversion shows a "Loading FFmpeg…" step.
 */

let ffmpeg: FFmpeg | null = null;
let loadPromise: Promise<FFmpeg> | null = null;

// Pinned core version matching @ffmpeg/ffmpeg 0.12.x.
const CORE_VERSION = "0.12.6";
const CORE_BASE = `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/umd`;

async function getFFmpeg(onStatus?: (t: string) => void): Promise<FFmpeg> {
  if (ffmpeg) return ffmpeg;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    if (typeof crossOriginIsolated !== "undefined" && !crossOriginIsolated) {
      throw new Error(
        "Video/audio conversion needs a cross-origin-isolated page. If you're " +
          "self-hosting, ensure COOP/COEP headers are set (see public/_headers).",
      );
    }
    onStatus?.("Loading FFmpeg (first run only)…");
    const instance = new FFmpeg();
    const [coreURL, wasmURL] = await Promise.all([
      toBlobURL(`${CORE_BASE}/ffmpeg-core.js`, "text/javascript"),
      toBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`, "application/wasm"),
    ]);
    await instance.load({ coreURL, wasmURL });
    ffmpeg = instance;
    return instance;
  })();

  try {
    return await loadPromise;
  } catch (e) {
    loadPromise = null; // allow retry
    throw e;
  }
}

export const videoConverter: Converter = {
  id: "video",

  detect(input: DetectInput): boolean {
    return input.kind === "video" || input.kind === "audio";
  },

  getAvailableOutputs(input: DetectInput): OutputOption[] {
    if (input.kind === "video") {
      return [
        { id: "video:mp4", label: "MP4", description: "H.264 video + AAC audio", converter: "video" },
        { id: "video:webm", label: "WebM", description: "VP9 video + Opus audio", converter: "video" },
        {
          id: "video:gif",
          label: "GIF",
          description: "Animated GIF (palette optimized)",
          converter: "video",
          params: [
            { key: "fps", label: "FPS", type: "number", min: 5, max: 30, default: 12 },
            { key: "width", label: "Width", type: "number", min: 64, max: 1920, default: 480, unit: "px" },
          ],
        },
        {
          id: "video:compress",
          label: "Compress",
          description: "Smaller MP4 (scaled to <=720p)",
          converter: "video",
          params: [
            {
              key: "crf",
              label: "Quality",
              type: "select",
              default: "28",
              options: [
                { value: "23", label: "Higher quality (larger)" },
                { value: "28", label: "Balanced" },
                { value: "32", label: "Smaller file" },
              ],
            },
          ],
        },
        { id: "video:mp3", label: "Audio to MP3", description: "Extract audio as MP3", converter: "video" },
        { id: "video:wav", label: "Audio to WAV", description: "Extract audio as WAV", converter: "video" },
      ];
    }
    if (input.kind === "audio") {
      return [
        { id: "video:mp3", label: "MP3", description: "Convert to MP3", converter: "video" },
        { id: "video:wav", label: "WAV", description: "Convert to lossless WAV", converter: "video" },
      ];
    }
    return [];
  },

  async convert(ctx: ConvertContext): Promise<ConvertResult> {
    const { files, outputId, params, onProgress, onStatus } = ctx;
    const file = files[0];
    if (!file) throw new Error("No media file provided.");

    const ff = await getFFmpeg(onStatus);

    const progressHandler = ({ progress }: { progress: number }) => {
      // ffmpeg progress is 0..1 (can briefly exceed 1); clamp to 0..99.
      onProgress(Math.max(0, Math.min(99, Math.round(progress * 100))));
    };
    ff.on("progress", progressHandler);

    const inName = "input" + extOf(file.name);
    const stem = sanitizeFilename(file.name.replace(/\.[^.]+$/, "") || "media");

    try {
      onStatus?.("Processing…");
      await ff.writeFile(inName, await fetchFile(file));
      const { outName, args, mime, ext } = buildArgs(outputId, inName, params);
      await ff.exec(args);
      const data = await ff.readFile(outName);
      const bytes = data instanceof Uint8Array ? data : new TextEncoder().encode(String(data));
      const blob = new Blob([bytes.slice().buffer], { type: mime });
      onProgress(100);

      // Clean up the virtual FS.
      await safeDelete(ff, inName);
      await safeDelete(ff, outName);

      return { outputs: [{ name: `${stem}.${ext}`, blob, mime, size: blob.size }] };
    } finally {
      ff.off("progress", progressHandler);
    }
  },
};

function buildArgs(
  outputId: string,
  inName: string,
  params: Record<string, ParamValue>,
): { outName: string; args: string[]; mime: string; ext: string } {
  switch (outputId) {
    case "video:mp4":
      return {
        outName: "out.mp4",
        ext: "mp4",
        mime: "video/mp4",
        args: ["-i", inName, "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-c:a", "aac", "-b:a", "160k", "out.mp4"],
      };
    case "video:webm":
      return {
        outName: "out.webm",
        ext: "webm",
        mime: "video/webm",
        args: ["-i", inName, "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "34", "-row-mt", "1", "-c:a", "libopus", "out.webm"],
      };
    case "video:gif": {
      const fps = clampInt(params.fps, 5, 30, 12);
      const width = clampInt(params.width, 64, 1920, 480);
      const filter = `fps=${fps},scale=${width}:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`;
      return {
        outName: "out.gif",
        ext: "gif",
        mime: "image/gif",
        args: ["-i", inName, "-filter_complex", filter, "-loop", "0", "out.gif"],
      };
    }
    case "video:compress": {
      const crf = ["23", "28", "32"].includes(String(params.crf)) ? String(params.crf) : "28";
      return {
        outName: "out.mp4",
        ext: "mp4",
        mime: "video/mp4",
        args: ["-i", inName, "-vf", "scale='min(1280,iw)':-2", "-c:v", "libx264", "-preset", "veryfast", "-crf", crf, "-c:a", "aac", "-b:a", "128k", "out.mp4"],
      };
    }
    case "video:mp3":
      return {
        outName: "out.mp3",
        ext: "mp3",
        mime: "audio/mpeg",
        args: ["-i", inName, "-vn", "-c:a", "libmp3lame", "-q:a", "2", "out.mp3"],
      };
    case "video:wav":
      return {
        outName: "out.wav",
        ext: "wav",
        mime: "audio/wav",
        args: ["-i", inName, "-vn", "-c:a", "pcm_s16le", "out.wav"],
      };
    default:
      throw new Error(`Unsupported media operation: ${outputId}`);
  }
}

async function safeDelete(ff: FFmpeg, name: string) {
  try {
    await ff.deleteFile(name);
  } catch {
    /* ignore */
  }
}

function extOf(name: string): string {
  const m = name.match(/(\.[a-z0-9]+)$/i);
  return m ? m[1].toLowerCase() : ".bin";
}

function clampInt(v: ParamValue | undefined, min: number, max: number, fallback: number): number {
  const n = typeof v === "number" ? v : parseInt(String(v ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}
