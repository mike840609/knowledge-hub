// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ShareCommentNotificationView } from "@/modules/knowledge/domain/share-comment-event";

let search = new URLSearchParams();
vi.mock("next/navigation", () => ({ useSearchParams: () => search, useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }) }));
const { InboxActivityView } = await import("@/components/knowledge/inbox-activity-view");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const entry = (id: string, over: Partial<ShareCommentNotificationView> = {}): ShareCommentNotificationView => ({
  id, workspaceId: "ws", documentId: `doc-${id}`, sourceId: "src", documentTitle: `Title ${id}`, threadId: `thread-${id}`, commentId: "c",
  authorName: "Ann", excerpt: `excerpt ${id}`, createdAt: new Date(0), readAt: null, threadStatus: "OPEN", kind: "OWNER", ...over,
});
const thread = (id: string) => ({
  id, status: "OPEN", createdAt: new Date(0), updatedAt: new Date(0), currentAnchor: { match: "OUTDATED" },
  comments: [{ id: `${id}-c1`, threadId: id, authorName: "Ann", body: `body of ${id}`, visibility: "VISIBLE", createdAt: new Date(0), editedAt: null, deleted: false, own: false }],
});

let host: HTMLDivElement, root: Root;
let notifications: ShareCommentNotificationView[];
let threads: Record<string, ReturnType<typeof thread>[]>;
let calls: { url: string; method: string; body: Record<string, unknown> | undefined }[];
let width: number;

beforeEach(() => {
  search = new URLSearchParams();
  window.history.replaceState(null, "", "/w/ws/inbox");
  width = 1200;
  calls = [];
  threads = {};
  vi.stubGlobal("ResizeObserver", class {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe() { this.callback([{ contentRect: { width } } as ResizeObserverEntry], this as unknown as ResizeObserver); }
    unobserve() {} disconnect() {}
  });
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method: init.method ?? "GET", body });
    const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
    if (url.startsWith("/api/review-notifications/activity")) return json(init.method === "POST" ? { ok: true } : { notifications, nextCursor: null });
    if (url === "/api/share-review/threads/query") return json({ threads: threads[`token:${body.token}`] ?? [], writesEnabled: true, callerUserId: "me", revisionId: "r" });
    const peek = url.match(/^\/api\/documents\/([^/]+)\/peek$/);
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
const marks = () => calls.filter(call => call.method === "POST" && call.body?.action === "mark-read").map(call => call.body!.eventId);
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
  expect(calls.some(call => call.url === "/api/documents/doc-a/peek")).toBe(true);
  // Where the discussions cannot sit beside the article (jsdom has no layout), no drawer covers the list.
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(calls.some(call => call.url === "/api/documents/doc-a/review-threads" && call.method === "GET")).toBe(true);
  await click(row("a"));
  expect(marks()).toEqual(["a"]);
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
  search = new URLSearchParams("item=b");
  await mount();
  await settle();
  expect(pane()?.textContent).toContain("body of thread-b");
  expect(marks()).toEqual(["b"]);
  await act(async () => root.unmount());
  root = createRoot(host);
  calls = [];
  search = new URLSearchParams("item=missing");
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
  expect(host.querySelector('[aria-label="Inbox discussions"] button[data-inbox-entry]')).toBeNull();
  expect(marks()).toEqual([]);
});
