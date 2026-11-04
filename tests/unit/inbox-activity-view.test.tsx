// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { InboxDiscussionView, InboxPage } from "@/modules/knowledge/domain/inbox-discussion";
import type { ShareCommentNotificationView } from "@/modules/knowledge/domain/share-comment-event";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/w/ws/inbox",
}));
const { InboxActivityView } = await import("@/components/knowledge/inbox-activity-view");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const at = (value: number) => new Date(value);
const discussion = (threadId: string, over: Partial<InboxDiscussionView> = {}): InboxDiscussionView => ({
  threadId, kind: "OWNER", documentId: `doc-${threadId}`, sourceId: "src",
  documentTitle: `Doc ${threadId}`, quote: `Quote ${threadId}`,
  href: `/w/ws/knowledge/src/doc-${threadId}?thread=${threadId}`,
  latest: { authorName: "Ann", excerpt: `excerpt ${threadId}`, createdAt: at(10) },
  latestAt: at(10), commentCount: 1, unreadCount: 0, status: "OPEN",
  following: false, mentioned: false, ...over,
});
const shared = (over: Partial<ShareCommentNotificationView> = {}): ShareCommentNotificationView => ({
  id: "shared:l1", workspaceId: "", documentId: "", sourceId: "", documentTitle: "Quarterly plan",
  threadId: "", commentId: "", authorName: "Dana", excerpt: "", createdAt: at(0),
  readAt: null, threadStatus: "OPEN", kind: "SHARED_WITH_YOU", linkAvailable: true,
  href: "/w/ws/shares/tok", ...over,
});
const thread = (id: string, status = "OPEN") => ({
  id, status, createdAt: at(0), updatedAt: at(0), currentAnchor: { match: "OUTDATED" },
  comments: [{ id: `${id}-c1`, threadId: id, authorName: "Ann", body: `body of ${id}`, visibility: "VISIBLE", createdAt: at(0), editedAt: null, deleted: false, own: false }],
});

let host: HTMLDivElement, root: Root;
let page: InboxPage;
let older: InboxPage;
let following: InboxDiscussionView[];
let filtered: InboxPage | null;
let lookup: InboxDiscussionView | null;
let threads: Record<string, ReturnType<typeof thread>[]>;
let posts: { action: string; threadId?: string; eventId?: string }[];
let gets: string[];
let requests: string[];
let unreadCount: number;
let failMarks: number;
let width: number;
let holdCursor: boolean;
let releaseCursor: (() => void) | null;

