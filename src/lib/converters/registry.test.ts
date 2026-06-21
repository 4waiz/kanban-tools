import { describe, it, expect } from "vitest";
import {
  findConverter,
  getAvailableOutputs,
  converterForOutput,
} from "./registry";
import type { DetectInput } from "../types";

function input(partial: Partial<DetectInput>): DetectInput {
  return {
    kind: "unknown",
    mime: "",
    ext: "",
    fileCount: 1,
    ...partial,
  };
}

describe("converter detection", () => {
  it("routes images to the image converter", () => {
    const c = findConverter(input({ kind: "image", mime: "image/png", ext: "png" }));
    expect(c?.id).toBe("image");
  });

  it("routes pdf to the pdf converter", () => {
    const c = findConverter(input({ kind: "pdf", mime: "application/pdf", ext: "pdf" }));
    expect(c?.id).toBe("pdf");
  });

  it("routes video and audio to the video converter", () => {
    expect(findConverter(input({ kind: "video", ext: "mp4" }))?.id).toBe("video");
    expect(findConverter(input({ kind: "audio", ext: "mp3" }))?.id).toBe("video");
  });

  it("routes archives to the archive converter", () => {
    const c = findConverter(input({ kind: "archive", mime: "application/zip", ext: "zip" }));
    expect(c?.id).toBe("archive");
  });

  it("routes links to the link converter", () => {
    const c = findConverter(input({ kind: "link", url: "https://x.com/a" }));
    expect(c?.id).toBe("link");
  });

  it("returns undefined for unknown kinds", () => {
    expect(findConverter(input({ kind: "unknown" }))).toBeUndefined();
  });
});

describe("available outputs", () => {
  it("offers format conversions + edits for images", () => {
    const outs = getAvailableOutputs(
      input({ kind: "image", mime: "image/png", ext: "png" }),
    );
    const ids = outs.map((o) => o.id);
    expect(ids).toContain("image:webp");
    expect(ids).toContain("image:jpg");
    expect(ids).toContain("image:avif");
    expect(ids).toContain("image:resize");
    expect(ids).toContain("image:compress");
    expect(ids).toContain("image:upscale");
  });

  it("offers page rasterization + compress for pdf", () => {
    const outs = getAvailableOutputs(
      input({ kind: "pdf", mime: "application/pdf", ext: "pdf" }),
    );
    const ids = outs.map((o) => o.id);
    expect(ids).toEqual(
      expect.arrayContaining(["pdf:png", "pdf:jpg", "pdf:svg", "pdf:compress"]),
    );
  });

  it("offers mp4/webm/gif + audio extraction for video", () => {
    const outs = getAvailableOutputs(input({ kind: "video", ext: "mov" }));
    const ids = outs.map((o) => o.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "video:mp4",
        "video:webm",
        "video:gif",
        "video:mp3",
        "video:wav",
      ]),
    );
  });

  it("offers extract for archives", () => {
    const outs = getAvailableOutputs(
      input({ kind: "archive", mime: "application/zip", ext: "zip" }),
    );
    expect(outs.map((o) => o.id)).toContain("archive:extract");
  });

  it("offers nothing for unknown inputs", () => {
    expect(getAvailableOutputs(input({ kind: "unknown" }))).toHaveLength(0);
  });

  it("declares param specs on parameterized options", () => {
    const outs = getAvailableOutputs(input({ kind: "image", ext: "jpg" }));
    const resize = outs.find((o) => o.id === "image:resize");
    expect(resize?.params?.some((p) => p.key === "width")).toBe(true);
  });
});

describe("converterForOutput", () => {
  it("maps namespaced output ids back to their converter", () => {
    expect(converterForOutput("image:webp")?.id).toBe("image");
    expect(converterForOutput("pdf:jpg")?.id).toBe("pdf");
    expect(converterForOutput("video:mp3")?.id).toBe("video");
    expect(converterForOutput("archive:extract")?.id).toBe("archive");
    expect(converterForOutput("archive:zip")?.id).toBe("archive");
    expect(converterForOutput("link:download")?.id).toBe("link");
  });
});
