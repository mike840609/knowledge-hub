// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ShareCommentNotificationView } from "@/modules/knowledge/domain/share-comment-event";
import type { InboxDiscussionView } from "@/modules/knowledge/domain/inbox-discussion";
import { InboxFilters } from "@/components/knowledge/inbox-filters";
import { InboxDiscussionRow } from "@/components/knowledge/inbox-discussion-row";
import { InboxSharedWithYou } from "@/components/knowledge/inbox-shared-with-you";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const discussionView = (over: Partial<InboxDiscussionView> = {}): InboxDiscussionView => ({
  threadId: "t1", kind: "OWNER", documentId: "doc", sourceId: "src", documentTitle: "Doc",
  quote: "the passage", href: "/w/ws/knowledge/src/doc?thread=t1",
  latest: { authorName: "Ann", excerpt: "reply", createdAt: new Date(20) },
  latestAt: new Date(20), commentCount: 3, unreadCount: 2, status: "OPEN",
  following: false, mentioned: true, ...over,
});
const sharedEntry = (over: Partial<ShareCommentNotificationView> = {}): ShareCommentNotificationView => ({
  id: "shared:l1", workspaceId: "", documentId: "", sourceId: "", documentTitle: "Quarterly plan",
  threadId: "", commentId: "", authorName: "Dana", excerpt: "", createdAt: new Date(0),
  readAt: null, threadStatus: "OPEN", kind: "SHARED_WITH_YOU", linkAvailable: true,
  href: "/w/me/shares/tok", ...over,
});
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
const chooseStatus = async (value: string) => {
  const trigger = host.querySelector<HTMLElement>('[role="combobox"]')!;
  await act(async () => { trigger.click(); });
  await settle();
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(item => item.getAttribute("data-value") === value)!;
  await act(async () => { option.dispatchEvent(new MouseEvent("mousemove", { bubbles: true })); });
  await settle();
  await act(async () => { option.click(); });
  await settle();
};

let host: HTMLDivElement, root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it("switches the relationship tab, the status and the unread toggle", async () => {
  const onKindChange = vi.fn(), onStatusChange = vi.fn(), onUnreadChange = vi.fn();
  await act(async () => root.render(<InboxFilters kind="all" status="all" unread={false} onKindChange={onKindChange} onStatusChange={onStatusChange} onUnreadChange={onUnreadChange} />));
  await act(async () => { host.querySelector<HTMLElement>('[role="group"][aria-label="Inbox relationships"] button:nth-of-type(3)')!.click(); });
  expect(onKindChange).toHaveBeenCalledWith("follow");
  await chooseStatus("open");
  expect(onStatusChange).toHaveBeenCalledWith("open");
  await act(async () => { [...host.querySelectorAll("button")].find(b => b.textContent === "Unread")!.click(); });
  expect(onUnreadChange).toHaveBeenCalledWith(true);
});

it("names the four relationships and marks the current one and the unread toggle", async () => {
  await act(async () => root.render(<InboxFilters kind="mention" status="resolved" unread onKindChange={() => {}} onStatusChange={() => {}} onUnreadChange={() => {}} />));
  const tabs = [...host.querySelectorAll<HTMLButtonElement>('[role="group"][aria-label="Inbox relationships"] button')];
  expect(tabs.map(tab => tab.textContent)).toEqual(["All", "My documents", "Following", "Mentions"]);
  expect(tabs.map(tab => tab.getAttribute("aria-pressed"))).toEqual(["false", "false", "false", "true"]);
  expect(tabs.every(tab => tab.getAttribute("role") !== "tab")).toBe(true);
  expect(host.querySelector('[role="group"]')?.getAttribute("aria-label")).toBe("Inbox relationships");
  expect(host.querySelector('[role="combobox"]')?.getAttribute("aria-label")).toBe("Status");
  expect(host.querySelector('[role="combobox"]')?.getAttribute("data-value")).toBe("resolved");
  expect([...host.querySelectorAll("button")].find(b => b.textContent === "Unread")?.getAttribute("aria-pressed")).toBe("true");
});