beforeEach(() => {
  window.history.replaceState(null, "", "/w/ws/inbox");
  width = 1200;
  page = { discussions: [], shared: [], nextCursor: null };
  older = { discussions: [], shared: [], nextCursor: null };
  following = [];
  filtered = null;
  lookup = null;
  threads = {};
  posts = [];
  gets = [];
  requests = [];
  unreadCount = 1;
  failMarks = 0;
  holdCursor = false;
  releaseCursor = null;
  vi.stubGlobal("ResizeObserver", class {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe() { this.callback([{ contentRect: { width } } as ResizeObserverEntry], this as unknown as ResizeObserver); }
    unobserve() {} disconnect() {}
  });
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    requests.push(url);
    if (method === "GET") gets.push(url);
    if (url.startsWith("/api/review-notifications/unread-count")) return json({ count: unreadCount });
    if (url.startsWith("/api/review-notifications/inbox")) {
      if (method === "POST") {
        if (failMarks > 0) { failMarks--; return new Response(JSON.stringify({ message: "offline" }), { status: 500, headers: { "content-type": "application/json" } }); }
        posts.push(body);
        if (body.action === "mark-all-read") unreadCount = 0;
        return json({ ok: true });
      }
      const query = new URL(url, "http://localhost").searchParams;
      if (query.get("threadId")) return json({ discussions: lookup ? [lookup] : [], shared: [], nextCursor: null });
      if (query.get("beforeLatestAt")) {
        if (holdCursor) await new Promise<void>(resolve => { releaseCursor = resolve; });
        return json(older);
      }
      if (query.get("kind") === "follow") return json({ discussions: following, shared: [], nextCursor: null });
      if (query.get("kind") || query.get("status") || query.get("unread")) return json(filtered ?? { ...page, shared: [] });
      return json(page);
    }
    if (url === "/api/share-review/threads/query") return json({ threads: threads[`token:${body.token}`] ?? [], writesEnabled: true, callerUserId: "me", revisionId: "r" });
    if (/^\/api\/share-review\/threads\/[^/]+\/replies$/.test(url)) return json({ ok: true });
    if (/^\/api\/documents\/[^/]+\/review-threads\/[^/]+\/(replies|resolution|visibility)$/.test(url)) return json({ ok: true });
    if (url.startsWith("/api/review-mentions/candidates")) return json({ candidates: [] });
    const peek = url.match(/^\/api\/documents\/([^/]+)\/peek\?brief$/);
    if (peek) return json({ title: `Doc ${peek[1]}`, markdown: `Passage of ${peek[1]}.`, revisionId: "r", status: "ACTIVE", sourceStatus: "ACTIVE", linkView: null });
    const owner = url.match(/^\/api\/documents\/([^/]+)\/review-threads$/);
    if (owner) return json({ threads: threads[owner[1]] ?? [], writesEnabled: true, revisionId: "r", callerUserId: "me" });
    throw new Error(`unexpected ${url}`);
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

const mount = async () => { await act(async () => root.render(<InboxActivityView workspaceId="ws" />)); await act(async () => {}); };
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
const pane = () => host.querySelector<HTMLElement>('[aria-label="Selected discussion"]');
const row = (id: string) => host.querySelector<HTMLElement>(`[aria-label="Inbox discussions"] [data-inbox-entry="${id}"]`)!;
const rows = () => [...host.querySelectorAll<HTMLElement>('[aria-label="Inbox discussions"] [data-inbox-entry]')];
const inboxGets = () => gets.filter(url => url.startsWith("/api/review-notifications/inbox")).at(-1) ?? "";
const click = async (element: HTMLElement, init: MouseEventInit = {}) => {
  let event!: MouseEvent;
  await act(async () => { event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init }); element.dispatchEvent(event); });
  await settle();
  return event;
};
const tab = async (label: string) => {
  await act(async () => { [...host.querySelectorAll<HTMLElement>('[role="tab"]')].find(item => item.textContent === label)!.click(); });
  await settle();
};
const button = async (label: string) => {
  await act(async () => { [...host.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent === label)!.click(); });
  await settle();
};
const paneButton = (label: string) => [...pane()!.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent === label || item.getAttribute("aria-label") === label);
const typeIn = async (element: HTMLTextAreaElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle();
};
const change = async (value: string) => {
  const select = host.querySelector("select") as HTMLSelectElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await settle();
};
const item = () => new URL(window.location.href).searchParams.get("item");
const markReadButtons = () => [...host.querySelectorAll<HTMLButtonElement>("button")].filter(button => button.getAttribute("aria-label")?.startsWith("Mark read"));
const release = async () => {
  await act(async () => { releaseCursor?.(); releaseCursor = null; });
  await settle();
};

it("renders one row per discussion and no page count", async () => {
  page = { discussions: [discussion("t1"), discussion("t2")], shared: [], nextCursor: null };
  await mount();
  expect(host.querySelectorAll("[data-inbox-entry]")).toHaveLength(2);
  expect(host.textContent).not.toContain("Inbox ·");
});

it("selects nothing on arrival and explains the index in the empty pane", async () => {
  page = { discussions: [discussion("t1")], shared: [], nextCursor: null };
  await mount();
  expect(pane()).toBeNull();
  expect(host.textContent).toContain("Select a discussion");
  expect(host.textContent).toContain("Every discussion on your shared documents, in discussions you follow, and where someone mentioned you. Opening one marks it read; resolving it is a separate action.");
  expect(posts).toEqual([]);
});

it("selects a row, writes ?item= and marks the thread read once", async () => {
  page = { discussions: [discussion("t1", { unreadCount: 2 })], shared: [], nextCursor: null };
  threads["doc-t1"] = [thread("t1")];
  await mount();
  await click(row("t1"));
  expect(item()).toBe("t1");
  expect(posts.filter(post => post.action === "mark-thread-read")).toEqual([{ action: "mark-thread-read", threadId: "t1" }]);
  expect(pane()?.textContent).toContain("body of t1");
  expect(row("t1").getAttribute("aria-current")).toBe("true");
  // Choosing it again is not a second request: the row is already read.
  await click(row("t1"));
  expect(posts.filter(post => post.action === "mark-thread-read")).toHaveLength(1);
});

