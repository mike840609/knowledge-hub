// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ReviewPassageMarkers } from "@/components/knowledge/review-passage-markers";

// Launcher audit (axe `aria-prohibited-attr`): the marker layer labelled itself with
// `aria-label` on a plain div, which ARIA does not allow. A group is what it is — the
// layer holds one control per passage — so the label is legal and announced.
describe("the passage-marker layer", () => {
  it("is a labelled group rather than a bare div carrying an aria-label", () => {
    const html = renderToStaticMarkup(
      <ReviewPassageMarkers readingRef={createRef<HTMLDivElement>()} markdown={"A paragraph."} threads={[]} />,
    );
    document.body.innerHTML = html;
    const layer = document.body.firstElementChild!;
    expect(layer.getAttribute("role")).toBe("group");
    expect(layer.getAttribute("aria-label")).toBe("Passage comments");
  });
});
