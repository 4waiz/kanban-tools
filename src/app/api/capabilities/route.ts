import { guard, json } from "@/lib/api";
import { config } from "@/lib/config";
import { isToolAvailable } from "@/lib/exec";
import { queueStats } from "@/lib/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Cache capability probing briefly; these don't change at runtime.
let cache: { at: number; data: Record<string, boolean> } | null = null;
const TTL = 60_000;

/**
 * GET /api/capabilities
 * Reports which optional native tools are installed, so the UI can disable or
 * annotate features that aren't available in the current environment.
 */
export async function GET(req: Request) {
  const g = guard(req);
  if ("response" in g) return g.response;

  if (cache && Date.now() - cache.at < TTL) {
    return json({ tools: cache.data, limits: limitInfo(), queue: queueStats() });
  }

  const [ffmpeg, ffprobe, pdftoppm, pdftocairo, ghostscript, ytdlp] =
    await Promise.all([
      isToolAvailable(config.tools.ffmpeg, "-version"),
      isToolAvailable(config.tools.ffprobe, "-version"),
      isToolAvailable(config.tools.pdftoppm, "-v"),
      isToolAvailable(config.tools.pdftocairo, "-v"),
      isToolAvailable(config.tools.ghostscript, "--version"),
      config.link.enabled
        ? isToolAvailable(config.link.ytdlpPath, "--version")
        : Promise.resolve(false),
    ]);

  const data = {
    image: true, // Sharp is bundled
    ffmpeg,
    ffprobe,
    pdftoppm,
    pdftocairo,
    ghostscript,
    ytdlp,
    linkDownloader: config.link.enabled,
  };
  cache = { at: Date.now(), data };
  return json({ tools: data, limits: limitInfo(), queue: queueStats() });
}

function limitInfo() {
  return {
    maxFileSizeMb: config.maxFileSizeMb,
    jobTtlMinutes: Math.round(config.jobTtlMs / 60000),
  };
}
