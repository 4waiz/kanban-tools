"use client";

/**
 * Browser capability detection. Replaces the old server `/api/capabilities`.
 * All conversion happens client-side, so "capabilities" = what THIS browser can
 * do: cross-origin isolation (needed for ffmpeg.wasm video/audio), and AVIF
 * encoding support.
 */

export interface BrowserCapabilities {
  /** SharedArrayBuffer / ffmpeg.wasm available (requires COOP+COEP). */
  crossOriginIsolated: boolean;
  /** Can the Canvas encode AVIF output? */
  avifEncode: boolean;
  /** Can the Canvas encode WebP output? */
  webpEncode: boolean;
}

let cached: BrowserCapabilities | null = null;

export async function getBrowserCapabilities(): Promise<BrowserCapabilities> {
  if (cached) return cached;

  const coi =
    typeof globalThis !== "undefined" &&
    typeof globalThis.crossOriginIsolated === "boolean"
      ? globalThis.crossOriginIsolated
      : false;

  cached = {
    crossOriginIsolated: coi,
    avifEncode: await canEncode("image/avif"),
    webpEncode: await canEncode("image/webp"),
  };
  return cached;
}

/** True if the canvas can produce a Blob of the given mime type. */
async function canEncode(mime: string): Promise<boolean> {
  if (typeof document === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 2;
    canvas.height = 2;
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), mime, 0.8),
    );
    return !!blob && blob.type === mime;
  } catch {
    return false;
  }
}

/**
 * Map a converter/output to whether it can run in this browser. Used by the
 * Tools page to grey out things that won't work here.
 */
export function isOutputRunnable(
  outputId: string,
  caps: BrowserCapabilities,
): { ok: boolean; reason?: string } {
  // Native-only operations are never runnable in-browser.
  if (
    outputId === "pdf:svg" ||
    outputId === "pdf:compress" ||
    outputId.startsWith("link:")
  ) {
    return { ok: false, reason: "Needs a server / native tool." };
  }
  // Video/audio needs cross-origin isolation for ffmpeg.wasm.
  if (outputId.startsWith("video:") && !caps.crossOriginIsolated) {
    return {
      ok: false,
      reason:
        "Video/audio needs a cross-origin-isolated page (COOP/COEP). Works on the deployed site.",
    };
  }
  return { ok: true };
}