it("a failed mark leaves the row unread and can be asked again", async () => {
  page = { discussions: [discussion("t1", { unreadCount: 1 })], shared: [], nextCursor: null };
  failMarks = 1;
  await mount();
  await click(row("t1"));
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
  expect(markReadButtons()).toHaveLength(1);
  await click(row("t1"));
  expect(posts.filter(post => post.action === "mark-thread-read")).toHaveLength(1);
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(markReadButtons()).toHaveLength(0);
});

it("looks up a deep-linked discussion that is not on the loaded page", async () => {
  window.history.replaceState(null, "", "/w/ws/inbox?item=t2");
  page = { discussions: [discussion("t1")], shared: [], nextCursor: null };
  lookup = discussion("t2", { documentTitle: "Doc t2" });
  await mount();
  expect(gets.some(url => url.includes("threadId=t2"))).toBe(true);
  expect(pane()?.textContent).toContain("Doc t2");
});

it("an unknown deep link selects nothing, silently", async () => {
  window.history.replaceState(null, "", "/w/ws/inbox?item=missing");
  page = { discussions: [discussion("t1")], shared: [], nextCursor: null };
  await mount();
  expect(gets.some(url => url.includes("threadId=missing"))).toBe(true);
  expect(pane()).toBeNull();
  expect(item()).toBeNull();
});

it("a deep-linked unread discussion opens in the pane and is marked read once", async () => {
  window.history.replaceState(null, "", "/w/ws/inbox?item=t2");
  page = { discussions: [discussion("t1")], shared: [], nextCursor: null };
  lookup = discussion("t2", { documentTitle: "Doc t2", unreadCount: 1 });
  await mount();
  expect(gets.some(url => url.includes("threadId=t2"))).toBe(true);
  expect(pane()?.textContent).toContain("Doc t2");
  expect(posts.filter(post => post.action === "mark-thread-read")).toEqual([{ action: "mark-thread-read", threadId: "t2" }]);
});

it("in a narrow box a deep-linked discussion neither opens a pane nor marks read", async () => {
  width = 600;
  window.history.replaceState(null, "", "/w/ws/inbox?item=t2");
  page = { discussions: [discussion("t1")], shared: [], nextCursor: null };
  lookup = discussion("t2", { documentTitle: "Doc t2", unreadCount: 1 });
  await mount();
  expect(gets.some(url => url.includes("threadId=t2"))).toBe(true);
  expect(pane()).toBeNull();
  expect(posts.filter(post => post.action === "mark-thread-read")).toEqual([]);
});

it("keeps the selected row after its mark under the active Unread filter", async () => {
  window.history.replaceState(null, "", "/w/ws/inbox?unread=1");
  page = { discussions: [discussion("t1", { unreadCount: 1 })], shared: [], nextCursor: null };
  threads["doc-t1"] = [thread("t1")];
  await mount();
  expect(rows().map(element => element.dataset.inboxEntry)).toEqual(["t1"]);
  await click(row("t1"));
  expect(posts.filter(post => post.action === "mark-thread-read")).toEqual([{ action: "mark-thread-read", threadId: "t1" }]);
  // The mark no longer matches the Unread filter, but the selected row stays until another selection or filter change.
  expect(rows().map(element => element.dataset.inboxEntry)).toEqual(["t1"]);
  expect(row("t1").getAttribute("aria-current")).toBe("true");
  expect(item()).toBe("t1");
  expect(pane()).not.toBeNull();
  expect(markReadButtons()).toHaveLength(0);
});

it("a reply in the pane updates the row without Refresh", async () => {
  page = { discussions: [discussion("t1")], shared: [], nextCursor: null };
  threads["doc-t1"] = [thread("t1")];
  lookup = discussion("t1", { commentCount: 2, latest: { authorName: "Ann", excerpt: "Answered from the Inbox", createdAt: at(20) }, latestAt: at(20) });
  await mount();
  await click(row("t1"));
  await click(paneButton("Reply")!);
  await typeIn(pane()!.querySelector<HTMLTextAreaElement>('textarea[aria-label="Reply"]')!, "Answered from the Inbox");
  await click(paneButton("Reply")!);
  await settle();
  expect(requests).toContain("/api/documents/doc-t1/review-threads/t1/replies");
  expect(gets.some(url => url.includes("threadId=t1"))).toBe(true);
  expect(row("t1").textContent).toContain("2 comments");
  expect(row("t1").textContent).toContain("Answered from the Inbox");
});

