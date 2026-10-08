import { describe, expect, it } from "vitest";
import { imageContentType, resolveImagePath } from "@/shared/markdown/image-path";

describe("imageContentType", () => {
  it("knows the seven image extensions, case-insensitively", () => {
    expect(imageContentType("a/b.png")).toBe("image/png");
    expect(imageContentType("a.JPG")).toBe("image/jpeg");
    expect(imageContentType("a.jpeg")).toBe("image/jpeg");
    expect(imageContentType("a.gif")).toBe("image/gif");
    expect(imageContentType("a.webp")).toBe("image/webp");
    expect(imageContentType("a.avif")).toBe("image/avif");
    expect(imageContentType("a.svg")).toBe("image/svg+xml");
  });
  it("refuses everything else, including names that are object keys", () => {
    for (const path of ["a.pdf", "a.html", "a.png.exe", "png", "a.", "a.constructor", "a.toString", ""]) expect(imageContentType(path)).toBeNull();
  });
});

describe("resolveImagePath", () => {
  it("resolves against the document's folder", () => {
    expect(resolveImagePath("guides/setup.md", "img/a.png")).toBe("guides/img/a.png");
    expect(resolveImagePath("guides/setup.md", "./a.png")).toBe("guides/a.png");
    expect(resolveImagePath("guides/deep/setup.md", "../a.png")).toBe("guides/a.png");
    expect(resolveImagePath("setup.md", "a.png")).toBe("a.png");
  });
  it("treats a leading slash as the source root", () => {
    expect(resolveImagePath("guides/setup.md", "/assets/a.png")).toBe("assets/a.png");
  });
  it("decodes percent-encoding and drops query and fragment", () => {
    expect(resolveImagePath("a.md", "my%20image.png?v=2#x")).toBe("my image.png");
  });
  it("returns null for anything that leaves the root or is not a relative path", () => {
    for (const src of ["../../a.png", "/../a.png", "a/../../../b.png", "https://x.test/a.png", "//x.test/a.png", "data:image/png;base64,AA", "a\\b.png", "%E0%A4%A", "a%00.png", "", "   ", "?x", "."]) {
      expect(resolveImagePath("guides/setup.md", src), src).toBeNull();
    }
    expect(resolveImagePath("setup.md", "../a.png")).toBeNull();
  });
});
