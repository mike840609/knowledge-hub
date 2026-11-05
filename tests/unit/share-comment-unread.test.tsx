// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ShareCommentNotificationView } from "@/modules/knowledge/domain/share-comment-event";

const { useShareCommentUnread } = await import("@/components/knowledge/share-comment-notifications");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement, root: Root;
let notices: Partial<ShareCommentNotificationView>[];

beforeEach(() => {
  notices = [];
  vi.stubGlobal("fetch", async (url: string) => {
    if (url === "/api/review-notifications/unread") return new Response(JSON.stringify({ notifications: notices }), { headers: { "content-type": "application/json" } });
    throw new Error(`unexpected ${url}`);
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

it("the owner panel's unread hook ignores mentions", async () => {
  notices = [{ kind: "MENTION", documentId: "doc-x", threadId: "t1" }, { kind: "OWNER", documentId: "doc-x", threadId: "t2" }];
  let seen: string[] = [];
  const Probe = () => { seen = [...useShareCommentUnread("doc-x").unreadThreadIds]; return null; };
  await act(async () => root.render(<Probe />));
  await act(async () => {});
  expect(seen).toEqual(["t2"]);
});
