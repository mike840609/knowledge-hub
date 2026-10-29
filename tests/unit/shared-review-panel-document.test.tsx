// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SharedReviewPanel } from "@/components/knowledge/shared-review-panel";

/**
 * On a folder link's page the panel discusses the document being read (folder share spec §6): every
 * request names it, and what the reader keeps on the device is kept per document. A document link's
 * page names none and keeps the keys it always had, so drafts and dismissals stored before still match.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const DOCUMENT = "0192f3a4-0000-7000-8000-000000000002";
let root: Root;
let container: HTMLDivElement;
let calls: { url: string; body: Record<string, unknown> }[];
const thread = { id: "t1", status: "OPEN", createdAt: "2026-10-29T09:00:00Z", updatedAt: "2026-10-29T09:00:00Z", currentAnchor: { match: "OUTDATED" }, following: true,
  comments: [{ id: "c1", threadId: "t1", authorName: "Owner", body: "Hello", visibility: "VISIBLE", createdAt: "2026-10-29T09:00:00Z", editedAt: null, deleted: false, own: false }] };

beforeEach(() => {
  calls = [];
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body ?? "{}")) });
    const body = url.endsWith("/query") ? { threads: [thread], revisionId: "r1", writesEnabled: true, callerUserId: "u1" } : { ok: true };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }));
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/");
});

const render = async (documentId?: string) => {
  await act(async () => root.render(
    <SharedReviewPanel token="tok" documentId={documentId} revisionId="r1" markdown="Text." signInHref="/sign-in">
      <article data-review-document><p>Text.</p></article>
    </SharedReviewPanel>,
  ));
};
const toggle = () => container.querySelector<HTMLButtonElement>('button[aria-controls="shared-document-discussions"]')!;

describe.each([
  ["a folder link's page", DOCUMENT, { token: "tok", documentId: DOCUMENT }, `tok:${DOCUMENT}`],
  ["a document link's page", undefined, { token: "tok" }, "tok"],
])("on %s", (_page, documentId, scope, kept) => {
  it("reads the discussions, and marks a followed one seen, naming what the page reads", async () => {
    window.history.replaceState(null, "", "/s/tok?thread=t1");
    await render(documentId);
    await act(async () => { await Promise.resolve(); });
    expect(calls.find(call => call.url === "/api/share-review/threads/query")?.body).toEqual(scope);
    expect(calls.find(call => call.url === "/api/share-review/threads/t1/seen")?.body).toEqual(scope);
  });

  it("follows and unfollows naming what the page reads", async () => {
    // The Inbox's deep link opens the discussion, where its Unfollow is.
    window.history.replaceState(null, "", "/s/tok?thread=t1");
    await render(documentId);
    const unfollow = [...container.querySelectorAll("button")].find(button => button.textContent === "Unfollow")!;
    await act(async () => { unfollow.click(); });
    expect(calls.find(call => call.url === "/api/share-review/threads/t1/follow")?.body).toEqual({ ...scope, following: false });
  });

  it(`keeps a closed rail's dismissals under ${kept === "tok" ? "the link's key, as always" : "the link and document"}`, async () => {
    await render(documentId);
    await act(async () => { toggle().click(); });
    await act(async () => { toggle().click(); });
    expect(window.localStorage.getItem(`kh:share-review-dismissed:${kept}`)).toBe(JSON.stringify(["t1"]));
    expect(Object.keys(window.localStorage)).toEqual([`kh:share-review-dismissed:${kept}`]);
  });

  it("finds an unsent new comment under the same key", async () => {
    // Without its passage a draft is let go; which key goes shows which key the page reads.
    window.sessionStorage.setItem(`kh:review-draft:new:${kept}`, "unsent");
    window.sessionStorage.setItem("kh:review-draft:new:other", "kept");
    await render(documentId);
    expect(window.sessionStorage.getItem(`kh:review-draft:new:${kept}`)).toBeNull();
    expect(window.sessionStorage.getItem("kh:review-draft:new:other")).toBe("kept");
  });
});

it("a folder page's reader leaves the document link page's stored keys alone", async () => {
  window.sessionStorage.setItem("kh:review-draft:new:tok", "unsent on the document link");
  window.localStorage.setItem("kh:share-review-dismissed:tok", JSON.stringify(["t1"]));
  await render(DOCUMENT);
  await act(async () => { toggle().click(); });
  expect(window.sessionStorage.getItem("kh:review-draft:new:tok")).toBe("unsent on the document link");
  expect(window.localStorage.getItem("kh:share-review-dismissed:tok")).toBe(JSON.stringify(["t1"]));
});
