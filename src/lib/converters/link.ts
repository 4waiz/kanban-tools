import "server-only";
import { promises as fs, createWriteStream } from "node:fs";
import { pipeline as streamPipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { config } from "../config";
import { execFile, isToolAvailable } from "../exec";
import { safeJoin, sanitizeFilename, validatePublicUrl, getExtension } from "../security";
import { assertHostResolvesPublic } from "../ssrf";
import { detectType } from "../detect";
import type {
  Converter,
  ConvertContext,
  ConvertResult,
  DetectInput,
  OutputOption,
  OutputFileInfo,
} from "../types";

/**
 * Link downloader.
 *
 * LEGAL / SAFETY POSTURE (per product requirements):
 *  - Only content the user is allowed to download. The API requires an explicit
 *    "I confirm I have the right to download this content" acknowledgement
 *    (job.params.confirmed === true) before this converter will run.
 *  - We DO NOT bypass DRM, paywalls, logins, private accounts, or any access
 *    control. There is no cookie/credential passing, no auth, no DRM handling.
 *  - Two supported modes only:
 *      1) Direct downloadable file URLs (Content-Type is a real file) — streamed
 *         server-side with a hard byte cap.
 *      2) Public media pages that yt-dlp supports for legal public content.
 *  - Anything that looks protected, private, or unsupported returns a polite,
 *    explicit error rather than attempting a workaround.
 */

// Conservative allowlist of host suffixes we will hand to yt-dlp. yt-dlp itself
// supports many sites, but we restrict to public, broadly-legal video platforms
// and refuse the rest. Extend deliberately, not eagerly.
const YTDLP_ALLOWED_HOST_SUFFIXES = [
  "youtube.com",
  "youtu.be",
  "vimeo.com",
  "dailymotion.com",
  "soundcloud.com",
];

export const linkConverter: Converter = {
  id: "link",

  detect(input: DetectInput): boolean {
    return input.kind === "link";
  },

  getAvailableOutputs(input: DetectInput): OutputOption[] {
    if (input.kind !== "link") return [];
    return [
      {
        id: "link:download",
        label: "Download",
        description: "Fetch a direct file, or a public video you’re allowed to keep",
        converter: "link",
      },
    ];
  },

  async convert(ctx: ConvertContext): Promise<ConvertResult> {
    const { job, outputDir, onProgress } = ctx;
    if (!config.link.enabled) {
      throw new LinkError("The link downloader is disabled on this server.");
    }
    // Hard gate: rights confirmation must be present.
    if (job.params.confirmed !== true && job.params.confirmed !== "true") {
      throw new LinkError(
        "Please confirm you have the right to download this content before continuing.",
      );
    }

    const rawUrl = String(job.params.url ?? "").trim();
    const check = validatePublicUrl(rawUrl);
    if (!check.ok || !check.url) {
      throw new LinkError(check.reason ?? "Invalid URL.");
    }
    const url = check.url;

    // SSRF: resolve the host and reject if it maps to a private/reserved IP.
    const ssrf = await assertHostResolvesPublic(url.hostname);
    if (!ssrf.ok) {
      throw new LinkError(ssrf.reason ?? "That address is not allowed.");
    }

    onProgress(5);

    // Decide the path: direct-file vs. media-page.
    const head = await probeUrl(url);

    if (head.kind === "file") {
      const output = await downloadDirectFile(url, head, outputDir, onProgress);
      return { outputs: [output] };
    }

    // Media page → yt-dlp (only for allowlisted public hosts).
    const host = url.hostname.toLowerCase();
    const allowed = YTDLP_ALLOWED_HOST_SUFFIXES.some(
      (suf) => host === suf || host.endsWith("." + suf),
    );
    if (!allowed) {
      throw new LinkError(
        "This link isn’t a direct file, and the page isn’t a supported public media source. " +
          "We can’t download from private, protected, or unsupported sites.",
      );
    }

    const ytdlpOk = await isToolAvailable(config.link.ytdlpPath, "--version");
    if (!ytdlpOk) {
      throw new LinkError(
        "Media-page downloading isn’t available on this server (yt-dlp is not installed). " +
          "Direct file links still work.",
      );
    }

    const output = await downloadWithYtDlp(url, outputDir, onProgress);
    return { outputs: [output] };
  },
};

interface UrlProbe {
  kind: "file" | "page";
  contentType: string;
  contentLength: number;
  filename?: string;
}

/**
 * HEAD/GET probe to classify a URL. If the server returns a concrete file
 * content-type (not text/html), we treat it as a direct download.
 */
async function probeUrl(url: URL): Promise<UrlProbe> {
  let res: Response | null = null;
  try {
    res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      headers: { "user-agent": "KanbanTools/1.0 (+download)" },
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    res = null;
  }
  // Some servers don't support HEAD; fall back to a ranged GET for headers only.
  if (!res || !res.ok) {
    try {
      res = await fetch(url, {
        method: "GET",
        redirect: "follow",
        headers: { "user-agent": "KanbanTools/1.0 (+download)", range: "bytes=0-0" },
        signal: AbortSignal.timeout(20_000),
      });
    } catch (e) {
      throw new LinkError(
        "We couldn’t reach that URL. Check the link and that it’s publicly accessible.",
      );
    }
  }

  const contentType = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  const contentLength = parseInt(res.headers.get("content-length") || "0", 10) || 0;
  const disposition = res.headers.get("content-disposition") || "";
  const nameMatch = disposition.match(/filename\*?=(?:UTF-8'')?"?([^"";]+)"?/i);
  const filename = nameMatch ? decodeURIComponent(nameMatch[1]) : undefined;

  // Cancel the GET body if we opened one.
  try {
    await res.body?.cancel();
  } catch {
    /* ignore */
  }

  const isHtml = contentType === "text/html" || contentType === "application/xhtml+xml";
  const looksLikeFile = !!contentType && !isHtml;

  return {
    kind: looksLikeFile ? "file" : "page",
    contentType,
    contentLength,
    filename,
  };
}

/** Stream a direct file to disk with a hard byte cap. */
async function downloadDirectFile(
  url: URL,
  probe: UrlProbe,
  outputDir: string,
  onProgress: (p: number) => void,
): Promise<OutputFileInfo> {
  if (probe.contentLength && probe.contentLength > config.link.maxDownloadBytes) {
    throw new LinkError(
      `That file is larger than the ${Math.round(
        config.link.maxDownloadBytes / (1024 * 1024),
      )} MB limit.`,
    );
  }

  const res = await fetch(url, {
    redirect: "follow",
    headers: { "user-agent": "KanbanTools/1.0 (+download)" },
    signal: AbortSignal.timeout(10 * 60 * 1000),
  });
  if (!res.ok || !res.body) {
    throw new LinkError(`The server responded with ${res.status}. Download failed.`);
  }

  // Derive a safe filename from disposition, URL path, or content-type.
  const fromUrl = decodeURIComponent(url.pathname.split("/").pop() || "");
  let name = sanitizeFilename(probe.filename || fromUrl || "download");
  if (!getExtension(name)) {
    const ext = extFromContentType(probe.contentType);
    if (ext) name = `${name}.${ext}`;
  }
  const outPath = safeJoin(outputDir, name);

  // Meter bytes as they stream so a missing Content-Length can't blow the cap.
  let received = 0;
  const max = config.link.maxDownloadBytes;
  const nodeStream = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]);
  nodeStream.on("data", (chunk: Buffer) => {
    received += chunk.length;
    if (received > max) {
      nodeStream.destroy(
        new LinkError(
          `Download exceeded the ${Math.round(max / (1024 * 1024))} MB limit.`,
        ),
      );
      return;
    }
    if (probe.contentLength > 0) {
      onProgress(Math.min(99, Math.round((received / probe.contentLength) * 100)));
    }
  });

  await streamPipeline(nodeStream, createWriteStream(outPath));
  const stat = await fs.stat(outPath);
  onProgress(100);

  const det = detectType(name, probe.contentType);
  return { name, size: stat.size, mime: det.mime };
}

