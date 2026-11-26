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
const loading = () => container.textContent?.includes("Loading comments…");

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
  expect(container.textContent).toContain("Comments are unavailable.");
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
const openThread = (id: string) => ({ ...resolvedThread(id), status: "OPEN", comments: [{ ...resolvedThread(id).comments[0], body: "Still open" }] });
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
  await answer(json({ threads: [openThread("t1")], revisionId: "r1", writesEnabled: true, callerUserId: "u1" }));
  const refresh = Array.from(container.querySelectorAll<HTMLButtonElement>('button[aria-label="Refresh comments"]')).at(-1)!;
  await act(async () => { refresh.click(); });
  await answer(json({ error: { message: "x" } }, 503));
  expect(container.textContent).toContain("Comments are unavailable.");
  expect(container.textContent).toContain("Still open");
});

it("tells a reader who can comment how to start a comment", async () => {
  const answer = pendingFetch();
  await render();
  await answer(json({ threads: [], revisionId: "r1", writesEnabled: true, callerUserId: "u1" }));
  expect(container.textContent).toContain("Select text in the document to start a comment.");
});

it("does not tell an anonymous reader to start one", async () => {
  const answer = pendingFetch();
  await render();
  await answer(json({ threads: [], revisionId: "r1", writesEnabled: false, callerUserId: null }));
  expect(container.textContent).toContain("No comments yet.");
  expect(container.textContent).not.toContain("start a comment");
});

it("says when every discussion is resolved, on the way in", async () => {
  const answer = pendingFetch();
  await render();
  await answer(json({ threads: [resolvedThread("t1"), resolvedThread("t2")], revisionId: "r1", writesEnabled: true, callerUserId: "u1" }));
  expect(entryButton().textContent).toBe("Comments · 2 resolved");
  expect(entryButton().getAttribute("aria-label")).toBe("Show comments, 2 comments, all resolved");
});

it("names the drawer's comment button for what it does: close and select", async () => {
  const answer = pendingFetch();
  await render();
  await answer(json({ threads: [], revisionId: "r1", writesEnabled: true, callerUserId: "u1" }));
  const button = Array.from(container.querySelectorAll("button")).find(candidate => candidate.textContent === "Close comments and select text");
  expect(button).toBeDefined();
  expect(button!.hasAttribute("aria-label")).toBe(false);
});

it("offers Retry inside the open panel when the discussions could not be read", async () => {
  const answer = pendingFetch();
  await render();
  await answer(json({ error: { message: "x" } }, 503));
  const panel = container.querySelector("#shared-document-discussions")!;
  const retry = Array.from(panel.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent === "Retry");
  expect(retry).toBeDefined();
  await act(async () => { retry!.click(); });
  expect(loading()).toBe(true);
  expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
});

it("offers to refresh the page where it says the document changed", async () => {
  const answer = pendingFetch();
  await render();
  await answer(json({ threads: [], revisionId: "r2", writesEnabled: true, callerUserId: "u1" }));
  const refresh = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).filter(button => button.textContent === "Refresh page");
  // Beside the notice above the article and beside the one in the panel.
  expect(refresh).toHaveLength(2);
});

const filterButton = () => container.querySelector<HTMLElement>('[aria-label="Filter comments"]')!;

it("starts on Open, and counts what is open in the Comments entry", async () => {
  const answer = pendingFetch();
  await render();
  await answer(json({ threads: [openThread("t1"), resolvedThread("t2"), resolvedThread("t3")], revisionId: "r1", writesEnabled: true, callerUserId: "u1" }));
  expect(filterButton().textContent).toBe("Open");
  expect(container.textContent).toContain("Still open");
  expect(container.textContent).not.toContain("Settled");
  expect(entryButton().textContent).toBe("Comments (1)1");
  expect(entryButton().getAttribute("aria-label")).toBe("Show comments, 3 comments, 1 open");
});

it("says every comment is resolved, and Show resolved lists them", async () => {
  const answer = pendingFetch();
  await render();
  await answer(json({ threads: [resolvedThread("t1")], revisionId: "r1", writesEnabled: true, callerUserId: "u1" }));
  expect(filterButton().textContent).toBe("Open");
  expect(container.textContent).toContain("Every comment is resolved.");
  expect(container.textContent).not.toContain("Settled");
  const show = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent === "Show resolved")!;
  await act(async () => { show.click(); });
  expect(filterButton().textContent).toBe("Resolved");
  expect(container.textContent).toContain("Settled");
});

it("shows a resolved discussion a ?thread= link names, whatever the filter starts on", async () => {
  window.history.replaceState(null, "", "/s/share-token?thread=t2");
  try {
    const answer = pendingFetch();
    await render();
    await answer(json({ threads: [openThread("t1"), resolvedThread("t2")], revisionId: "r1", writesEnabled: true, callerUserId: "u1" }));
    expect(container.textContent).toContain("Settled");
    expect(filterButton().textContent).toBe("All comments");
  } finally { window.history.replaceState(null, "", "/"); }
});

it("leaves the list on Open where a ?thread= link names an open discussion", async () => {
  window.history.replaceState(null, "", "/s/share-token?thread=t1");
  try {
    const answer = pendingFetch();
    await render();
    await answer(json({ threads: [openThread("t1"), resolvedThread("t2")], revisionId: "r1", writesEnabled: true, callerUserId: "u1" }));
    expect(filterButton().textContent).toBe("Open");
    expect(container.textContent).toContain("Still open");
    expect(container.textContent).not.toContain("Settled");
  } finally { window.history.replaceState(null, "", "/"); }
});

const withComment = (id: string, body: string, extra: object) => ({ ...openThread(id), comments: [{ ...openThread(id).comments[0], body, ...extra }] });
async function chooseRow(name: string) {
  await act(async () => filterButton().click());
  const row = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find(item => item.textContent === name)!;
  await act(async () => row.click());
}

it("narrows a signed-in reader's list to Mine or Mentions me", async () => {
  const answer = pendingFetch();
  await render();
  await answer(json({ threads: [withComment("t1", "Written by me", { own: true }), withComment("t2", "Names me", { own: false, mentionsMe: true }), withComment("t3", "Someone else's", { own: false })], revisionId: "r1", writesEnabled: true, callerUserId: "u1" }));
  await chooseRow("Mine");
  expect(filterButton().textContent).toBe("Open · Mine");
  expect(container.textContent).toContain("Written by me");
  expect(container.textContent).not.toContain("Names me");
  expect(container.textContent).not.toContain("Someone else's");
  await chooseRow("Mentions me");
  expect(container.textContent).toContain("Names me");
  expect(container.textContent).not.toContain("Written by me");
});

it("offers an anonymous reader no Mine or Mentions me", async () => {
  const answer = pendingFetch();
  await render();
  await answer(json({ threads: [openThread("t1")], revisionId: "r1", writesEnabled: false, callerUserId: null }));
  await act(async () => filterButton().click());
  expect([...document.querySelectorAll('[role="menuitemradio"]')].map(row => row.textContent)).toEqual(["All comments", "Open", "Resolved"]);
});
