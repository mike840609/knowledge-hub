// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SharedReviewPanel } from "@/components/knowledge/shared-review-panel";
import { shareDiscussionLink } from "@/lib/share-paths";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** "Copy link to discussion" (inline review spec, 2026-11-26 amendment): a read, offered to every reader. */
const THREAD = "0192f3a4-5b6c-7d8e-9f01-0000000000aa";
const DOC = "0192f3a4-5b6c-7d8e-9f01-23456789abcd";
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  Element.prototype.scrollIntoView = () => {};
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); window.history.replaceState(null, "", "/"); window.localStorage.clear(); });

const thread = { id: THREAD, status: "OPEN", createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z", currentAnchor: { match: "OUTDATED" },
  comments: [{ id: "c1", threadId: THREAD, body: "A remark", visibility: "VISIBLE", createdAt: "2026-11-01T00:00:00Z", editedAt: null, deleted: false, own: false }] };

/** The page at `path`, an anonymous reader, the discussion opened by `?thread=` so its card is the open one. */
async function render(path: string, documentId?: string, named = false) {
  window.history.replaceState(null, "", `${path}?${documentId ? `d=${documentId}&` : ""}thread=${THREAD}`);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ threads: [thread], revisionId: "r1", writesEnabled: false, callerUserId: null }), { headers: { "content-type": "application/json" } })));
  await act(async () => root.render(<SharedReviewPanel token="tok" documentId={documentId} named={named} revisionId="r1" markdown="Text." signInHref="/sign-in"><article data-review-document><p>Text.</p></article></SharedReviewPanel>));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
}
async function copy() {
  const card = container.querySelector<HTMLElement>(`[data-review-thread="${THREAD}"]`)!;
  await act(async () => card.querySelector<HTMLElement>('[aria-label="Comment options"]')!.click());
  const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(row => row.textContent === "Copy link to discussion")!;
  await act(async () => { item.click(); await Promise.resolve(); });
  return card;
}
function clipboard(write: (text: string) => Promise<void>) {
  const writeText = vi.fn(write);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  return writeText;
}

it("copies the shared page's address with the discussion, and says so", async () => {
  const writeText = clipboard(async () => {});
  await render("/s/tok");
  const card = await copy();
  expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/s/tok?thread=${THREAD}`);
  expect(card.querySelector('[role="status"]')!.textContent).toBe("Link copied");
});

it("keeps a folder page's document in the link", async () => {
  const writeText = clipboard(async () => {});
  await render("/s/tok", DOC);
  await copy();
  expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/s/tok?d=${DOC}&thread=${THREAD}`);
});

it("copies a NAMED share's /open form, never the copier's own Workspace path", async () => {
  const writeText = clipboard(async () => {});
  await render("/w/my-space/shares/tok", undefined, true);
  await copy();
  expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/s/tok/open?thread=${THREAD}`);
});

it("copies a LINK share's own page, even where it is read in the Hub", async () => {
  const writeText = clipboard(async () => {});
  await render("/w/my-space/shares/tok");
  await copy();
  expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/s/tok?thread=${THREAD}`);
});

it("shows the link to copy by hand where the clipboard refuses", async () => {
  clipboard(async () => { throw new Error("denied"); });
  await render("/s/tok");
  const card = await copy();
  expect(card.querySelector('[role="status"]')!.textContent).toContain("Couldn’t copy the link.");
  const field = card.querySelector<HTMLInputElement>('input[aria-label="Link to discussion"]')!;
  expect(field.value).toBe(`${window.location.origin}/s/tok?thread=${THREAD}`);
  // Once the menu has closed (and handed focus back to its trigger), the field has it, selected.
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
  expect(document.activeElement).toBe(field);
});

it("writes the link as the share's own page or its /open form", () => {
  expect(shareDiscussionLink("tok", THREAD)).toBe(`/s/tok?thread=${THREAD}`);
  expect(shareDiscussionLink("tok", THREAD, { documentId: DOC, named: true })).toBe(`/s/tok/open?d=${DOC}&thread=${THREAD}`);
});
