// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ShareCommentNotificationView } from "@/modules/knowledge/domain/share-comment-event";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }) }));
const { InboxActivityView } = await import("@/components/knowledge/inbox-activity-view");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const entry = (id: string, over: Partial<ShareCommentNotificationView> = {}): ShareCommentNotificationView => ({
  id, workspaceId: "ws", documentId: `doc-${id}`, sourceId: "src", documentTitle: `Title ${id}`, threadId: `thread-${id}`, commentId: "c",
  authorName: "Ann", excerpt: `excerpt ${id}`, createdAt: new Date(0), readAt: null, threadStatus: "OPEN", kind: "OWNER", ...over,
});
const thread = (id: string, status = "OPEN") => ({
  id, status, createdAt: new Date(0), updatedAt: new Date(0), currentAnchor: { match: "OUTDATED" },
  comments: [{ id: `${id}-c1`, threadId: id, authorName: "Ann", body: `body of ${id}`, visibility: "VISIBLE", createdAt: new Date(0), editedAt: null, deleted: false, own: false }],
});

let host: HTMLDivElement, root: Root;
let notifications: ShareCommentNotificationView[];
let threads: Record<string, ReturnType<typeof thread>[]>;
let calls: { url: string; method: string; body: Record<string, unknown> | undefined }[];
let width: number;
let unreadNotices: Partial<ShareCommentNotificationView>[];
let failMarks: number;

beforeEach(() => {
  window.history.replaceState(null, "", "/w/ws/inbox");
  width = 1200;
  calls = [];
  threads = {};
  unreadNotices = [];
  failMarks = 0;
  vi.stubGlobal("ResizeObserver", class {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe() { this.callback([{ contentRect: { width } } as ResizeObserverEntry], this as unknown as ResizeObserver); }
    unobserve() {} disconnect() {}
  });
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method: init.method ?? "GET", body });
    const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
    if (url.startsWith("/api/review-notifications/unread")) return json({ notifications: unreadNotices });
    if (url === "/api/review-notifications/mark-read") {
      if (failMarks > 0) { failMarks--; return new Response(JSON.stringify({ message: "offline" }), { status: 500, headers: { "content-type": "application/json" } }); }
      unreadNotices = unreadNotices.filter(notice => notice.threadId !== body.threadId);
      return json({ ok: true });
    }
    if (url.startsWith("/api/review-notifications/activity")) return json(init.method === "POST" ? { ok: true } : { notifications, nextCursor: null });
    if (url === "/api/share-review/threads/query") return json({ threads: threads[`token:${body.token}`] ?? [], writesEnabled: true, callerUserId: "me", revisionId: "r" });
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
// What was marked read: an event by id, or (an owner's entry) its discussion.
const marks = () => calls.filter(call => call.method === "POST" && (call.body?.action === "mark-read" || call.url === "/api/review-notifications/mark-read"))
  .map(call => call.body!.eventId ?? `thread:${call.body!.threadId}`);
const row = (id: string) => host.querySelector<HTMLElement>(`[aria-label="Inbox discussions"] [data-inbox-entry="${id}"]`)!;
const pane = () => host.querySelector<HTMLElement>('[aria-label="Selected discussion"]');
const click = async (element: HTMLElement, init: MouseEventInit = {}) => {
  let event!: MouseEvent;
  await act(async () => { event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init }); element.dispatchEvent(event); });
  await settle();
  return event;
};

it("selects nothing on arrival, marks nothing read, and explains the Inbox in the empty pane", async () => {
  notifications = [entry("a")];
  await mount();
  expect(pane()).toBeNull();
  expect(host.textContent).toContain("Select a discussion");
  expect(host.textContent).toContain("resolving it is a separate action");
  expect(marks()).toEqual([]);
});

it("a plain click shows the owner's document and its discussion beside the list, puts it in the URL and marks it read once", async () => {
  notifications = [entry("a")];
  threads["doc-a"] = [thread("thread-other"), thread("thread-a")];
  await mount();
  const event = await click(row("a"));
  expect(event.defaultPrevented).toBe(true);
  expect(new URL(window.location.href).searchParams.get("item")).toBe("a");
  expect(row("a").getAttribute("aria-current")).toBe("true");
  expect(pane()?.textContent).toContain("Passage of doc-a.");
  expect(pane()?.querySelector("h1")?.textContent).toBe("Doc doc-a");
  expect(pane()?.textContent).toContain("body of thread-a");
  expect(pane()?.querySelector('[data-review-thread="thread-a"]')?.hasAttribute("data-active")).toBe(true);
  expect(pane()?.querySelector("a")?.getAttribute("href")).toBe("/w/ws/knowledge/src/doc-a?thread=thread-a");
  expect(calls.some(call => call.url === "/api/documents/doc-a/peek?brief")).toBe(true);
  // Where the discussions cannot sit beside the article (jsdom has no layout), no drawer covers the list.
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(calls.some(call => call.url === "/api/documents/doc-a/review-threads" && call.method === "GET")).toBe(true);
  await click(row("a"));
  expect(marks()).toEqual(["thread:thread-a"]);
});

