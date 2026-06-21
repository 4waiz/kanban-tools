import { describe, it, expect } from "vitest";
import { detectType, sniffMagicBytes } from "./detect";

/** Helper to build a Buffer from an array of byte values. */
function bytes(...vals: number[]): Buffer {
  return Buffer.from(vals);
}

describe("sniffMagicBytes", () => {
  it("recognizes PNG", () => {
    expect(sniffMagicBytes(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe(
      "image/png",
    );
  });

  it("recognizes JPEG", () => {
    expect(sniffMagicBytes(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
  });

  it("recognizes PDF", () => {
    expect(sniffMagicBytes(bytes(0x25, 0x50, 0x44, 0x46, 0x2d))).toBe(
      "application/pdf",
    );
  });

  it("recognizes ZIP", () => {
    expect(sniffMagicBytes(bytes(0x50, 0x4b, 0x03, 0x04))).toBe("application/zip");
  });

  it("recognizes RIFF/WEBP and RIFF/WAVE", () => {
    const webp = Buffer.concat([
      Buffer.from("RIFF"),
      bytes(0, 0, 0, 0),
      Buffer.from("WEBP"),
    ]);
    const wave = Buffer.concat([
      Buffer.from("RIFF"),
      bytes(0, 0, 0, 0),
      Buffer.from("WAVE"),
    ]);
    expect(sniffMagicBytes(webp)).toBe("image/webp");
    expect(sniffMagicBytes(wave)).toBe("audio/wav");
  });

  it("recognizes ISO-BMFF mp4 via ftyp", () => {
    const mp4 = Buffer.concat([
      bytes(0, 0, 0, 0x18),
      Buffer.from("ftyp"),
      Buffer.from("isom"),
    ]);
    expect(sniffMagicBytes(mp4)).toBe("video/mp4");
  });

  it("returns null for unknown bytes", () => {
    expect(sniffMagicBytes(bytes(0x00, 0x01, 0x02, 0x03))).toBeNull();
  });
});

describe("detectType", () => {
  it("uses magic bytes over a misleading extension", () => {
    // A PNG payload with a .jpg name should be detected as png.
    const png = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    const res = detectType("photo.jpg", "image/jpeg", png);
    expect(res.kind).toBe("image");
    expect(res.mime).toBe("image/png");
  });

  it("falls back to client mime when no magic bytes", () => {
    const res = detectType("clip.mp4", "video/mp4");
    expect(res.kind).toBe("video");
    expect(res.mime).toBe("video/mp4");
  });

  it("falls back to extension when mime is generic", () => {
    const res = detectType("archive.zip", "application/octet-stream");
    expect(res.kind).toBe("archive");
    expect(res.mime).toBe("application/zip");
  });

  it("classifies common kinds by extension", () => {
    expect(detectType("a.png").kind).toBe("image");
    expect(detectType("a.pdf").kind).toBe("pdf");
    expect(detectType("a.webm").kind).toBe("video");
    expect(detectType("a.mp3").kind).toBe("audio");
    expect(detectType("a.zip").kind).toBe("archive");
  });

  it("returns unknown for unrecognized inputs", () => {
    const res = detectType("mystery.xyz");
    expect(res.kind).toBe("unknown");
  });

  it("disambiguates webm vs matroska by extension", () => {
    const ebml = bytes(0x1a, 0x45, 0xdf, 0xa3);
    expect(detectType("v.webm", undefined, ebml).mime).toBe("video/webm");
    expect(detectType("v.mkv", undefined, ebml).mime).toBe("video/x-matroska");
  });
});
