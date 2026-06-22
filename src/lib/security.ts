/**
 * Filename safety utilities (browser-safe — no Node APIs).
 *
 * In the browser build there's no filesystem to traverse, but we still sanitize
 * names so downloaded files and zip entries have safe, predictable names across
 * OSes (no control chars, no characters illegal on Windows, no path separators).
 */

const MAX_NAME_LEN = 180;

// Control characters (0x00-0x1F and 0x7F) are stripped from filenames.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = new RegExp("[\u0000-\u001f\u007f]", "g");

/**
 * Turn an arbitrary filename into a safe single path segment.
 * - strips any directory components (handles both / and \)
 * - removes control chars and characters illegal on Windows
 * - collapses whitespace/dots, prevents empty / dotfile-only names
 * - preserves a reasonable extension
 */
export function sanitizeFilename(input: string): string {
  const base = (input ?? "").split(/[\\/]/).pop() ?? "";

  const extMatch = base.match(/\.([A-Za-z0-9]{1,12})$/);
  const ext = extMatch ? extMatch[1].toLowerCase() : "";
  let stem = ext ? base.slice(0, -(ext.length + 1)) : base;

  stem = stem
    .replace(CONTROL_CHARS, "")
    .replace(/[<>:"/\\|?*]/g, "_") // illegal on Windows
    .replace(/\s+/g, "_") // no spaces
    .replace(/^\.+/, "") // no leading dots (dotfiles / "..")
    .replace(/[._]+$/g, "") // no trailing dot/underscore
    .replace(/_{2,}/g, "_"); // collapse repeats

  if (!stem) stem = "file";

  let out = ext ? `${stem}.${ext}` : stem;
  if (out.length > MAX_NAME_LEN) {
    const keep = ext ? MAX_NAME_LEN - ext.length - 1 : MAX_NAME_LEN;
    out = ext ? `${stem.slice(0, keep)}.${ext}` : stem.slice(0, keep);
  }
  return out;
}

/** Lowercased extension without the dot ("" if none). */
export function getExtension(filename: string): string {
  const m = (filename ?? "").match(/\.([A-Za-z0-9]{1,12})$/);
  return m ? m[1].toLowerCase() : "";
}
