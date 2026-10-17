// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { HomeDiscussions } from "@/components/knowledge/home-discussions";
const request = vi.hoisted(() => vi.fn());
vi.mock("@/components/knowledge/review-thread-list", () => ({ reviewRequest: request }));
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
it("counts only unread open discussions in this workspace and links directly to the thread", async () => {
  const notice = { id: "notice", workspaceId: "ws", sourceId: "source", documentId: "doc", threadId: "thread", documentTitle: "Review me", authorName: "Alex", excerpt: "Please clarify", createdAt: "2026-10-17T00:00:00Z", readAt: null, threadStatus: "OPEN" };
  request.mockResolvedValue({ notifications: [notice, { ...notice, id: "other", workspaceId: "elsewhere", documentTitle: "Other workspace" }, { ...notice, id: "resolved", threadStatus: "RESOLVED" }, { ...notice, id: "read", readAt: "2026-10-17T01:00:00Z" }] });
  await act(async () => root.render(<HomeDiscussions workspaceId="ws" />));
  expect(container.querySelector('[aria-label="1 unread notifications"]')).not.toBeNull();
  expect(container.querySelectorAll("li")).toHaveLength(1);
  expect(container.querySelector("li a")?.getAttribute("href")).toBe("/w/ws/knowledge/source/doc?thread=thread");
  expect(container.textContent).not.toContain("Other workspace");
});
it("distinguishes a failed request from an empty inbox", async () => {
  request.mockRejectedValue(new Error("offline"));
  await act(async () => root.render(<HomeDiscussions workspaceId="ws" />));
  expect(container.textContent).toContain("Could not load discussions");
  expect(container.textContent).not.toContain("No new comments");
});
it("keeps the empty state compact with an inbox link", async () => {
  request.mockResolvedValue({ notifications: [] });
  await act(async () => root.render(<HomeDiscussions workspaceId="ws" />));
  expect(container.textContent).toContain("No new comments or replies.");
  expect(container.querySelector("a")?.getAttribute("href")).toBe("/w/ws/inbox");
});
