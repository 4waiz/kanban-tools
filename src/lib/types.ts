/**
 * Shared domain types for Kanban Tools.
 *
 * These describe the contract between the plugin converters, the job manager,
 * and the API/UI layers. Keeping them in one place makes the converter system
 * easy to extend without circular imports.
 */

/** Lifecycle of a conversion job. */
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
 * `id` is what the client sends back to /api/convert; it's converter-defined.
 */
export interface OutputOption {
  /** Stable identifier, e.g. "image:webp", "pdf:jpg", "video:mp3". */
  id: string;
  /** Short label shown in the dropdown, e.g. "WebP". */
  label: string;
  /** Optional longer description / hint. */
  description?: string;
  /** Which converter handles this option. */
  converter: ConverterId;
  /**
   * Optional declarative parameters this option accepts (width, quality, …).
   * The UI renders simple controls for these; convert() reads job.params.
   */
  params?: OutputParamSpec[];
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

/** Lightweight description of an uploaded input file. */
export interface InputFileInfo {
  /** Sanitized base name actually stored on disk (no path components). */
  storedName: string;
  /** Original client-provided file name (display only, never used for fs). */
  originalName: string;
  /** Best-guess MIME type. */
  mime: string;
  /** Lowercased extension without the dot, e.g. "png". */
  ext: string;
  /** Size in bytes. */
  size: number;
}

/** A produced output artifact living in the job's `output/` directory. */
export interface OutputFileInfo {
  /** File name within the job output dir. */
  name: string;
  size: number;
  mime: string;
}

/** Persisted job record (also written to metadata.json in the job dir). */
export interface Job {
  id: string;
  /**
   * Per-job secret token. Required to download/delete the job's files so that
   * knowing a job id alone is not enough to read someone else's output.
   * PRODUCTION UPGRADE: tie this to an authenticated session/user id.
   */
  token: string;
  status: JobStatus;
  createdAt: number;
  updatedAt: number;
  /** 0–100 progress for the active operation (best-effort). */
  progress: number;
  /** Chosen output option id (set when conversion starts). */
  outputId?: string;
  /** Free-form parameters for the operation (width, quality, url, …). */
  params: Record<string, string | number | boolean>;
  inputs: InputFileInfo[];
  outputs: OutputFileInfo[];
  /**
   * If multiple outputs were produced they are zipped; this is the zip name in
   * the output dir (download serves this single file).
   */
  bundleName?: string;
  /** Human-readable error message when status === "failed". */
  error?: string;
  /** Detected input kind for the primary input. */
  inputKind: InputKind;
}

/** What a converter receives to do its work. */
export interface ConvertContext {
  job: Job;
  /** Absolute path to this job's root dir. */
  jobDir: string;
  /** Absolute path to the input dir (uploaded files live here). */
  inputDir: string;
  /** Absolute path to the output dir (write results here). */
  outputDir: string;
  /** Report progress 0–100 (best-effort, throttled by caller). */
  onProgress: (pct: number) => void;
}

/** Result returned by a converter's convert(). */
export interface ConvertResult {
  outputs: OutputFileInfo[];
}

/**
 * The plugin contract. Every file under src/lib/converters/*.ts implements this.
 * Adding a new converter is: implement this + register it in registry.ts.
 */
export interface Converter {
  id: ConverterId;
  /** Does this converter recognize the given input? (by mime/ext/kind) */
  detect(input: DetectInput): boolean;
  /** Output options for a recognized input. */
  getAvailableOutputs(input: DetectInput): OutputOption[];
  /** Perform the conversion for the chosen job.outputId. */
  convert(ctx: ConvertContext): Promise<ConvertResult>;
}

/** Minimal info needed for detection (works for files and links). */
export interface DetectInput {
  kind: InputKind;
  mime: string;
  ext: string;
  /** Present for link inputs. */
  url?: string;
  /** Number of input files (some options only apply to multiples). */
  fileCount: number;
}
