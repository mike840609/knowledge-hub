// @vitest-environment jsdom
import { expect, test, vi } from "vitest";
import * as projection from "@/modules/knowledge/domain/review-anchor";
import { createReviewRangeResolver } from "@/components/knowledge/review-selection";

test("a long article is parsed once for multiple ranges, which survive text reflow", () => {
  const paragraphs = Array.from({ length: 400 }, (_, index) => `Paragraph ${index} for review.`);
  document.body.innerHTML = `<article>${paragraphs.map(text => `<p>${text}</p>`).join("")}</article>`;
  const root = document.querySelector("article")!;
  const parse = vi.spyOn(projection, "projectReviewBlocks");
  try {
    const resolve = createReviewRangeResolver(root, paragraphs.join("\n\n"));
    const ranges = Array.from({ length: 20 }, (_, index) => resolve({
      schemaVersion: 1, blockPath: [index * 20], blockKind: "paragraph", startUtf16: 0, endUtf16: 9,
      exact: "Paragraph", prefix: "", suffix: "",
    }));
    expect(ranges.every(range => range?.toString() === "Paragraph")).toBe(true);
    root.style.width = "320px";
    expect(ranges.every(range => range?.toString() === "Paragraph")).toBe(true);
    expect(parse).toHaveBeenCalledTimes(1);
    // Cached projection must retain the same mismatch safeguards.
    root.querySelector("p")!.textContent = "Changed content";
    expect(resolve({ schemaVersion: 1, blockPath: [0], blockKind: "paragraph", startUtf16: 0, endUtf16: 9, exact: "Paragraph", prefix: "", suffix: "" })).toBeNull();
  } finally { parse.mockRestore(); }
});
