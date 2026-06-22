import type {
  Converter,
  ConverterId,
  DetectInput,
  OutputOption,
} from "../types";
import { imageConverter } from "./image";
import { pdfConverter } from "./pdf";
import { videoConverter } from "./video";
import { archiveConverter } from "./archive";
import { linkConverter } from "./link";

/**
 * Converter registry — the single place converters are wired in.
 *
 * To add a converter: implement the `Converter` contract in a new file and add
 * it here. Output option ids are namespaced by converter ("image:webp",
 * "pdf:jpg", "video:mp3", …) so routing an option to its converter is automatic.
 */

export const converters: Converter[] = [
  imageConverter,
  pdfConverter,
  videoConverter,
  archiveConverter,
  linkConverter,
];

const byId = new Map<ConverterId, Converter>(converters.map((c) => [c.id, c]));

export function getConverter(id: ConverterId): Converter | undefined {
  return byId.get(id);
}

export function findConverter(input: DetectInput): Converter | undefined {
  return converters.find((c) => c.detect(input));
}

export function getAvailableOutputs(input: DetectInput): OutputOption[] {
  const seen = new Set<string>();
  const out: OutputOption[] = [];
  for (const c of converters) {
    if (!c.detect(input)) continue;
    for (const opt of c.getAvailableOutputs(input)) {
      if (seen.has(opt.id)) continue;
      seen.add(opt.id);
      out.push(opt);
    }
  }
  return out;
}

export function converterForOutput(outputId: string): Converter | undefined {
  const prefix = outputId.split(":")[0] as ConverterId;
  return byId.get(prefix);
}
