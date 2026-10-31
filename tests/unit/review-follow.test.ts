import { describe, expect, it } from "vitest";
import { filterFollowedDiscussions, orderFollowedDiscussions, parseDiscussionFilter, summarizeFollowedThread, type FollowedDiscussionView } from "@/modules/knowledge/domain/review-follow";
import type { ReviewComment, ReviewThread } from "@/modules/knowledge/domain/document-review";

const at = (minute: number) => new Date(Date.UTC(2026, 9, 22, 9, minute));
const hidden = { visibility: "VISIBLE" as const, hiddenBy: null, hiddenAt: null, hiddenReason: null };
const thread = (overrides: Partial<ReviewThread> = {}): ReviewThread => ({
  ...hidden, id: "t", documentId: "d", createdRevisionId: "r", createdBy: "reader", creationIdempotencyKey: "k", creationRequestHash: "h",
  originShareLinkId: "l", anchor: { schemaVersion: 1, blockPath: [0], blockKind: "paragraph", startUtf16: 0, endUtf16: 1, exact: "x", prefix: "", suffix: "" },
  status: "OPEN", resolvedBy: null, resolvedAt: null, createdAt: at(0), updatedAt: at(0), ...overrides,
});
const comment = (id: string, author: string, minute: number, overrides: Partial<ReviewComment> = {}): ReviewComment => ({
  ...hidden, id, threadId: "t", authorUserId: author, body: `body ${id}`, createdAt: at(minute), editedAt: null, deletedAt: null, idempotencyKey: id, requestHash: id, ...overrides,
});
const summarize = (comments: ReviewComment[], overrides: { seenAt?: Date; linkValid?: boolean; thread?: Partial<ReviewThread>; excludeCommentIds?: ReadonlySet<string> } = {}) =>
  summarizeFollowedThread({ thread: thread(overrides.thread), comments, userId: "reader", seenAt: overrides.seenAt ?? at(1), linkValid: overrides.linkValid ?? true, excludeCommentIds: overrides.excludeCommentIds });

describe("a followed discussion's replies, as the follower's Inbox reads them", () => {
  it("counts replies by others after the follower last saw it, and names the latest", () => {
    const result = summarize([comment("a", "reader", 0), comment("b", "owner", 2), comment("c", "other", 3)]);
    expect(result).toMatchObject({ unread: 2, latestReply: { id: "c" }, latest: { id: "c" } });
  });
  it("never counts the follower's own words, but still names the latest", () => {
    expect(summarize([comment("a", "reader", 0), comment("b", "reader", 5)])).toMatchObject({ unread: 0, latestReply: null, latest: { id: "b" } });
  });
  it("leaves an excluded reply out of unread, and names the previous reply as latest", () => {
    const comments = [comment("a", "reader", 0), comment("b", "owner", 2), comment("c", "other", 3)];
    expect(summarize(comments, { excludeCommentIds: new Set(["c"]) })).toMatchObject({ unread: 1, latestReply: { id: "b" }, latest: { id: "c" } });
  });
  it("has no latest reply when the only reply is excluded", () => {
    expect(summarize([comment("a", "reader", 0), comment("b", "owner", 2)], { excludeCommentIds: new Set(["b"]) })).toMatchObject({ unread: 0, latestReply: null });
  });
  it("names the latest reply by others apart from the latest comment", () => {
    expect(summarize([comment("a", "reader", 0), comment("b", "owner", 2), comment("c", "reader", 3)])).toMatchObject({ unread: 1, latestReply: { id: "b" }, latest: { id: "c" } });
  });
  it("keeps a reply already seen as the latest, read", () => {
    expect(summarize([comment("a", "reader", 0), comment("b", "owner", 1)], { seenAt: at(1) })).toMatchObject({ unread: 0, latestReply: { id: "b" }, latest: { id: "b" } });
  });
  it("skips hidden and deleted replies", () => {
    const result = summarize([comment("a", "reader", 0), comment("b", "owner", 2), comment("c", "owner", 3, { visibility: "HIDDEN" }), comment("d", "other", 4, { deletedAt: at(5) })]);
    expect(result).toMatchObject({ unread: 1, latestReply: { id: "b" }, latest: { id: "b" } });
  });
  it("lists nothing for a hidden or retracted discussion", () => {
    expect(summarize([comment("a", "reader", 0), comment("b", "owner", 2)], { thread: { visibility: "HIDDEN" } })).toBeNull();
    expect(summarize([comment("a", "reader", 0, { deletedAt: at(1) })])).toBeNull();
  });
  it("says only that a dead link is unavailable, whatever was written", () => {
    expect(summarize([comment("a", "reader", 0), comment("b", "owner", 2)], { linkValid: false })).toEqual({ unavailable: true });
  });
  it("lists nothing when the discussion holds no standing comment", () => {
    expect(summarize([])).toBeNull();
  });
});

const live = (threadId: string, unread: number, minute: number): FollowedDiscussionView => ({ threadId, linkAvailable: true, token: "t", documentTitle: "Doc", threadStatus: "OPEN", authorName: "A", excerpt: "x", latestAt: at(minute), unread });
const dead = (threadId: string): FollowedDiscussionView => ({ threadId, linkAvailable: false });

describe("the reader's list of followed discussions", () => {
  it("puts unread first, then the most recent, and dead links last", () => {
    const ordered = orderFollowedDiscussions([dead("d"), live("old", 0, 1), live("unread", 2, 0), live("new", 0, 9)]);
    expect(ordered.map(item => item.threadId)).toEqual(["unread", "new", "old", "d"]);
  });
  it("filters to unread live rows only", () => {
    const items = [dead("d"), live("read", 0, 1), live("unread", 1, 0)];
    expect(filterFollowedDiscussions(items, "unread").map(item => item.threadId)).toEqual(["unread"]);
    expect(filterFollowedDiscussions(items, "all")).toHaveLength(3);
  });
  it("accepts all or unread, defaulting to all, and refuses anything else", () => {
    expect(parseDiscussionFilter(undefined)).toBe("all");
    expect(parseDiscussionFilter("")).toBe("all");
    expect(parseDiscussionFilter("all")).toBe("all");
    expect(parseDiscussionFilter("unread")).toBe("unread");
    expect(() => parseDiscussionFilter("resolved")).toThrow("Choose All or Unread.");
  });
});
