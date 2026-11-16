// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ReviewPassageMarkers } from "@/components/knowledge/review-passage-markers";
import type { ReviewThreadView } from "@/modules/knowledge/domain/document-review";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Markers are placed after layout measures the article, so a static render never has one; these
// tests give the component a real article to measure.
const originalRects = Range.prototype.getClientRects;
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  // jsdom has no layout: a Range reports no rectangles, so the marker sits at the article's origin.
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }) as unknown as DOMRectList;
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  Range.prototype.getClientRects = originalRects;
});

const markdown = "A paragraph.";
const thread: ReviewThreadView = {
  id: "t1",
  status: "OPEN",
  createdAt: new Date("2026-11-01T00:00:00.000Z"),
  updatedAt: new Date("2026-11-01T00:00:00.000Z"),
  currentAnchor: {
    match: "MATCHED",
    anchor: { schemaVersion: 1, blockPath: [0], blockKind: "paragraph", startUtf16: 0, endUtf16: 12, exact: "A paragraph.", prefix: "", suffix: "" },
  },
  comments: [],
};

async function renderMarkers(threads?: ReviewThreadView[]) {
  const reading = document.createElement("div");
  reading.innerHTML = `<article data-review-document><p data-review-path="0">${markdown}</p></article>`;
  const host = document.createElement("div");
  reading.append(host);
  document.body.append(reading);
  const root = createRoot(host);
  await act(async () => root.render(<ReviewPassageMarkers readingRef={{ current: reading }} markdown={markdown} threads={threads} />));
  return { reading, root };
}

// Launcher audit (axe `aria-prohibited-attr`): the marker layer labelled itself with
// `aria-label` on a plain div, which ARIA does not allow. A group is what it is — the
// layer holds one control per passage — so the label is legal and announced.
it("is a labelled group rather than a bare div carrying an aria-label", async () => {
  const { reading, root } = await renderMarkers([thread]);
  try {
    const layer = reading.querySelector<HTMLElement>('[role="group"]')!;
    expect(layer.getAttribute("aria-label")).toBe("Passage comments");
    expect(layer.querySelectorAll("[data-review-marker]")).toHaveLength(1);
  } finally {
    await act(async () => root.unmount());
  }
});

// A group with nothing in it is a dead stop for a screen reader: nothing to enter, and a name
// promising comments that are not drawn (no threads, or every anchor outdated).
it("is not drawn at all when no passage has a marker", async () => {
  for (const threads of [undefined, []]) {
    const { reading, root } = await renderMarkers(threads);
    try {
      expect(reading.querySelector('[role="group"]')).toBeNull();
      expect(reading.querySelector("[aria-label='Passage comments']")).toBeNull();
    } finally {
      await act(async () => root.unmount());
    }
  }
});
