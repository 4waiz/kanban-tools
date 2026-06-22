import type {
  Converter,
  ConvertContext,
  ConvertResult,
  DetectInput,
  OutputOption,
} from "../types";

/**
 * Link downloader — NOT available in the browser-only build.
 *
 * Downloading a third-party URL from the browser is blocked by CORS for almost
 * every host, and public media-page extraction (yt-dlp) requires a native tool.
 * We keep the option visible-but-disabled so the UI communicates the full
 * product vision and explains why it's off here.
 */
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
        description: "Fetch a public file or video you're allowed to keep",
        converter: "link",
        unavailableReason:
          "The link downloader needs a server (CORS + yt-dlp) and isn't available in the browser-only version.",
      },
    ];
  },

  async convert(_ctx: ConvertContext): Promise<ConvertResult> {
    throw new Error(
      "The link downloader isn't available in the browser-only version.",
    );
  },
};