it("a read entry is not marked again", async () => {
  notifications = [entry("a", { readAt: new Date(0) })];
  threads["doc-a"] = [thread("thread-a")];
  await mount();
  await click(row("a"));
  expect(pane()?.textContent).toContain("body of thread-a");
  expect(marks()).toEqual([]);
});

it("a followed discussion is read through its link's token, never the owner's document", async () => {
  notifications = [entry("f", { kind: "FOLLOW", token: "tok", linkAvailable: true })];
  threads["token:tok"] = [thread("thread-f")];
  await mount();
  await click(row("f"));
  expect(pane()?.textContent).toContain("body of thread-f");
  expect(calls.filter(call => call.url === "/api/share-review/threads/query").map(call => call.body)).toEqual([{ token: "tok" }]);
  expect(calls.some(call => call.url.startsWith("/api/documents/"))).toBe(false);
});

it("a dead link's entry shows its placeholder and asks the server for nothing", async () => {
  notifications = [entry("d", { kind: "FOLLOW", linkAvailable: false })];
  await mount();
  const before = calls.length;
  await click(row("d"));
  expect(pane()?.textContent).toContain("This link is no longer available.");
  expect(pane()?.textContent).toContain("A shared discussion");
  expect(pane()?.querySelector("a")).toBeNull();
  expect(calls.slice(before).filter(call => call.body?.action !== "mark-read")).toEqual([]);
  expect(marks()).toEqual(["d"]);
});

it("a followed discussion the response no longer lists says so", async () => {
  notifications = [entry("a", { kind: "FOLLOW", token: "tok", linkAvailable: true })];
  threads["token:tok"] = [thread("thread-other")];
  await mount();
  await click(row("a"));
  expect(pane()?.textContent).toContain("This discussion is no longer available here.");
});

it("a deep link selects its entry; an unknown one selects nothing", async () => {
  notifications = [entry("a"), entry("b")];
  threads["doc-b"] = [thread("thread-b")];
  window.history.replaceState(null, "", "/w/ws/inbox?item=b");
  await mount();
  await settle();
  expect(pane()?.textContent).toContain("body of thread-b");
  expect(marks()).toEqual(["thread:thread-b"]);
  await act(async () => root.unmount());
  root = createRoot(host);
  calls = [];
  window.history.replaceState(null, "", "/w/ws/inbox?item=missing");
  await mount();
  expect(pane()).toBeNull();
  expect(marks()).toEqual([]);
});

it("arrow keys move the selection down and up the list", async () => {
  notifications = [entry("a"), entry("b")];
  threads["doc-a"] = [thread("thread-a")];
  threads["doc-b"] = [thread("thread-b")];
  await mount();
  const list = host.querySelector<HTMLElement>('[aria-label="Inbox discussions"]')!;
  await act(async () => { list.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })); });
  await settle();
  expect(pane()?.textContent).toContain("body of thread-a");
  await act(async () => { list.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })); });
  await settle();
  expect(pane()?.textContent).toContain("body of thread-b");
  expect(document.activeElement).toBe(row("b"));
  await act(async () => { list.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true })); });
  await settle();
  expect(pane()?.textContent).toContain("body of thread-a");
});

it("a modified click is left to the browser, which opens the document", async () => {
  notifications = [entry("a")];
  await mount();
  const event = await click(row("a"), { metaKey: true });
  expect(event.defaultPrevented).toBe(false);
  expect(pane()).toBeNull();
  expect(marks()).toEqual([]);
});

it("in a narrow box the Inbox is today's list: rows navigate and the explanation stays above it", async () => {
  width = 600;
  notifications = [entry("a"), entry("d", { kind: "FOLLOW", linkAvailable: false })];
  await mount();
  expect(host.textContent).not.toContain("Select a discussion");
  expect(host.textContent).toContain("resolving it is a separate action");
  const link = host.querySelector<HTMLAnchorElement>('[aria-label="Inbox discussions"] a')!;
  expect(link.getAttribute("href")).toBe("/w/ws/knowledge/src/doc-a?thread=thread-a");
  await click(link);
  expect(new URL(window.location.href).searchParams.get("item")).toBeNull();
  expect(pane()).toBeNull();
  expect(host.querySelector("main")?.classList.contains("kh-page")).toBe(true);
  expect(host.querySelector('[aria-label="Inbox discussions"] button[data-inbox-entry]')).toBeNull();
  expect(marks()).toEqual([]);
});

it("a resolved discussion opens shown, though the document has open ones", async () => {
  notifications = [entry("a", { threadStatus: "RESOLVED" })];
  threads["doc-a"] = [thread("thread-open"), thread("thread-a", "RESOLVED")];
  await mount();
  await click(row("a"));
  expect(pane()?.querySelector('[data-review-thread="thread-a"]')).not.toBeNull();
});

