import { describe, it, expect } from "vitest";
import { sanitizeFilename, getExtension } from "./security";

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
    const dirty =
      "he" + String.fromCharCode(7) + "llo" + String.fromCharCode(0) + ".txt";
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