/** Download a public media page with yt-dlp into the output dir. */
async function downloadWithYtDlp(
  url: URL,
  outputDir: string,
  onProgress: (p: number) => void,
): Promise<OutputFileInfo> {
  // Output template constrained to the isolated output dir; yt-dlp picks the
  // extension. We do NOT pass cookies, credentials, or any DRM/bypass flags.
  const outputTemplate = safeJoin(outputDir, "%(title).80s.%(ext)s");

  const before = new Set(await fs.readdir(outputDir).catch(() => []));

  try {
    await execFile(
      config.link.ytdlpPath,
      [
        "--no-playlist",
        "--no-progress",
        "--restrict-filenames",
        "--max-filesize",
        String(config.link.maxDownloadBytes),
        "--no-warnings",
        "-f",
        "bv*+ba/b", // best video+audio, fall back to best single
        "--merge-output-format",
        "mp4",
        "-o",
        outputTemplate,
        url.toString(),
      ],
      {
        cwd: outputDir,
        timeoutMs: 30 * 60 * 1000,
        onStdout: () => onProgress(Math.min(95, 30)),
      },
    );
  } catch (e) {
    // Translate common yt-dlp failures into polite, non-technical messages.
    const msg = (e as Error).message.toLowerCase();
    if (msg.includes("drm") || msg.includes("protected")) {
      throw new LinkError("This content is DRM-protected and cannot be downloaded.");
    }
    if (msg.includes("private") || msg.includes("login") || msg.includes("sign in")) {
      throw new LinkError(
        "This content is private or requires sign-in, so it can’t be downloaded here.",
      );
    }
    if (msg.includes("not available") || msg.includes("unsupported url")) {
      throw new LinkError("This link isn’t available for public download.");
    }
    throw new LinkError("We couldn’t download from this link.");
  }

  // Find the newly created file.
  const after = await fs.readdir(outputDir);
  const created = after.filter((n) => !before.has(n));
  if (created.length === 0) {
    throw new LinkError("The download produced no file.");
  }
  const name = created[0];
  const stat = await fs.stat(safeJoin(outputDir, name));
  onProgress(100);
  const det = detectType(name);
  return { name, size: stat.size, mime: det.mime };
}

function extFromContentType(ct: string): string | null {
  const map: Record<string, string> = {
    "application/pdf": "pdf",
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "audio/mpeg": "mp3",
    "audio/wav": "wav",
    "application/zip": "zip",
    "application/json": "json",
    "text/plain": "txt",
  };
  return map[ct] ?? null;
}

export class LinkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LinkError";
  }
}
