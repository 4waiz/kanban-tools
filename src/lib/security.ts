import path from "node:path";

/**
 * Security utilities. These are the trust boundary between untrusted user input
 * (file names, paths, archive entries) and the filesystem / shell.
 *
 * Rules enforced here:
 *  - Filenames are sanitized to a safe charset, never used raw.
 *  - Resolved paths must stay within their job directory (no traversal).
 *  - Shell is never invoked with a string; callers use spawn(arg[]) and only
 *    pass values that have been validated here.
 */

const MAX_NAME_LEN = 180;

// Control characters (0x00-0x1F and 0x7F) are stripped from filenames.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = new RegExp("[\u0000-\u001f\u007f]", "g");

/**
 * Turn an arbitrary client-supplied filename into a safe single path segment.
 * - strips any directory components (handles both / and \)
 * - removes control chars and characters illegal on Windows
 * - collapses whitespace/dots, prevents empty / dotfile-only names
 * - preserves a reasonable extension
 */
export function sanitizeFilename(input: string): string {
  // Take only the final path component; reject traversal up front.
  const base = (input ?? "").split(/[\\/]/).pop() ?? "";

  // Separate extension so we can keep it clean and bounded.
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
    // Keep the extension, truncate the stem.
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

/**
 * Resolve `child` under `root` and assert it does not escape `root`.
 * Throws on traversal. Use for EVERY path derived from user input
 * (upload names, archive entry names, requested download files).
 */
export function safeJoin(root: string, ...segments: string[]): string {
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, ...segments);
  const rel = path.relative(resolvedRoot, target);
  if (rel === "") return target; // target === root
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new PathTraversalError(
      `Path "${segments.join("/")}" escapes its base directory`,
    );
  }
  return target;
}

/** Returns true if `child` is safely contained within `root`. */
export function isInside(root: string, child: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(child));
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

export class PathTraversalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathTraversalError";
  }
}

/**
 * A job id must be exactly the shape we generate (URL-safe nanoid alphabet).
 * Validating before using it as a directory name closes off traversal via the
 * id route param.
 */
const JOB_ID_RE = /^[A-Za-z0-9_-]{10,32}$/;
export function isValidJobId(id: string): boolean {
  return typeof id === "string" && JOB_ID_RE.test(id);
}

/**
 * A per-job token: opaque URL-safe string. Same alphabet/shape check.
 */
const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;
export function isValidToken(token: string): boolean {
  return typeof token === "string" && TOKEN_RE.test(token);
}

/**
 * Classify an IP literal (v4 or v6) as private / loopback / link-local /
 * reserved — i.e. something the link downloader must never connect to. Pure and
 * synchronous so it can be unit-tested; the DNS-resolving wrapper lives in
 * ssrf.ts and feeds resolved addresses through here.
 */
export function isPrivateOrReservedIp(ip: string): boolean {
  const addr = ip.trim().toLowerCase();
  if (!addr) return true;

  // IPv4 (also handles IPv4-mapped IPv6 like ::ffff:127.0.0.1).
  const v4 = addr.startsWith("::ffff:") ? addr.slice(7) : addr;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(v4)) {
    const o = v4.split(".").map((n) => parseInt(n, 10));
    if (o.some((n) => n < 0 || n > 255)) return true; // malformed → block
    const [a, b] = o;
    if (a === 0) return true; // 0.0.0.0/8 "this host"
    if (a === 10) return true; // 10/8 private
    if (a === 127) return true; // loopback
    if (a === 169 && b === 254) return true; // link-local / cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12 private
    if (a === 192 && b === 168) return true; // 192.168/16 private
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGNAT
    if (a === 192 && b === 0) return true; // 192.0.0/24 + 192.0.2/24 (test)
    if (a === 198 && (b === 18 || b === 19)) return true; // 198.18/15 benchmark
    if (a === 198 && b === 51) return true; // 198.51.100/24 test
    if (a === 203 && b === 0) return true; // 203.0.113/24 test
    if (a >= 224) return true; // 224/4 multicast + 240/4 reserved
    return false;
  }

  // IPv6.
  if (addr === "::" || addr === "::1") return true; // unspecified / loopback
  if (addr.startsWith("fe80")) return true; // link-local
  if (addr.startsWith("fc") || addr.startsWith("fd")) return true; // ULA fc00::/7
  if (addr.startsWith("ff")) return true; // multicast
  if (addr.startsWith("::ffff:")) return true; // mapped but not dotted-quad → block
  if (addr.startsWith("2001:db8")) return true; // documentation
  if (addr.startsWith("64:ff9b")) return true; // NAT64

  // Anything we can't positively classify as public, we block when it's an IP
  // literal hostname (handled by caller). Recognized global addresses pass.
  return false;
}

/**
 * Validate a public URL for the link downloader (synchronous, structural).
 * - only http/https
 * - reject obvious internal/loopback hosts to reduce SSRF blast radius
 *
 * NOTE: this is the fast structural check. The link downloader ALSO performs a
 * DNS-resolving check (see ssrf.ts) before connecting, to defeat hostnames that
 * resolve to private IPs and DNS-rebinding.
 */
export function validatePublicUrl(raw: string): {
  ok: boolean;
  url?: URL;
  reason?: string;
} {
  let url: URL;
  try {
    url = new URL((raw ?? "").trim());
  } catch {
    return { ok: false, reason: "That doesn't look like a valid URL." };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: "Only http and https links are supported." };
  }
  const host = url.hostname.toLowerCase();
  const blockedExact = new Set([
    "localhost",
    "127.0.0.1",
    "0.0.0.0",
    "::1",
    "metadata.google.internal",
  ]);
  const isPrivateIp =
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
    /^169\.254\./.test(host) || // link-local / cloud metadata
    /^127\./.test(host) ||
    host.endsWith(".local") ||
    host.endsWith(".internal");
  if (blockedExact.has(host) || isPrivateIp) {
    return {
      ok: false,
      reason: "Internal or private network addresses are not allowed.",
    };
  }
  return { ok: true, url };
}