it("renders a discussion row and selects it without navigating", async () => {
  const onSelect = vi.fn();
  const discussion = discussionView();
  await act(async () => root.render(<InboxDiscussionRow discussion={discussion} selected={false} split busy={false} onSelect={onSelect} onMarkRead={() => {}} />));
  expect(host.textContent).toContain("the passage");
  expect(host.textContent).toContain("Ann: reply");
  expect(host.textContent).toContain("3 comments");
  expect(host.textContent).toContain("2 unread");
  expect(host.textContent).toContain("Mentioned you");
  expect(host.querySelector("a > span")?.className).toContain("font-medium");
  const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
  await act(async () => { host.querySelector("a")!.dispatchEvent(event); });
  expect(event.defaultPrevented).toBe(true);
  expect(onSelect).toHaveBeenCalledWith(discussion);
});

it("a row's link carries its thread, its selection and the ordinary navigation outside split", async () => {
  const onSelect = vi.fn();
  await act(async () => root.render(<InboxDiscussionRow discussion={discussionView({ status: "RESOLVED", unreadCount: 0 })} selected split={false} busy={false} onSelect={onSelect} onMarkRead={() => {}} />));
  const link = host.querySelector("a")!;
  expect(link.getAttribute("href")).toBe("/w/ws/knowledge/src/doc?thread=t1");
  expect(link.getAttribute("data-inbox-entry")).toBe("t1");
  expect(link.getAttribute("aria-current")).toBe("true");
  expect(link.textContent).toContain("Resolved");
  expect(link.textContent).not.toContain("unread");
  expect(host.querySelector("button")?.textContent).not.toBe("Mark read");
  const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
  await act(async () => { link.dispatchEvent(event); });
  expect(event.defaultPrevented).toBe(false);
  expect(onSelect).not.toHaveBeenCalled();
});

it("a modified click is left to the browser in split, and Mark read settles the thread", async () => {
  const onSelect = vi.fn(), onMarkRead = vi.fn();
  const discussion = discussionView();
  await act(async () => root.render(<InboxDiscussionRow discussion={discussion} selected={false} split busy={false} onSelect={onSelect} onMarkRead={onMarkRead} />));
  const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, metaKey: true });
  await act(async () => { host.querySelector("a")!.dispatchEvent(event); });
  expect(event.defaultPrevented).toBe(false);
  expect(onSelect).not.toHaveBeenCalled();
  await act(async () => { [...host.querySelectorAll("button")].find(b => b.textContent === "Mark read")!.click(); });
  expect(onMarkRead).toHaveBeenCalledWith(discussion);
});

it("a read row keeps its dot empty, loses the medium title and offers no Mark read", async () => {
  await act(async () => root.render(<InboxDiscussionRow discussion={discussionView({ unreadCount: 0, mentioned: false, following: true })} selected={false} split busy={false} onSelect={() => {}} onMarkRead={() => {}} />));
  expect(host.textContent).toContain("Following");
  expect(host.querySelector("li")?.textContent).not.toContain("unread");
  expect(host.querySelector("a > span")?.className).not.toContain("font-medium");
  expect([...host.querySelectorAll("button")].some(b => b.textContent === "Mark read")).toBe(false);
});

it("renders the shared section and marks a shared row read", async () => {
  const onMarkRead = vi.fn();
  const entry = sharedEntry();
  await act(async () => root.render(<InboxSharedWithYou workspaceId="me" shared={[entry]} busy={false} onMarkRead={onMarkRead} />));
  expect(host.textContent).toContain("Shared with you");
  expect(host.textContent).toContain("Documents, folders and sources shared with you by name. They also live in Shares.");
  expect(host.textContent).toContain("Dana shared this with you");
  expect(host.querySelector("a")?.getAttribute("href")).toBe("/w/me/shares/tok");
  expect(host.querySelector("a[href='/w/me/shares?tab=saved']")).not.toBeNull();
  await act(async () => { [...host.querySelectorAll("button")].find(b => b.textContent === "Mark read")!.click(); });
  expect(onMarkRead).toHaveBeenCalledWith(entry);
});

it("the shared section is absent when nothing is shared, and a dead share has no link", async () => {
  await act(async () => root.render(<InboxSharedWithYou workspaceId="me" shared={[]} busy={false} onMarkRead={() => {}} />));
  expect(host.querySelector('[aria-label="Shared with you"]')).toBeNull();
  await act(async () => root.render(<InboxSharedWithYou workspaceId="me" shared={[sharedEntry({ linkAvailable: false, href: undefined, documentTitle: "", authorName: undefined })]} busy={false} onMarkRead={() => {}} />));
  expect(host.textContent).toContain("This link is no longer available.");
  expect(host.textContent).toContain("A shared document");
  expect(host.querySelector('[aria-label="Shared with you"] ul a[href]')).toBeNull();
});
