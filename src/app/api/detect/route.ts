import { guard, json, errorJson } from "@/lib/api";
import { detectType } from "@/lib/detect";
import { getAvailableOutputs } from "@/lib/converters/registry";
import { validatePublicUrl } from "@/lib/security";
import type { DetectInput } from "@/lib/types";

export const runtime = "nodejs";

/**
 * POST /api/detect
 * Body: { files?: {name, type, size}[], url?: string }
 * Returns the detected input kind and the available output options so the UI
 * can populate the format dropdown before any upload happens.
 */
export async function POST(req: Request) {
  const limited = guard(req);
  if (limited) return limited;

  let body: {
    files?: { name: string; type?: string; size?: number }[];
    url?: string;
  };
  try {
    body = await req.json();
  } catch {
    return errorJson("Invalid JSON body.");
  }

  // URL path.
  if (body.url) {
    const check = validatePublicUrl(body.url);
    if (!check.ok) return errorJson(check.reason ?? "Invalid URL.");
    const input: DetectInput = {
      kind: "link",
      mime: "",
      ext: "",
      url: check.url!.toString(),
      fileCount: 1,
    };
    return json({
      kind: "link",
      outputs: getAvailableOutputs(input),
    });
  }

  // File(s) path.
  const files = body.files ?? [];
  if (files.length === 0) {
    return errorJson("Provide files or a url to detect.");
  }

  // Detect from the first file (mixed selections are handled per-file at upload).
  const first = files[0];
  const det = detectType(first.name, first.type);
  const input: DetectInput = {
    kind: det.kind,
    mime: det.mime,
    ext: det.ext,
    fileCount: files.length,
  };

  // Multiple files of any kind also unlock a "bundle to ZIP" option.
  const outputs = getAvailableOutputs(input);
  if (files.length > 1) {
    outputs.push({
      id: "archive:zip",
      label: `Bundle ${files.length} files → ZIP`,
      description: "Combine all selected files into a single ZIP archive",
      converter: "archive",
    });
  }

  return json({
    kind: det.kind,
    mime: det.mime,
    ext: det.ext,
    outputs,
  });
}
