// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ShareCommentNotificationView } from "@/modules/knowledge/domain/share-comment-event";
import { notificationHref, notificationLine, notificationTitle } from "@/components/knowledge/notification-href";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }) }));
const { InboxActivityView } = await import("@/components/knowledge/inbox-activity-view");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const sharedEntry = (over: Partial<ShareCommentNotificationView> = {}): ShareCommentNotificationView => ({
  id: "shared:link-1", workspaceId: "", documentId: "", sourceId: "", documentTitle: "Quarterly plan", threadId: "", commentId: "",
  authorName: "Dana", excerpt: "", createdAt: new Date(0), readAt: null, threadStatus: "OPEN", kind: "SHARED_WITH_YOU",
  linkAvailable: true, href: "/w/me/shares/tok", ...over,
});
const dead = () => sharedEntry({ documentTitle: "", authorName: undefined, linkAvailable: false, href: undefined, readAt: new Date(0) });

let host: HTMLDivElement, root: Root;
let notifications: ShareCommentNotificationView[];
let marked: unknown[];

beforeEach(() => {
  window.history.replaceState(null, "", "/w/me/inbox");
  marked = [];
  vi.stubGlobal("ResizeObserver", class {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe() { this.callback([{ contentRect: { width: 1200 } } as ResizeObserverEntry], this as unknown as ResizeObserver); }
    unobserve() {} disconnect() {}
  });
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
    if (url.startsWith("/api/review-notifications/activity")) {
      if (init.method === "POST") { marked.push(JSON.parse(String(init.body))); return json({ ok: true }); }
      return json({ notifications, nextCursor: null });
    }
    throw new Error(`unexpected ${url}`);
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

const mount = async () => { await act(async () => root.render(<InboxActivityView workspaceId="me" />)); await act(async () => {}); };

it("says who shared what and opens the share page", async () => {
  notifications = [sharedEntry()];
  await mount();
  const row = host.querySelector<HTMLAnchorElement>('[data-inbox-entry="shared:link-1"]')!;
  expect(row.textContent).toContain("Dana shared 《Quarterly plan》 with you");
  expect(row.getAttribute("href")).toBe("/w/me/shares/tok");
  expect(row.textContent).toContain("Unread");
});

it("is settled by Mark read, as its own event and not as a discussion", async () => {
  notifications = [sharedEntry()];
  await mount();
  const button = [...host.querySelectorAll("button")].find(b => b.textContent === "Mark read")!;
  await act(async () => button.click());
  expect(marked).toEqual([{ action: "mark-read", eventId: "shared:link-1" }]);
});

it("clicking it in a wide window follows the link rather than opening a discussion pane", async () => {
  notifications = [sharedEntry()];
  await mount();
  const row = host.querySelector<HTMLElement>('[data-inbox-entry="shared:link-1"]')!;
  const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
  await act(async () => { row.dispatchEvent(event); });
  expect(event.defaultPrevented).toBe(false);
  expect(host.querySelector('[aria-label="Selected discussion"]')).toBeNull();
});

it("a dead one renders the unavailable state, with no link", async () => {
  notifications = [dead()];
  await mount();
  await act(async () => { host.querySelector<HTMLElement>('[role="tab"]:nth-child(2)')!.click(); });
  expect(host.textContent).toContain("This link is no longer available.");
  expect(host.textContent).not.toContain("shared 《");
  expect(host.querySelector("ul a[href]")).toBeNull();
  expect(host.querySelector('[data-inbox-entry="shared:link-1"]')).toBeNull();
});

it("reads from the entry alone", () => {
  expect(notificationHref(sharedEntry())).toBe("/w/me/shares/tok");
  expect(notificationLine(sharedEntry())).toBe("Dana shared 《Quarterly plan》 with you");
  expect(notificationTitle(sharedEntry())).toBe("Quarterly plan");
  expect(notificationHref(dead())).toBeNull();
  expect(notificationLine(dead())).toBe("This link is no longer available.");
  expect(notificationTitle(dead())).toBe("A shared document");
  expect(notificationLine(sharedEntry({ authorName: undefined }))).toBe("Someone shared 《Quarterly plan》 with you");
});
