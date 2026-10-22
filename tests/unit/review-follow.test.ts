import { describe, expect, it } from "vitest";
import { summarizeFollowedThread } from "@/modules/knowledge/domain/review-follow";
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
const summarize = (comments: ReviewComment[], overrides: { seenAt?: Date; linkValid?: boolean; thread?: Partial<ReviewThread> } = {}) =>
  summarizeFollowedThread({ thread: thread(overrides.thread), comments, userId: "reader", seenAt: overrides.seenAt ?? at(1), linkValid: overrides.linkValid ?? true });

describe("a followed discussion's replies, as the follower's Inbox reads them", () => {
  it("counts replies by others after the follower last saw it, and names the latest", () => {
    const result = summarize([comment("a", "reader", 0), comment("b", "owner", 2), comment("c", "other", 3)]);
    expect(result).toMatchObject({ unread: 2, latest: { id: "c" } });
  });
  it("never counts the follower's own words", () => {
    expect(summarize([comment("a", "reader", 0), comment("b", "reader", 5)])).toBeNull();
  });
  it("keeps a reply already seen as the latest, read", () => {
    expect(summarize([comment("a", "reader", 0), comment("b", "owner", 1)], { seenAt: at(1) })).toMatchObject({ unread: 0, latest: { id: "b" } });
  });
  it("skips hidden and deleted replies", () => {
    const result = summarize([comment("a", "reader", 0), comment("b", "owner", 2), comment("c", "owner", 3, { visibility: "HIDDEN" }), comment("d", "other", 4, { deletedAt: at(5) })]);
    expect(result).toMatchObject({ unread: 1, latest: { id: "b" } });
  });
  it("lists nothing for a hidden or retracted discussion", () => {
    expect(summarize([comment("a", "reader", 0), comment("b", "owner", 2)], { thread: { visibility: "HIDDEN" } })).toBeNull();
    expect(summarize([comment("a", "reader", 0, { deletedAt: at(1) })])).toBeNull();
  });
  it("says only that a dead link is unavailable, whatever was written", () => {
    expect(summarize([comment("a", "reader", 0), comment("b", "owner", 2)], { linkValid: false })).toEqual({ unavailable: true });
  });
  it("lists nothing when no one else has said anything", () => {
    expect(summarize([])).toBeNull();
  });
});
