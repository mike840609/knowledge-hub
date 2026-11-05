import { expect, it } from "vitest";
import { filterInboxDiscussions, mergeInboxDiscussions, sortInboxDiscussions, type InboxDiscussionView } from "@/modules/knowledge/domain/inbox-discussion";

const view = (over: Partial<InboxDiscussionView> & Pick<InboxDiscussionView, "threadId" | "kind">): InboxDiscussionView => ({
  documentId: "doc", sourceId: "src", documentTitle: "Doc", quote: "quote",
  href: `/w/ws/knowledge/src/doc?thread=${over.threadId}`,
  latest: { authorName: "Ann", excerpt: "hello", createdAt: new Date(10) },
  latestAt: new Date(10), commentCount: 1, unreadCount: 0, status: "OPEN",
  following: false, mentioned: false, ...over,
});

it("merges owner and mention of one thread into one owner row", () => {
  const merged = mergeInboxDiscussions([
    view({ threadId: "t", kind: "OWNER", unreadCount: 2, latestAt: new Date(20) }),
    view({ threadId: "t", kind: "MENTION", mentioned: true, unreadCount: 1, latestAt: new Date(10) }),
  ]);
  expect(merged).toHaveLength(1);
  expect(merged[0]).toMatchObject({ kind: "OWNER", mentioned: true, following: false, unreadCount: 2 });
  expect(merged[0].latestAt).toEqual(new Date(20));
});

it("merges a follow and a mention, keeps both flags and the follow's live href", () => {
  const merged = mergeInboxDiscussions([
    view({ threadId: "t", kind: "FOLLOW", following: true, unreadCount: 2, href: "/s/tok?thread=t", token: "tok", documentId: "doc" }),
    view({ threadId: "t", kind: "MENTION", mentioned: true, unreadCount: 1, latestAt: new Date(30), href: "/other", token: "other" }),
  ]);
  expect(merged).toHaveLength(1);
  expect(merged[0]).toMatchObject({ kind: "MENTION", following: true, mentioned: true, unreadCount: 3, href: "/s/tok?thread=t", token: "tok" });
  expect(merged[0].latestAt).toEqual(new Date(30));
});

it("filters by the relationship flags, status and unread", () => {
  const rows = [
    view({ threadId: "a", kind: "OWNER" }),
    view({ threadId: "b", kind: "FOLLOW", following: true, unreadCount: 1 }),
    view({ threadId: "c", kind: "MENTION", mentioned: true, status: "RESOLVED" }),
  ];
  expect(filterInboxDiscussions(rows, { kind: "follow", status: "all", unread: false }).map(r => r.threadId)).toEqual(["b"]);
  expect(filterInboxDiscussions(rows, { kind: "mention", status: "all", unread: false }).map(r => r.threadId)).toEqual(["c"]);
  expect(filterInboxDiscussions(rows, { kind: "all", status: "resolved", unread: false }).map(r => r.threadId)).toEqual(["c"]);
  expect(filterInboxDiscussions(rows, { kind: "all", status: "all", unread: true }).map(r => r.threadId)).toEqual(["b"]);
});

it("sorts newest first, then thread id descending", () => {
  expect(sortInboxDiscussions([
    view({ threadId: "a", kind: "OWNER", latestAt: new Date(10) }),
    view({ threadId: "c", kind: "OWNER", latestAt: new Date(20) }),
    view({ threadId: "b", kind: "OWNER", latestAt: new Date(20) }),
  ]).map(r => r.threadId)).toEqual(["c", "b", "a"]);
});
