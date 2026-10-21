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