it("resolving under the Open filter keeps the selected row, marked Resolved", async () => {
  window.history.replaceState(null, "", "/w/ws/inbox?status=open");
  page = { discussions: [discussion("t1")], shared: [], nextCursor: null };
  filtered = { discussions: [discussion("t1")], shared: [], nextCursor: null };
  threads["doc-t1"] = [thread("t1")];
  lookup = discussion("t1", { status: "RESOLVED" });
  await mount();
  await click(row("t1"));
  // A pane write must settle this one row, not re-read the list under the filter that now excludes it.
  filtered = { discussions: [], shared: [], nextCursor: null };
  await click(paneButton("Resolve")!);
  await settle();
  expect(requests).toContain("/api/documents/doc-t1/review-threads/t1/resolution");
  expect(gets.some(url => url.includes("threadId=t1"))).toBe(true);
  expect(row("t1").textContent).toContain("Resolved");
  expect(pane()).not.toBeNull();
  expect(item()).toBe("t1");
});

it("a write to a sibling thread in the pane settles that thread's row, not the selected one", async () => {
  page = {
    discussions: [discussion("t1"), discussion("t2", { documentId: "doc-t1", documentTitle: "Doc t1" })],
    shared: [],
    nextCursor: null,
  };
  threads["doc-t1"] = [thread("t1"), thread("t2")];
  lookup = discussion("t2", { documentId: "doc-t1", documentTitle: "Doc t1", status: "RESOLVED" });
  await mount();
  await click(row("t1"));
  const sibling = pane()!.querySelector<HTMLElement>('[data-review-thread="t2"]')!;
  expect(sibling).not.toBeNull();
  await act(async () => { sibling.querySelector<HTMLButtonElement>('button[aria-label="Resolve"]')!.click(); });
  await settle();
  expect(requests).toContain("/api/documents/doc-t1/review-threads/t2/resolution");
  // The row read back is the sibling's, though the selected discussion is t1.
  expect(inboxGets()).toContain("threadId=t2");
  expect(gets.some(url => url.includes("threadId=t1"))).toBe(false);
  expect(row("t2").textContent).toContain("Resolved");
  expect(item()).toBe("t1");
});

it("an owner row the server stops returning is removed with its pane", async () => {
  page = { discussions: [discussion("t1")], shared: [], nextCursor: null };
  threads["doc-t1"] = [thread("t1")];
  await mount();
  await click(row("t1"));
  expect(pane()).not.toBeNull();
  // Hiding the thread or deleting its last visible comment leaves the lookup with nothing.
  lookup = null;
  await click(paneButton("Resolve")!);
  await settle();
  expect(rows()).toHaveLength(0);
  expect(pane()).toBeNull();
  expect(item()).toBeNull();
  expect(host.textContent).toContain("No discussions yet.");
});

it("a link row whose lookup comes back empty is kept for the pane's placeholder", async () => {
  page = { discussions: [discussion("t1", { kind: "FOLLOW", following: true, documentId: "", href: "/s/tok?thread=t1", token: "tok" })], shared: [], nextCursor: null };
  threads["token:tok"] = [thread("t1")];
  await mount();
  await click(row("t1"));
  expect(pane()?.textContent).toContain("body of t1");
  // The thread may have lost its link rather than been hidden: the row stays, the pane answers.
  lookup = null;
  await click(paneButton("Reply")!);
  await typeIn(pane()!.querySelector<HTMLTextAreaElement>('textarea[aria-label="Reply"]')!, "After the link died");
  await click(paneButton("Reply")!);
  await settle();
  expect(requests.some(url => url.endsWith("/t1/replies"))).toBe(true);
  expect(inboxGets()).toContain("threadId=t1");
  expect(rows().map(element => element.dataset.inboxEntry)).toEqual(["t1"]);
  expect(pane()).not.toBeNull();
  expect(item()).toBe("t1");
});

