// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SharedReviewPanel } from "@/components/knowledge/shared-review-panel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * A resolved discussion's passage is not marked in the text — neither highlight nor margin marker —
 * while the list is on Open, unless it is the discussion being looked at (inline review spec,
 * 2026-11-26 amendment).
 */
const markdown = "First paragraph.\n\nSecond paragraph.";
const highlights = new Map<string, { ranges: Range[] }>();
const originalRects = Range.prototype.getClientRects;
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("Highlight", class { ranges: Range[]; constructor(...ranges: Range[]) { this.ranges = ranges; } });
  (globalThis.CSS as unknown as { highlights?: unknown }) = { highlights } as never;
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }) as unknown as DOMRectList;
  Element.prototype.scrollIntoView = () => {};
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); highlights.clear(); Range.prototype.getClientRects = originalRects; window.localStorage.clear(); });

const thread = (id: string, status: "OPEN" | "RESOLVED", path: number, exact: string) => ({
  id, status, createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z",
  currentAnchor: { match: "MATCHED", anchor: { schemaVersion: 1, blockPath: [path], blockKind: "paragraph", startUtf16: 0, endUtf16: exact.length, exact, prefix: "", suffix: "" } },
  comments: [{ id: `${id}-c`, threadId: id, body: `${status} remark`, visibility: "VISIBLE", createdAt: "2026-11-01T00:00:00Z", editedAt: null, deleted: false, own: false }],
});

async function render() {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ threads: [thread("open", "OPEN", 0, "First paragraph."), thread("done", "RESOLVED", 1, "Second paragraph.")], revisionId: "r1", writesEnabled: true, callerUserId: "u1" }), { headers: { "content-type": "application/json" } })));
  await act(async () => root.render(<SharedReviewPanel token="tok" revisionId="r1" markdown={markdown} signInHref="/sign-in"><article data-review-document><p data-review-path="0">First paragraph.</p><p data-review-path="1">Second paragraph.</p></article></SharedReviewPanel>));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
}
const markers = () => [...container.querySelectorAll<HTMLElement>("[data-review-marker]")].map(marker => marker.dataset.reviewMarker);
const marked = (name: string) => (highlights.get(name)?.ranges ?? []).map(range => range.toString());
async function choose(filter: string) {
  await act(async () => container.querySelector<HTMLElement>('[aria-label="Filter comments"]')!.click());
  const row = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find(item => item.textContent === filter)!;
  await act(async () => row.click());
}

it("marks only open passages while the list is on Open", async () => {
  await render();
  expect(markers()).toEqual(["open"]);
  expect(marked("document-review")).toEqual(["First paragraph."]);
});

it("marks resolved passages once resolved ones are asked for", async () => {
  await render();
  await choose("Resolved");
  expect(markers()).toEqual(["open", "done"]);
  expect(marked("document-review")).toEqual(["First paragraph.", "Second paragraph."]);
});

it("keeps a resolved passage marked while its discussion is the one looked at", async () => {
  await render();
  await choose("Resolved");
  const card = container.querySelector<HTMLElement>('[data-review-thread="done"]')!;
  await act(async () => card.click());
  await choose("Open");
  expect(marked("document-review-active")).toEqual(["Second paragraph."]);
  expect(marked("document-review")).toEqual(["First paragraph.", "Second paragraph."]);
});

it("leaves the filter on Open when a marker leads to an open discussion", async () => {
  await render();
  await act(async () => container.querySelector<HTMLElement>('[data-review-marker="open"]')!.click());
  expect(container.querySelector('[aria-label="Filter comments"]')!.textContent).toBe("Open");
  expect(markers()).toEqual(["open"]);
});
