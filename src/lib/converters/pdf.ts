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
 * PDF converter.
 *
 *   PDF → PNG / JPG  : Poppler `pdftoppm` (one image per page)
 *   PDF → SVG        : Poppler `pdftocairo -svg` (one SVG per page)
 *   PDF compress     : Ghostscript with a downsampling preset
 *
 * All external tools are invoked via execFile (spawn, no shell). Output file
 * names are tool-generated within the isolated output dir, so user input never
 * reaches a path.
 */

export const pdfConverter: Converter = {
  id: "pdf",

  detect(input: DetectInput): boolean {
    return input.kind === "pdf";
  },

  getAvailableOutputs(input: DetectInput): OutputOption[] {
    if (input.kind !== "pdf") return [];
    const dpiParam = {
      key: "dpi",
      label: "Resolution",
      type: "number" as const,
      min: 72,
      max: 600,
      step: 1,
      default: 150,
      unit: "dpi",
    };
    return [
      {
        id: "pdf:png",
        label: "PNG pages",
        description: "Render each page to a PNG image",
        converter: "pdf",
        params: [dpiParam],
      },
      {
        id: "pdf:jpg",
        label: "JPG pages",
        description: "Render each page to a JPG image",
        converter: "pdf",
        params: [
          dpiParam,
          {
            key: "quality",
            label: "Quality",
            type: "number",
            min: 10,
            max: 100,
            default: 85,
            unit: "%",
          },
        ],
      },
      {
        id: "pdf:svg",
        label: "SVG pages",
        description: "Vector SVG per page (best for vector-based PDFs)",
        converter: "pdf",
      },
      {
        id: "pdf:compress",
        label: "Compress PDF",
        description: "Shrink file size by downsampling images",
        converter: "pdf",
        params: [
          {
            key: "preset",
            label: "Target",
            type: "select",
            default: "ebook",
            options: [
              { value: "screen", label: "Smallest (screen, 72dpi)" },
              { value: "ebook", label: "Balanced (ebook, 150dpi)" },
              { value: "printer", label: "High quality (printer, 300dpi)" },
            ],
          },
        ],
      },
    ];
  },

  async convert(ctx: ConvertContext): Promise<ConvertResult> {
    const { job, inputDir, outputDir, onProgress } = ctx;
    const outputId = job.outputId ?? "";
    // PDF operations act on the first input file only.
    const input = job.inputs[0];
    if (!input) throw new Error("No PDF provided.");
    const srcPath = safeJoin(inputDir, input.storedName);
    const stem = input.storedName.replace(/\.[^.]+$/, "");

    onProgress(5);

    if (outputId === "pdf:png" || outputId === "pdf:jpg") {
      const isJpg = outputId === "pdf:jpg";
      const dpi = clampInt(job.params.dpi, 72, 600, 150);
      const prefix = safeJoin(outputDir, stem);
      const args = isJpg
        ? ["-jpeg", "-jpegopt", `quality=${clampInt(job.params.quality, 10, 100, 85)}`, "-r", String(dpi), srcPath, prefix]
        : ["-png", "-r", String(dpi), srcPath, prefix];
      await execFile(config.tools.pdftoppm, args, {
        cwd: outputDir,
        timeoutMs: 10 * 60 * 1000,
      });
      onProgress(90);
      return { outputs: await listOutputs(outputDir, isJpg ? /\.jpe?g$/i : /\.png$/i) };
    }

    if (outputId === "pdf:svg") {
      // pdftocairo writes one SVG per page when given a %d-style output and -svg.
      // It only emits a single file per invocation, so we loop pages.
      const pageCount = await getPdfPageCount(srcPath);
      const outputs: OutputFileInfo[] = [];
      for (let page = 1; page <= pageCount; page++) {
        const outName = `${stem}-${String(page).padStart(3, "0")}.svg`;
        const outPath = safeJoin(outputDir, outName);
        await execFile(
          config.tools.pdftocairo,
          ["-svg", "-f", String(page), "-l", String(page), srcPath, outPath],
          { cwd: outputDir, timeoutMs: 5 * 60 * 1000 },
        );
        const stat = await fs.stat(outPath).catch(() => null);
        if (stat) {
          outputs.push({ name: outName, size: stat.size, mime: "image/svg+xml" });
        }
        onProgress(5 + Math.round((page / pageCount) * 85));
      }
      if (outputs.length === 0) {
        throw new Error("No SVG pages were produced from this PDF.");
      }
      return { outputs };
    }

    if (outputId === "pdf:compress") {
      const preset = ["screen", "ebook", "printer"].includes(String(job.params.preset))
        ? String(job.params.preset)
        : "ebook";
      const outName = `${stem}-compressed.pdf`;
      const outPath = safeJoin(outputDir, outName);
      await execFile(
        config.tools.ghostscript,
        [
          "-sDEVICE=pdfwrite",
          "-dCompatibilityLevel=1.4",
          `-dPDFSETTINGS=/${preset}`,
          "-dNOPAUSE",
          "-dQUIET",
          "-dBATCH",
          "-dSAFER",
          `-sOutputFile=${outPath}`,
          srcPath,
        ],
        { cwd: outputDir, timeoutMs: 10 * 60 * 1000 },
      );
      onProgress(95);
      const stat = await fs.stat(outPath);
      return {
        outputs: [{ name: outName, size: stat.size, mime: "application/pdf" }],
      };
    }

    throw new Error(`Unsupported PDF operation: ${outputId}`);
  },
};

/** List produced files in the output dir matching a pattern, sorted by name. */
async function listOutputs(dir: string, pattern: RegExp): Promise<OutputFileInfo[]> {
  const names = (await fs.readdir(dir)).filter((n) => pattern.test(n)).sort();
  const out: OutputFileInfo[] = [];
  for (const name of names) {
    const stat = await fs.stat(safeJoin(dir, name));
    out.push({
      name,
      size: stat.size,
      mime: /\.png$/i.test(name) ? "image/png" : "image/jpeg",
    });
  }
  if (out.length === 0) throw new Error("No pages were rendered from this PDF.");
  return out;
}

/**
 * Get a PDF's page count via Poppler's `pdfinfo` if present; otherwise fall
 * back to a generous default. We keep this dependency-light by parsing stdout.
 */
async function getPdfPageCount(srcPath: string): Promise<number> {
  // pdftocairo ships alongside pdfinfo in poppler-utils; try pdfinfo first.
  try {
    const res = await execFile("pdfinfo", [srcPath], { timeoutMs: 30_000 });
    const m = res.stdout.match(/Pages:\s+(\d+)/);
    if (m) return Math.max(1, Math.min(2000, parseInt(m[1], 10)));
  } catch {
    /* pdfinfo not available - fall through */
  }
  // Conservative cap so a malformed file can't spin forever.
  return 50;
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === "number" ? v : parseInt(String(v ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}
