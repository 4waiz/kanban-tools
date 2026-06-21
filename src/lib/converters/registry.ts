import "server-only";
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
 * Converter registry - the single place converters are wired in.
 *
 * To add a new converter: implement the `Converter` contract in a new file and
 * append it here. Detection + output discovery + execution all flow through
 * these helpers, so nothing else needs to change.
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

/** First converter that recognizes the input. */
export function findConverter(input: DetectInput): Converter | undefined {
  return converters.find((c) => c.detect(input));
}

/** Aggregate every output option offered for an input, across all converters. */
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

/** Find which converter owns a given output option id. */
export function converterForOutput(outputId: string): Converter | undefined {
  const prefix = outputId.split(":")[0] as ConverterId;
  // Output ids are namespaced by converter ("image:webp", "pdf:jpg", …),
  // except video/audio which both use the "video" converter.
  const direct = byId.get(prefix);
  if (direct) return direct;
  // Fallback: scan options (rare).
  return undefined;
}
