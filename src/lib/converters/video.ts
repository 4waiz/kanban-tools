import "server-only";
import { promises as fs } from "node:fs";
import { config } from "../config";
import { execFile } from "../exec";
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
 * Video / audio converter - backed by FFmpeg.
 *
 *   Video → MP4 (H.264 + AAC)
 *   Video → WebM (VP9 + Opus)
 *   Video → GIF (palette-based, decent quality)
 *   Extract audio → MP3 / WAV
 *   Compress video (CRF preset, scaled to 720p)
 *
 * Progress is parsed from ffmpeg's stderr ("time=HH:MM:SS.xx") against the
 * source duration obtained from ffprobe.
 */

export const videoConverter: Converter = {
  id: "video",

  detect(input: DetectInput): boolean {
    return input.kind === "video" || input.kind === "audio";
  },

  getAvailableOutputs(input: DetectInput): OutputOption[] {
    if (input.kind === "video") {
      return [
        {
          id: "video:mp4",
          label: "MP4",
          description: "H.264 video + AAC audio (most compatible)",
          converter: "video",
        },
        {
          id: "video:webm",
          label: "WebM",
          description: "VP9 video + Opus audio (open, efficient)",
          converter: "video",
        },
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
          description: "Smaller MP4 at a quality preset (scaled to ≤720p)",
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
        {
          id: "video:mp3",
          label: "Audio → MP3",
          description: "Extract the audio track as MP3",
          converter: "video",
        },
        {
          id: "video:wav",
          label: "Audio → WAV",
          description: "Extract the audio track as lossless WAV",
          converter: "video",
        },
      ];
    }
    if (input.kind === "audio") {
      return [
        {
          id: "video:mp3",
          label: "MP3",
          description: "Convert/re-encode to MP3",
          converter: "video",
        },
        {
          id: "video:wav",
          label: "WAV",
          description: "Convert to lossless WAV",
          converter: "video",
        },
      ];
    }
    return [];
  },

  async convert(ctx: ConvertContext): Promise<ConvertResult> {
    const { job, inputDir, outputDir, onProgress } = ctx;
    const outputId = job.outputId ?? "";
    const input = job.inputs[0];
    if (!input) throw new Error("No media file provided.");
    const srcPath = safeJoin(inputDir, input.storedName);
    const stem = input.storedName.replace(/\.[^.]+$/, "");

    const durationSec = await probeDuration(srcPath);
    const reportProgress = makeProgressReporter(durationSec, onProgress);

    const { ext, args, mime } = buildFfmpegArgs(outputId, srcPath, stem, outputDir, job.params);

    await execFile(config.tools.ffmpeg, args, {
      cwd: outputDir,
      timeoutMs: 30 * 60 * 1000,
      onStderr: reportProgress,
    });

    const outName = `${stem}.${ext}`;
    const outPath = safeJoin(outputDir, outName);
    const stat = await fs.stat(outPath).catch(() => null);
    if (!stat) throw new Error("Conversion produced no output.");
    onProgress(100);
    const outputs: OutputFileInfo[] = [{ name: outName, size: stat.size, mime }];
    return { outputs };
  },
};

function buildFfmpegArgs(
  outputId: string,
  srcPath: string,
  stem: string,
  outputDir: string,
  params: Record<string, string | number | boolean>,
): { ext: string; mime: string; args: string[] } {
  const base = ["-y", "-i", srcPath];

  switch (outputId) {
    case "video:mp4":
      return {
        ext: "mp4",
        mime: "video/mp4",
        args: [
          ...base,
          "-c:v", "libx264",
          "-preset", "medium",
          "-crf", "23",
          "-c:a", "aac",
          "-b:a", "160k",
          "-movflags", "+faststart",
          safeJoin(outputDir, `${stem}.mp4`),
        ],
      };
    case "video:webm":
      return {
        ext: "webm",
        mime: "video/webm",
        args: [
          ...base,
          "-c:v", "libvpx-vp9",
          "-b:v", "0",
          "-crf", "32",
          "-row-mt", "1",
          "-c:a", "libopus",
          safeJoin(outputDir, `${stem}.webm`),
        ],
      };
    case "video:gif": {
      const fps = clampInt(params.fps, 5, 30, 12);
      const width = clampInt(params.width, 64, 1920, 480);
      // High-quality GIF via a generated palette in a single filtergraph.
      const filter = `fps=${fps},scale=${width}:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`;
      return {
        ext: "gif",
        mime: "image/gif",
        args: [...base, "-filter_complex", filter, "-loop", "0", safeJoin(outputDir, `${stem}.gif`)],
      };
    }
    case "video:compress": {
      const crf = ["23", "28", "32"].includes(String(params.crf)) ? String(params.crf) : "28";
      return {
        ext: "mp4",
        mime: "video/mp4",
        args: [
          ...base,
          "-vf", "scale='min(1280,iw)':'-2'",
          "-c:v", "libx264",
          "-preset", "medium",
          "-crf", crf,
          "-c:a", "aac",
          "-b:a", "128k",
          "-movflags", "+faststart",
          safeJoin(outputDir, `${stem}.mp4`),
        ],
      };
    }
    case "video:mp3":
      return {
        ext: "mp3",
        mime: "audio/mpeg",
        args: [...base, "-vn", "-c:a", "libmp3lame", "-q:a", "2", safeJoin(outputDir, `${stem}.mp3`)],
      };
    case "video:wav":
      return {
        ext: "wav",
        mime: "audio/wav",
        args: [...base, "-vn", "-c:a", "pcm_s16le", safeJoin(outputDir, `${stem}.wav`)],
      };
    default:
      throw new Error(`Unsupported media operation: ${outputId}`);
  }
}

/** Get media duration in seconds via ffprobe (0 if unknown). */
async function probeDuration(srcPath: string): Promise<number> {
  try {
    const res = await execFile(
      config.tools.ffprobe,
      [
        "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        srcPath,
      ],
      { timeoutMs: 30_000 },
    );
    const d = parseFloat(res.stdout.trim());
    return Number.isFinite(d) ? d : 0;
  } catch {
    return 0;
  }
}

/** Parse "time=HH:MM:SS.xx" from ffmpeg stderr into a 0–99 progress reporter. */
function makeProgressReporter(
  durationSec: number,
  onProgress: (p: number) => void,
): (chunk: string) => void {
  let buffer = "";
  return (chunk: string) => {
    buffer += chunk;
    const matches = buffer.match(/time=(\d+):(\d+):(\d+\.\d+)/g);
    if (!matches || matches.length === 0) return;
    const last = matches[matches.length - 1];
    const m = last.match(/time=(\d+):(\d+):(\d+\.\d+)/);
    if (!m) return;
    const secs = parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseFloat(m[3]);
    if (durationSec > 0) {
      onProgress(Math.min(99, Math.round((secs / durationSec) * 100)));
    }
    // Keep the buffer from growing without bound.
    if (buffer.length > 64_000) buffer = buffer.slice(-8_000);
  };
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === "number" ? v : parseInt(String(v ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}
