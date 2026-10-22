// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SharedReviewPanel } from "@/components/knowledge/shared-review-panel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); window.localStorage.clear(); window.sessionStorage.clear(); });

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
/** A fetch whose answers the test hands out one at a time. */
function pendingFetch() {
  const waiting: ((response: Response) => void)[] = [];
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(resolve => waiting.push(resolve))));
  return async (response: Response) => { await act(async () => { waiting.shift()!(response); }); };
}
const render = async () => { await act(async () => root.render(<SharedReviewPanel token="share-token" revisionId="r1" markdown="Text." signInHref="/sign-in"><article data-review-document><p>Text.</p></article></SharedReviewPanel>)); };
const loading = () => container.textContent?.includes("Loading discussions…");

it("says the discussions are loading until they arrive, then shows them", async () => {
  const answer = pendingFetch();
  await render();
  expect(loading()).toBe(true);
  await answer(json({ threads: [], revisionId: "r1", writesEnabled: true, callerUserId: "u1" }));
  expect(loading()).toBe(false);
  expect(container.textContent).toContain("No comments yet.");
});

it("replaces the loading line with the failure, and shows it again while Retry reads", async () => {
  const answer = pendingFetch();
  await render();
  await answer(json({ error: { message: "x" } }, 503));
  expect(loading()).toBe(false);
  expect(container.textContent).toContain("Discussions are unavailable.");
  const retry = container.querySelector<HTMLButtonElement>('button[aria-label="Refresh comments"]')!;
  await act(async () => { retry.click(); });
  expect(loading()).toBe(true);
  await answer(json({ threads: [], revisionId: "r1", writesEnabled: true, callerUserId: "u1" }));
  expect(loading()).toBe(false);
});

it("keeps what is shown, with no loading line, while Refresh reads again", async () => {
  const answer = pendingFetch();
  await render();
  await answer(json({ threads: [], revisionId: "r1", writesEnabled: true, callerUserId: "u1" }));
  const refresh = Array.from(container.querySelectorAll<HTMLButtonElement>('button[aria-label="Refresh comments"]')).at(-1)!;
  await act(async () => { refresh.click(); });
  expect(loading()).toBe(false);
  expect(container.textContent).toContain("No comments yet.");
});

const resolvedThread = (id: string) => ({
  id, status: "RESOLVED", createdAt: "2026-10-22T09:00:00Z", updatedAt: "2026-10-22T09:00:00Z", currentAnchor: { match: "OUTDATED" },
  comments: [{ id: `${id}-c`, threadId: id, body: "Settled", visibility: "VISIBLE", createdAt: "2026-10-22T09:00:00Z", editedAt: null, deleted: false, own: false }],
});
const entryButton = () => container.querySelector<HTMLButtonElement>('button[aria-controls="shared-document-discussions"]')!;

it("says Updating while Refresh reads, and stops when it has read", async () => {
  const answer = pendingFetch();
  await render();
  await answer(json({ threads: [], revisionId: "r1", writesEnabled: true, callerUserId: "u1" }));
  const refresh = Array.from(container.querySelectorAll<HTMLButtonElement>('button[aria-label="Refresh comments"]')).at(-1)!;
  await act(async () => { refresh.click(); });
  expect(container.textContent).toContain("Updating…");
  expect(refresh.disabled).toBe(true);
  await answer(json({ threads: [], revisionId: "r1", writesEnabled: true, callerUserId: "u1" }));
  expect(container.textContent).not.toContain("Updating…");
});

it("keeps the discussions shown when a Refresh fails, and says it failed", async () => {
  const answer = pendingFetch();
  await render();
  await answer(json({ threads: [resolvedThread("t1")], revisionId: "r1", writesEnabled: true, callerUserId: "u1" }));
  const refresh = Array.from(container.querySelectorAll<HTMLButtonElement>('button[aria-label="Refresh comments"]')).at(-1)!;
  await act(async () => { refresh.click(); });
  await answer(json({ error: { message: "x" } }, 503));
  expect(container.textContent).toContain("Discussions are unavailable.");
  expect(container.textContent).toContain("Settled");
});

it("tells a reader who can comment how to start a discussion", async () => {
  const answer = pendingFetch();
  await render();
  await answer(json({ threads: [], revisionId: "r1", writesEnabled: true, callerUserId: "u1" }));
  expect(container.textContent).toContain("Select text in the document to start a discussion.");
});

it("does not tell an anonymous reader to start one", async () => {
  const answer = pendingFetch();
  await render();
  await answer(json({ threads: [], revisionId: "r1", writesEnabled: false, callerUserId: null }));
  expect(container.textContent).toContain("No comments yet.");
  expect(container.textContent).not.toContain("start a discussion");
});

it("says when every discussion is resolved, on the way in", async () => {
  const answer = pendingFetch();
  await render();
  await answer(json({ threads: [resolvedThread("t1"), resolvedThread("t2")], revisionId: "r1", writesEnabled: true, callerUserId: "u1" }));
  expect(entryButton().textContent).toBe("Comments · 2 resolved");
  expect(entryButton().getAttribute("aria-label")).toBe("Open discussions, 2 comments, all resolved");
});

it("names the comment button for what it does: comment on the selection", async () => {
  const answer = pendingFetch();
  await render();
  await answer(json({ threads: [], revisionId: "r1", writesEnabled: true, callerUserId: "u1" }));
  const button = Array.from(container.querySelectorAll("button")).find(candidate => candidate.textContent === "Comment on selected text");
  expect(button).toBeDefined();
  expect(button!.hasAttribute("aria-label")).toBe(false);
});
