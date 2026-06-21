import { describe, it, expect } from "vitest";
import path from "node:path";
import {
  sanitizeFilename,
  getExtension,
  safeJoin,
  isInside,
  isValidJobId,
  isValidToken,
  validatePublicUrl,
  isPrivateOrReservedIp,
  PathTraversalError,
} from "./security";

describe("sanitizeFilename", () => {
  it("strips directory components and traversal", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFilename("..\\..\\boot.ini")).toBe("boot.ini");
    expect(sanitizeFilename("/usr/local/bin/thing.sh")).toBe("thing.sh");
  });

  it("reduces dot-only names to a safe default", () => {
    expect(sanitizeFilename("..")).toBe("file");
    expect(sanitizeFilename(".")).toBe("file");
    expect(sanitizeFilename("")).toBe("file");
  });

  it("removes characters illegal on Windows and collapses spaces", () => {
    expect(sanitizeFilename('my:weird"name?.png')).toBe("my_weird_name.png");
    expect(sanitizeFilename("My Photo (1).PNG")).toBe("My_Photo_(1).png");
  });

  it("strips control characters", () => {
    const dirty = "he" + String.fromCharCode(7) + "llo" + String.fromCharCode(0) + ".txt";
    expect(sanitizeFilename(dirty)).toBe("hello.txt");
  });

  it("preserves and lowercases the extension", () => {
    expect(sanitizeFilename("Report.PDF")).toBe("Report.pdf");
    expect(getExtension("Report.PDF")).toBe("pdf");
    expect(getExtension("noext")).toBe("");
  });

  it("bounds very long names", () => {
    const long = "a".repeat(500) + ".png";
    const out = sanitizeFilename(long);
    expect(out.length).toBeLessThanOrEqual(180);
    expect(out.endsWith(".png")).toBe(true);
  });
});

describe("safeJoin / isInside", () => {
  const root = path.resolve("/tmp/jobroot");

  it("joins safe segments inside the root", () => {
    const p = safeJoin(root, "input", "file.png");
    expect(isInside(root, p)).toBe(true);
  });

  it("throws on traversal segments", () => {
    expect(() => safeJoin(root, "..", "..", "etc")).toThrow(PathTraversalError);
    expect(() => safeJoin(root, "../../escape.txt")).toThrow(PathTraversalError);
  });

  it("throws on absolute escape", () => {
    expect(() => safeJoin(root, "/etc/passwd")).toThrow(PathTraversalError);
  });

  it("isInside rejects the root itself and outside paths", () => {
    expect(isInside(root, root)).toBe(false);
    expect(isInside(root, path.resolve("/tmp/other"))).toBe(false);
    expect(isInside(root, path.join(root, "a"))).toBe(true);
  });
});

describe("id / token validation", () => {
  it("accepts well-formed ids and tokens", () => {
    expect(isValidJobId("aB3_dE5fghij")).toBe(true); // 12 chars
    expect(isValidToken("a".repeat(32))).toBe(true);
  });
  it("rejects malformed or traversal-shaped ids", () => {
    expect(isValidJobId("../etc")).toBe(false);
    expect(isValidJobId("short")).toBe(false);
    expect(isValidJobId("has space")).toBe(false);
    expect(isValidJobId("toolong".repeat(10))).toBe(false);
    expect(isValidToken("short")).toBe(false);
  });
});

describe("validatePublicUrl", () => {
  it("accepts public http/https URLs", () => {
    expect(validatePublicUrl("https://example.com/file.pdf").ok).toBe(true);
    expect(validatePublicUrl("http://cdn.example.org/a.png").ok).toBe(true);
  });

  it("rejects non-http protocols", () => {
    expect(validatePublicUrl("ftp://example.com/x").ok).toBe(false);
    expect(validatePublicUrl("file:///etc/passwd").ok).toBe(false);
    expect(validatePublicUrl("javascript:alert(1)").ok).toBe(false);
  });

  it("rejects localhost and private/link-local/metadata hosts (SSRF)", () => {
    expect(validatePublicUrl("http://localhost/x").ok).toBe(false);
    expect(validatePublicUrl("http://127.0.0.1/x").ok).toBe(false);
    expect(validatePublicUrl("http://10.0.0.5/x").ok).toBe(false);
    expect(validatePublicUrl("http://192.168.1.1/x").ok).toBe(false);
    expect(validatePublicUrl("http://172.16.0.1/x").ok).toBe(false);
    expect(validatePublicUrl("http://169.254.169.254/latest/meta-data").ok).toBe(false);
    expect(validatePublicUrl("http://service.internal/x").ok).toBe(false);
  });

  it("rejects garbage", () => {
    expect(validatePublicUrl("not a url").ok).toBe(false);
    expect(validatePublicUrl("").ok).toBe(false);
  });
});

describe("isPrivateOrReservedIp", () => {
  it("flags IPv4 private / loopback / link-local / CGNAT ranges", () => {
    for (const ip of [
      "0.0.0.0",
      "10.0.0.1",
      "10.255.255.255",
      "127.0.0.1",
      "169.254.169.254", // cloud metadata
      "172.16.0.1",
      "172.31.255.255",
      "192.168.0.1",
      "100.64.0.1", // CGNAT
      "224.0.0.1", // multicast
      "255.255.255.255",
    ]) {
      expect(isPrivateOrReservedIp(ip), ip).toBe(true);
    }
  });

  it("allows public IPv4 addresses", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "172.15.0.1", "172.32.0.1"]) {
      expect(isPrivateOrReservedIp(ip), ip).toBe(false);
    }
  });

  it("flags IPv6 loopback / link-local / ULA / mapped", () => {
    for (const ip of [
      "::1",
      "::",
      "fe80::1",
      "fc00::1",
      "fd12:3456::1",
      "ff02::1",
      "::ffff:127.0.0.1", // mapped loopback
      "2001:db8::1", // documentation
    ]) {
      expect(isPrivateOrReservedIp(ip), ip).toBe(true);
    }
  });

  it("allows public IPv6 addresses", () => {
    expect(isPrivateOrReservedIp("2606:4700:4700::1111")).toBe(false); // Cloudflare
  });

  it("treats malformed input as unsafe", () => {
    expect(isPrivateOrReservedIp("")).toBe(true);
    expect(isPrivateOrReservedIp("999.999.999.999")).toBe(true);
  });
});
