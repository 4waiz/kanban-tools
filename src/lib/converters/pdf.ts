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
 * Browser PDF converter — renders pages to images with pdf.js (Mozilla's
 * PDF renderer, pure JS/WASM). Covers PDF → PNG / JPG pages.
 *
 * PDF → SVG and PDF "compress" need native tools (Poppler's pdftocairo /
 * Ghostscript) that can't run in the browser, so they're surfaced as disabled
 * options with an explanation.
 */

// pdf.js is loaded lazily so it isn't in the initial bundle.
let pdfjsLib: typeof import("pdfjs-dist") | null = null;

async function loadPdfjs() {
  if (pdfjsLib) return pdfjsLib;
  const lib = await import("pdfjs-dist");
  // The worker is bundled by Next; point pdf.js at it via a module worker URL.
  const workerUrl = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  );
  lib.GlobalWorkerOptions.workerSrc = workerUrl.toString();
  pdfjsLib = lib;
  return lib;
}

export const pdfConverter: Converter = {
  id: "pdf",

  detect(input: DetectInput): boolean {
    return input.kind === "pdf";
  },

  getAvailableOutputs(input: DetectInput): OutputOption[] {
    if (input.kind !== "pdf") return [];
    const scaleParam = {
      key: "scale",
      label: "Resolution",
      type: "select" as const,
      default: "2",
      options: [
        { value: "1", label: "Standard (1x)" },
        { value: "2", label: "High (2x)" },
        { value: "3", label: "Very high (3x)" },
      ],
    };
    return [
      {
        id: "pdf:png",
        label: "PNG pages",
        description: "Render each page to a PNG image",
        converter: "pdf",
        params: [scaleParam],
      },
      {
        id: "pdf:jpg",
        label: "JPG pages",
        description: "Render each page to a JPG image",
        converter: "pdf",
        params: [
          scaleParam,
          { key: "quality", label: "Quality", type: "number", min: 10, max: 100, default: 85, unit: "%" },
        ],
      },
      {
        id: "pdf:svg",
        label: "SVG pages",
        description: "Vector SVG per page",
        converter: "pdf",
        unavailableReason:
          "SVG export needs a native tool (Poppler) and can't run in the browser.",
      },
      {
        id: "pdf:compress",
        label: "Compress PDF",
        description: "Shrink file size",
        converter: "pdf",
        unavailableReason:
          "PDF compression needs Ghostscript and can't run in the browser.",
      },
    ];
  },

  async convert(ctx: ConvertContext): Promise<ConvertResult> {
    const { files, outputId, params, onProgress, onStatus } = ctx;
    if (outputId === "pdf:svg" || outputId === "pdf:compress") {
      throw new Error(
        "This option isn't available in the browser version. Try PDF to PNG or JPG.",
      );
    }
    const file = files[0];
    if (!file) throw new Error("No PDF provided.");

    onStatus?.("Loading PDF engine…");
    const lib = await loadPdfjs();

    const data = new Uint8Array(await file.arrayBuffer());
    const doc = await lib.getDocument({ data }).promise;
    const stem = file.name.replace(/\.[^.]+$/, "") || "page";
    const isJpg = outputId === "pdf:jpg";
    const scale = Math.max(1, Math.min(3, parseInt(str(params.scale, "2"), 10) || 2));
    const quality = num(params.quality, 85) / 100;

    const outputs: OutputArtifact[] = [];
    const pageCount = doc.numPages;
    for (let p = 1; p <= pageCount; p++) {
      onStatus?.(`Rendering page ${p} of ${pageCount}…`);
      const page = await doc.getPage(p);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const cx = canvas.getContext("2d");
      if (!cx) throw new Error("Canvas is not available in this browser.");
      await page.render({ canvasContext: cx, viewport }).promise;

      const mime = isJpg ? "image/jpeg" : "image/png";
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("Failed to render page."))),
          mime,
          isJpg ? quality : undefined,
        ),
      );
      const name = `${stem}-${String(p).padStart(3, "0")}.${isJpg ? "jpg" : "png"}`;
      outputs.push({ name, blob, mime, size: blob.size });
      page.cleanup();
      onProgress(Math.round((p / pageCount) * 100));
    }

    await doc.destroy();
    if (outputs.length === 0) throw new Error("No pages were rendered.");
    return { outputs };
  },
};

function num(v: ParamValue | undefined, fallback: number): number {
  const n = typeof v === "number" ? v : parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? Math.max(1, Math.min(100, n)) : fallback;
}
function str(v: ParamValue | undefined, fallback: string): string {
  return v === undefined || v === null || v === "" ? fallback : String(v);
}