it("marking an unselected row read under the Unread filter removes it", async () => {
  window.history.replaceState(null, "", "/w/ws/inbox?unread=1");
  page = { discussions: [discussion("t1", { unreadCount: 1 }), discussion("t2", { unreadCount: 1 })], shared: [], nextCursor: null };
  threads["doc-t1"] = [thread("t1")];
  await mount();
  expect(rows().map(element => element.dataset.inboxEntry)).toEqual(["t1", "t2"]);
  await click(row("t1"));
  expect(rows().map(element => element.dataset.inboxEntry)).toEqual(["t1", "t2"]);
  await click(host.querySelector('[aria-label="Mark read: Doc t2"]')!);
  expect(posts.filter(post => post.action === "mark-thread-read").map(post => post.threadId)).toEqual(["t1", "t2"]);
  // The now-read row no longer matches Unread; the selected row stays as the reader's place.
  expect(rows().map(element => element.dataset.inboxEntry)).toEqual(["t1"]);
  expect(row("t1").getAttribute("aria-current")).toBe("true");
  expect(item()).toBe("t1");
  expect(markReadButtons()).toHaveLength(0);
});

it("Mark all read under the Unread filter drops every unselected row and keeps the selected one", async () => {
  window.history.replaceState(null, "", "/w/ws/inbox?unread=1");
  page = { discussions: [discussion("t1", { unreadCount: 1 }), discussion("t2", { unreadCount: 2 })], shared: [], nextCursor: null };
  unreadCount = 3;
  threads["doc-t1"] = [thread("t1")];
  await mount();
  await click(row("t1"));
  await button("Mark all read");
  expect(posts).toContainEqual({ action: "mark-all-read" });
  expect(rows().map(element => element.dataset.inboxEntry)).toEqual(["t1"]);
  expect(row("t1").getAttribute("aria-current")).toBe("true");
  expect(item()).toBe("t1");
  expect(markReadButtons()).toHaveLength(0);
});

it("a filter change clears a selection it excludes", async () => {
  page = { discussions: [discussion("t1")], shared: [], nextCursor: null };
  await mount();
  await click(row("t1"));
  following = [discussion("t2", { kind: "FOLLOW", following: true, href: "/s/tok?thread=t2", token: "tok" })];
  await tab("Following");
  expect(pane()).toBeNull();
  expect(item()).toBeNull();
});

it("keeps a selection the new filter still lists", async () => {
  page = { discussions: [discussion("t1")], shared: [], nextCursor: null };
  await mount();
  await click(row("t1"));
  filtered = { discussions: [discussion("t1")], shared: [], nextCursor: null };
  await tab("Mentions");
  expect(rows().map(element => element.dataset.inboxEntry)).toEqual(["t1"]);
  expect(pane()).not.toBeNull();
  expect(item()).toBe("t1");
});

it("re-runs the deep-link lookup with the new filters and clears it when they exclude it", async () => {
  window.history.replaceState(null, "", "/w/ws/inbox?item=t2");
  page = { discussions: [discussion("t1")], shared: [], nextCursor: null };
  lookup = discussion("t2", { documentTitle: "Doc t2" });
  await mount();
  expect(pane()).not.toBeNull();
  const before = gets.filter(url => url.includes("threadId=t2")).length;
  lookup = null;
  await tab("Following");
  expect(gets.filter(url => url.includes("threadId=t2")).length).toBe(before + 1);
  expect(gets.at(-1)).toContain("kind=follow");
  expect(pane()).toBeNull();
  expect(item()).toBeNull();
});

it("writes the tabs, the status and the unread toggle to the URL and the request", async () => {
  page = { discussions: [discussion("t1")], shared: [], nextCursor: null };
  await mount();
  expect(inboxGets()).toBe("/api/review-notifications/inbox");

  await tab("Mentions");
  expect(new URL(window.location.href).searchParams.get("kind")).toBe("mention");
  expect(inboxGets()).toContain("kind=mention");

  await change("resolved");
  expect(new URL(window.location.href).searchParams.get("status")).toBe("resolved");
  expect(inboxGets()).toContain("status=resolved");

  await button("Unread");
  expect(new URL(window.location.href).searchParams.get("unread")).toBe("1");
  expect(inboxGets()).toContain("unread=1");

  await button("All");
  await button("Unread");
  await change("all");
  expect(new URL(window.location.href).searchParams.get("kind")).toBeNull();
  expect(new URL(window.location.href).searchParams.get("status")).toBeNull();
  expect(new URL(window.location.href).searchParams.get("unread")).toBeNull();
  expect(inboxGets()).toBe("/api/review-notifications/inbox");
});

