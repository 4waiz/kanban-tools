/**
 * Shared domain types for Kanban Tools (browser edition).
 *
 * Everything runs client-side: converters take the user's File objects, do the
 * work in the browser (Canvas / pdf.js / ffmpeg.wasm / fflate), and return Blob
 * artifacts the user downloads. No server, no filesystem, no job tokens.
 */

/** Lifecycle of a conversion job (client-side, in-memory). */
export type JobStatus = "pending" | "processing" | "completed" | "failed";

/** Broad input categories the app understands. */
export type InputKind =
  | "image"
  | "pdf"
  | "video"
  | "audio"
  | "archive"
  | "link"
  | "unknown";

/**
 * A single selectable output format/operation for a given input.
 * `id` is namespaced by converter, e.g. "image:webp", "pdf:jpg", "video:mp3".
 */
export interface OutputOption {
  id: string;
  label: string;
  description?: string;
  converter: ConverterId;
  /** Declarative parameters this option accepts (width, quality, …). */
  params?: OutputParamSpec[];
  /**
   * If set, this option is native-only (PDF→SVG, PDF compress, link download)
   * and cannot run in the browser. The UI shows it disabled with this reason.
   */
  unavailableReason?: string;
}

export type OutputParamSpec =
  | {
      key: string;
      label: string;
      type: "number";
      min?: number;
      max?: number;
      step?: number;
      default?: number;
      unit?: string;
    }
  | {
      key: string;
      label: string;
      type: "select";
      options: { value: string; label: string }[];
      default?: string;
    }
  | {
      key: string;
      label: string;
      type: "boolean";
      default?: boolean;
    };

export type ConverterId = "image" | "pdf" | "video" | "archive" | "link";

/** A produced output artifact (lives in memory as a Blob). */
export interface OutputArtifact {
  name: string;
  blob: Blob;
  mime: string;
  size: number;
}

/** Minimal info needed for detection. */
export interface DetectInput {
  kind: InputKind;
  mime: string;
  ext: string;
  url?: string;
  fileCount: number;
}

export type ParamValue = string | number | boolean;

/** What a browser converter receives to do its work. */
export interface ConvertContext {
  /** The user's selected files (already in memory). */
  files: File[];
  /** The chosen output option id. */
  outputId: string;
  /** Operation parameters (width, quality, fps, …). */
  params: Record<string, ParamValue>;
  /** Report progress 0–100 (best-effort). */
  onProgress: (pct: number) => void;
  /** Optional status text shown under the progress bar (e.g. "Loading FFmpeg…"). */
  onStatus?: (text: string) => void;
}

export interface ConvertResult {
  outputs: OutputArtifact[];
}

/**
 * The plugin contract. Every file under src/lib/converters/*.ts implements this.
 * Adding a converter is: implement this + register it in registry.ts.
 */
export interface Converter {
  id: ConverterId;
  detect(input: DetectInput): boolean;
  getAvailableOutputs(input: DetectInput): OutputOption[];
  convert(ctx: ConvertContext): Promise<ConvertResult>;
}

/** Lightweight client-side job record (no tokens, no server persistence). */
export interface ClientJob {
  id: string;
  status: JobStatus;
  createdAt: number;
  progress: number;
  statusText?: string;
  outputId?: string;
  inputKind: InputKind;
  inputs: { name: string; size: number; mime: string }[];
  outputs: OutputArtifact[];
  /** When >1 output, they're zipped into this single bundle. */
  bundle?: OutputArtifact;
  error?: string;
}