it("an owner's entry is read as its discussion: one request, and every notice of it in the list settles", async () => {
  notifications = [entry("a"), entry("a2", { threadId: "thread-a" }), entry("b")];
  threads["doc-a"] = [thread("thread-a")];
  await mount();
  await click(row("a"));
  await settle();
  expect(marks()).toEqual(["thread:thread-a"]);
  const rows = [...host.querySelectorAll('[aria-label="Inbox discussions"] li')];
  expect(rows.filter(li => li.textContent?.includes("Mark read"))).toHaveLength(1);
});

it("the entry being read keeps its place once settled, so ↓ goes on to the next", async () => {
  notifications = [entry("a", { threadStatus: "RESOLVED" }), entry("b")];
  threads["doc-a"] = [thread("thread-a", "RESOLVED")];
  threads["doc-b"] = [thread("thread-b")];
  await mount();
  await click(row("a"));
  await settle();
  expect(row("a")).not.toBeNull();
  const list = host.querySelector<HTMLElement>('[aria-label="Inbox discussions"]')!;
  await act(async () => { list.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })); });
  await settle();
  expect(pane()?.textContent).toContain("body of thread-b");
});

it("another discussion looked at in the pane is marked read, as on the reader", async () => {
  // The rail sits beside the article here, as it does in a wide pane.
  const style = document.createElement("style");
  style.textContent = ".kh-review-document { --review-rail: inline; }";
  document.head.append(style);
  try {
    notifications = [entry("a")];
    threads["doc-a"] = [thread("thread-a"), thread("thread-b")];
    unreadNotices = [{ threadId: "thread-b", documentId: "doc-a" }];
    await mount();
    await click(row("a"));
    await settle();
    expect(marks()).toEqual(["thread:thread-a"]);
    const card = pane()!.querySelector<HTMLElement>('[data-review-thread="thread-b"]')!;
    await click(card);
    expect(marks()).toContain("thread:thread-b");
  } finally { style.remove(); }
});

it("in the narrow list a settled entry named by ?item= is not listed", async () => {
  width = 600;
  window.history.replaceState(null, "", "/w/ws/inbox?item=a");
  notifications = [entry("a", { readAt: new Date(0), threadStatus: "RESOLVED" }), entry("b")];
  await mount();
  expect(host.querySelector('[aria-label="Inbox discussions"]')?.textContent).not.toContain("Title a");
});

it("a mark that failed is asked again by choosing the entry again", async () => {
  notifications = [entry("a")];
  threads["doc-a"] = [thread("thread-a")];
  failMarks = 1;
  await mount();
  await click(row("a"));
  await settle();
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
  await click(row("a"));
  await settle();
  expect(marks()).toEqual(["thread:thread-a", "thread:thread-a"]);
  expect(row("a").textContent).toContain("Read");
  expect(host.querySelector('[role="alert"]')).toBeNull();
});

const mention = (id: string, over: Partial<ShareCommentNotificationView> = {}) =>
  entry(`mention:${id}`, { kind: "MENTION", workspaceId: "", documentId: "", sourceId: "", token: "tok", linkAvailable: true, ...over });

it("a mention is labelled, links through its token without prefetch, and shows no reply count", async () => {
  notifications = [mention("c1", { threadId: "thread-m", authorName: "Ann", excerpt: "see this" })];
  await mount();
  const link = row("mention:c1");
  expect(link.getAttribute("href")).toBe("/s/tok?thread=thread-m");
  expect(link.textContent).toContain("Mentioned you");
  expect(link.textContent).toContain("Ann: see this");
  expect(link.textContent).not.toContain("new replies");
});

it("a mention opens through the link's token and settles by its own id", async () => {
  notifications = [mention("c1", { threadId: "thread-m" }), entry("o", { threadId: "thread-m" })];
  threads["token:tok"] = [thread("thread-m")];
  await mount();
  await click(row("mention:c1"));
  expect(pane()?.textContent).toContain("body of thread-m");
  expect(calls.filter(call => call.url === "/api/share-review/threads/query").map(call => call.body)).toEqual([{ token: "tok" }]);
  expect(calls.some(call => call.url.startsWith("/api/documents/"))).toBe(false);
  expect(marks()).toEqual(["mention:c1"]);
});

it("a dead mention shows the dead-entry copy and no link", async () => {
  notifications = [mention("c2", { linkAvailable: false, token: undefined, documentTitle: "", authorName: undefined, excerpt: "", threadId: "" })];
  await mount();
  await click(row("mention:c2"));
  expect(pane()?.textContent).toContain("This link is no longer available.");
  expect(pane()?.textContent).toContain("A shared discussion");
  expect(pane()?.querySelector("a")).toBeNull();
});

it("the owner panel's unread hook ignores mentions", async () => {
  const { useShareCommentUnread } = await import("@/components/knowledge/share-comment-notifications");
  unreadNotices = [{ kind: "MENTION", documentId: "doc-x", threadId: "t1" }, { kind: "OWNER", documentId: "doc-x", threadId: "t2" }];
  let seen: string[] = [];
  const Probe = () => { seen = [...useShareCommentUnread("doc-x").unreadThreadIds]; return null; };
  await act(async () => root.render(<Probe />));
  await act(async () => {});
  expect(seen).toEqual(["t2"]);
});