it("reads the tab, status and unread from the URL once on mount", async () => {
  window.history.replaceState(null, "", "/w/ws/inbox?kind=mention&status=open&unread=1");
  page = { discussions: [discussion("t1")], shared: [shared()], nextCursor: null };
  await mount();
  expect(inboxGets()).toContain("kind=mention");
  expect(inboxGets()).toContain("status=open");
  expect(inboxGets()).toContain("unread=1");
  expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("Mentions");
  expect((host.querySelector("select") as HTMLSelectElement).value).toBe("open");
  expect([...host.querySelectorAll("button")].find(element => element.textContent === "Unread")?.getAttribute("aria-pressed")).toBe("true");
  // A filter is active, so the named-share section stays in Shares.
  expect(host.textContent).not.toContain("Shared with you");
});

it("shows the shared section only in the default view and marks a shared row read", async () => {
  page = { discussions: [discussion("t1")], shared: [shared()], nextCursor: null };
  await mount();
  expect(host.textContent).toContain("Shared with you");
  // A named share is not a discussion: it is not in the index.
  expect(host.querySelector('[aria-label="Inbox discussions"] [data-inbox-entry="shared:l1"]')).toBeNull();
  await button("Mark read");
  expect(posts).toContainEqual({ action: "mark-read", eventId: "shared:l1" });
  expect(host.textContent).not.toContain("Shared with you");

  page = { discussions: [discussion("t1")], shared: [shared()], nextCursor: null };
  await tab("Following");
  expect(host.textContent).not.toContain("Shared with you");
  await tab("All");
  expect(host.textContent).toContain("Shared with you");
});

it("a row's own Mark read settles it without selecting it", async () => {
  page = { discussions: [discussion("t1", { unreadCount: 1 })], shared: [], nextCursor: null };
  await mount();
  await click(host.querySelector('[aria-label="Mark read: Doc t1"]')!);
  expect(posts).toEqual([{ action: "mark-thread-read", threadId: "t1" }]);
  expect(item()).toBeNull();
  expect(pane()).toBeNull();
  expect(markReadButtons()).toHaveLength(0);
});

it("arrow keys move the selection down and up the list", async () => {
  page = { discussions: [discussion("t1", { latestAt: at(20) }), discussion("t2", { latestAt: at(10) })], shared: [], nextCursor: null };
  threads["doc-t1"] = [thread("t1")];
  threads["doc-t2"] = [thread("t2")];
  await mount();
  const list = host.querySelector<HTMLElement>('[aria-label="Inbox discussions"]')!;
  await act(async () => { list.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })); });
  await settle();
  expect(pane()?.textContent).toContain("body of t1");
  await act(async () => { list.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })); });
  await settle();
  expect(pane()?.textContent).toContain("body of t2");
  expect(document.activeElement).toBe(row("t2"));
  await act(async () => { list.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true })); });
  await settle();
  expect(pane()?.textContent).toContain("body of t1");
});

it("appends an older page, merges a duplicate thread and keeps newest first", async () => {
  page = { discussions: [discussion("t1", { latestAt: at(20) })], shared: [shared()], nextCursor: { latestAt: at(20).toISOString(), threadId: "t1" } };
  older = {
    discussions: [
      discussion("t1", { kind: "MENTION", mentioned: true, documentTitle: "Stale", href: "/s/tok?thread=t1", token: "tok", latestAt: at(5) }),
      discussion("t3", { latestAt: at(0) }),
    ],
    shared: [],
    nextCursor: null,
  };
  await mount();
  expect(rows()).toHaveLength(1);
  await button("Load older discussions");
  expect(inboxGets()).toContain("beforeLatestAt=");
  expect(inboxGets()).toContain("beforeThreadId=t1");
  expect(rows().map(element => element.dataset.inboxEntry)).toEqual(["t1", "t3"]);
  // The owner's view wins the identity, so the duplicate mention does not rename the row.
  expect(row("t1").textContent).toContain("Doc t1");
  expect(row("t1").textContent).not.toContain("Stale");
  // The shared section survives a page append, which returns no shares.
  expect(host.textContent).toContain("Shared with you");
  expect([...host.querySelectorAll("button")].find(element => element.textContent === "Load older discussions")).toBeUndefined();
});

