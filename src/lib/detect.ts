import type { InputKind } from "./types";
import { getExtension } from "./security";

/**
 * Input type detection.
 *
 * We combine three signals, most-trusted first:
 *  1. Magic bytes (file signature) - can't be spoofed by renaming.
 *  2. The client-provided MIME type - convenient but spoofable.
 *  3. The file extension - last resort.
 *
 * The goal is a coarse `InputKind` (image/pdf/video/audio/archive) plus a
 * best-guess MIME string; converters refine from there.
 */

/** Map of extension -> canonical MIME, for the formats we care about. */
const EXT_MIME: Record<string, string> = {
  // images
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  avif: "image/avif",
  gif: "image/gif",
  tiff: "image/tiff",
  tif: "image/tiff",
  bmp: "image/bmp",
  heic: "image/heic",
  heif: "image/heif",
  // documents
  pdf: "application/pdf",
  // video
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  mkv: "video/x-matroska",
  avi: "video/x-msvideo",
  m4v: "video/x-m4v",
  // audio
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  aac: "audio/aac",
  flac: "audio/flac",
  ogg: "audio/ogg",
  // archives
  zip: "application/zip",
};

const IMAGE_EXTS = new Set([
  "png", "jpg", "jpeg", "webp", "avif", "gif", "tiff", "tif", "bmp", "heic", "heif",
]);
const VIDEO_EXTS = new Set(["mp4", "mov", "webm", "mkv", "avi", "m4v"]);
const AUDIO_EXTS = new Set(["mp3", "wav", "m4a", "aac", "flac", "ogg"]);

/** Read the kind from a MIME prefix. */
function kindFromMime(mime: string): InputKind {
  if (mime === "application/pdf") return "pdf";
  if (mime === "application/zip" || mime === "application/x-zip-compressed")
    return "archive";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "unknown";
}

/** Read `len` bytes from `b` starting at `offset` as an ASCII string. */
function ascii(b: Uint8Array, offset: number, len: number): string {
  let s = "";
  for (let i = offset; i < offset + len && i < b.length; i++) {
    s += String.fromCharCode(b[i]);
  }
  return s;
}

/**
 * Inspect leading bytes for a file signature. Returns a MIME if recognized.
 * The buffer should hold at least the first ~16 bytes of the file. Accepts any
 * Uint8Array (works in both Node and the browser).
 */
export function sniffMagicBytes(buf: Uint8Array): string | null {
  if (buf.length < 4) return null;
  const b = buf;

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47)
    return "image/png";
  // JPEG: FF D8 FF
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  // GIF: "GIF8"
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38)
    return "image/gif";
  // BMP: "BM"
  if (b[0] === 0x42 && b[1] === 0x4d) return "image/bmp";
  // PDF: "%PDF"
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46)
    return "application/pdf";
  // ZIP (and zip-based): "PK\x03\x04" / "PK\x05\x06" / "PK\x07\x08"
  if (b[0] === 0x50 && b[1] === 0x4b) return "application/zip";
  // RIFF container (WAV / WEBP / AVI): "RIFF" .... then format tag at 8..12
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
  ) {
    const tag = ascii(b, 8, 4);
    if (tag === "WEBP") return "image/webp";
    if (tag === "WAVE") return "audio/wav";
    if (tag === "AVI ") return "video/x-msvideo";
  }
  // ISO-BMFF (MP4/MOV/M4A/HEIC/AVIF): "....ftyp" at offset 4
  if (
    b.length >= 12 &&
    b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70
  ) {
    const brand = ascii(b, 8, 4);
    if (brand.startsWith("avif") || brand.startsWith("avis"))
      return "image/avif";
    if (brand.startsWith("heic") || brand.startsWith("heif") || brand.startsWith("mif1"))
      return "image/heic";
    if (brand.startsWith("qt")) return "video/quicktime";
    if (brand.startsWith("M4A")) return "audio/mp4";
    return "video/mp4";
  }
  // OGG: "OggS"
  if (b[0] === 0x4f && b[1] === 0x67 && b[2] === 0x67 && b[3] === 0x53)
    return "audio/ogg";
  // FLAC: "fLaC"
  if (b[0] === 0x66 && b[1] === 0x4c && b[2] === 0x61 && b[3] === 0x43)
    return "audio/flac";
  // Matroska/WebM (EBML): 1A 45 DF A3
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3)
    return "video/x-matroska";
  // MP3: ID3 tag "ID3" or frame sync FF Ex/Fx
  if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) return "audio/mpeg";
  if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return "audio/mpeg";

  return null;
}

export interface DetectResult {
  kind: InputKind;
  mime: string;
  ext: string;
}

/**
 * Detect from a filename + optional client MIME + optional magic-byte buffer.
 * Magic bytes win when present and recognized.
 */
export function detectType(
  filename: string,
  clientMime?: string,
  head?: Uint8Array,
): DetectResult {
  const ext = getExtension(filename);

  // 1. Magic bytes (authoritative).
  const sniffed = head ? sniffMagicBytes(head) : null;
  if (sniffed) {
    // WebM and Matroska share a signature; prefer the extension to disambiguate.
    let mime = sniffed;
    if (sniffed === "video/x-matroska" && ext === "webm") mime = "video/webm";
    return { kind: kindFromMime(mime), mime, ext };
  }

  // 2. Client MIME, if it's specific enough.
  if (clientMime && clientMime !== "application/octet-stream") {
    const kind = kindFromMime(clientMime);
    if (kind !== "unknown") return { kind, mime: clientMime, ext };
  }

  // 3. Extension fallback.
  if (ext && EXT_MIME[ext]) {
    const mime = EXT_MIME[ext];
    return { kind: kindFromMime(mime), mime, ext };
  }
  if (IMAGE_EXTS.has(ext)) return { kind: "image", mime: `image/${ext}`, ext };
  if (VIDEO_EXTS.has(ext)) return { kind: "video", mime: `video/${ext}`, ext };
  if (AUDIO_EXTS.has(ext)) return { kind: "audio", mime: `audio/${ext}`, ext };

  return {
    kind: "unknown",
    mime: clientMime || "application/octet-stream",
    ext,
  };
}

export { EXT_MIME, IMAGE_EXTS, VIDEO_EXTS, AUDIO_EXTS };