it("a filter change resets the cursor and ignores an older page still in flight", async () => {
  page = { discussions: [discussion("t1", { latestAt: at(10) })], shared: [], nextCursor: { latestAt: at(10).toISOString(), threadId: "t1" } };
  older = { discussions: [discussion("stale", { latestAt: at(0) })], shared: [], nextCursor: { latestAt: at(0).toISOString(), threadId: "stale" } };
  following = [];
  await mount();
  holdCursor = true;
  await button("Load older discussions");
  expect(requests.filter(url => url.includes("beforeLatestAt="))).toHaveLength(1);

  // Switch tabs while the older page is still held by the server.
  await tab("Following");
  expect(inboxGets()).not.toContain("beforeLatestAt");
  expect(inboxGets()).not.toContain("beforeThreadId");
  expect(rows()).toHaveLength(0);
  expect(host.textContent).toContain("No discussions match these filters.");

  // The old page belongs to the old view: releasing it must not merge its rows or restore its cursor.
  await release();
  expect(rows()).toHaveLength(0);
  expect(host.textContent).not.toContain("stale");
  expect(host.textContent).toContain("No discussions match these filters.");
  expect([...host.querySelectorAll("button")].find(element => element.textContent === "Load older discussions")).toBeUndefined();
});

it("shows each empty state, and Clear filters returns to the default view", async () => {
  page = { discussions: [], shared: [], nextCursor: null };
  await mount();
  expect(host.textContent).toContain("No discussions yet.");
  expect(host.textContent).toContain("Comments on your shared documents, replies in discussions you follow, and mentions will appear here.");

  filtered = { discussions: [], shared: [], nextCursor: null };
  await tab("Following");
  expect(host.textContent).toContain("No discussions match these filters.");
  expect([...host.querySelectorAll("button")].find(element => element.textContent === "Clear filters")).not.toBeUndefined();
  await button("Clear filters");
  expect(new URL(window.location.href).searchParams.get("kind")).toBeNull();
  expect(inboxGets()).toBe("/api/review-notifications/inbox");

  await button("Unread");
  expect(host.textContent).toContain("No unread discussions.");
  expect(host.textContent).toContain("Clear the Unread filter to see everything.");
  // The Unread state keeps its own copy and offers no generic Clear filters action.
  expect([...host.querySelectorAll("button")].find(element => element.textContent === "Clear filters")).toBeUndefined();
});

it("marks all read: it clears the shared section and every row's dot", async () => {
  page = { discussions: [discussion("t1", { unreadCount: 1 }), discussion("t2", { unreadCount: 2 })], shared: [shared()], nextCursor: null };
  unreadCount = 3;
  await mount();
  expect(markReadButtons()).toHaveLength(3);
  await button("Mark all read");
  expect(posts).toContainEqual({ action: "mark-all-read" });
  expect(markReadButtons()).toHaveLength(0);
  expect(host.textContent).not.toContain("Shared with you");
  // The rail badge hook is the disabled state: nothing unread disables the action.
  expect([...host.querySelectorAll<HTMLButtonElement>("button")].find(element => element.textContent === "Mark all read")!.disabled).toBe(true);
});

it("a followed discussion opens through its link's token", async () => {
  page = { discussions: [discussion("t1", { kind: "FOLLOW", following: true, documentId: "", href: "/s/tok?thread=t1", token: "tok" })], shared: [], nextCursor: null };
  threads["token:tok"] = [thread("t1")];
  await mount();
  await click(row("t1"));
  expect(pane()?.textContent).toContain("body of t1");
  expect(pane()?.querySelector("a")?.getAttribute("href")).toBe("/s/tok?thread=t1");
  expect(requests.filter(url => url === "/api/share-review/threads/query")).toHaveLength(1);
  expect(requests.some(url => url.startsWith("/api/documents/"))).toBe(false);
});

it("in a narrow box the index is a plain list: rows navigate and no pane exists", async () => {
  width = 600;
  page = { discussions: [discussion("t1")], shared: [shared()], nextCursor: null };
  await mount();
  expect(host.textContent).not.toContain("Select a discussion");
  expect(host.textContent).toContain("Every discussion on your shared documents, in discussions you follow, and where someone mentioned you. Opening one marks it read; resolving it is a separate action.");
  expect(host.querySelector("main")?.classList.contains("kh-page")).toBe(true);
  expect(host.textContent).toContain("Shared with you");
  const link = host.querySelector<HTMLAnchorElement>('[aria-label="Inbox discussions"] a')!;
  expect(link.getAttribute("href")).toBe("/w/ws/knowledge/src/doc-t1?thread=t1");
  const event = await click(link);
  expect(event.defaultPrevented).toBe(false);
  expect(item()).toBeNull();
  expect(pane()).toBeNull();
  expect(host.querySelector('[aria-label="Inbox discussions"] button[data-inbox-entry]')).toBeNull();
});
