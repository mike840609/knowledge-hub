import { isRetractedThread, type ReviewComment, type ReviewThread } from "./document-review";
import { ValidationError } from "./errors";

/** A shared-page reader following one discussion, through the link they last wrote in it by. */
export type ReviewFollow = { threadId: string; userId: string; shareLinkId: string; following: boolean; seenAt: Date };

/** One row of Shares → Discussions. A dead link's row names nothing (spec 2026-10-23 § The list). */
export type FollowedDiscussionView =
  /** `documentId` only on a folder link, whose page needs it (`?d=`). */
  | { threadId: string; linkAvailable: true; token: string; documentId?: string; documentTitle: string; threadStatus: "OPEN" | "RESOLVED"; authorName: string | undefined; excerpt: string; latestAt: Date; unread: number }
  | { threadId: string; linkAvailable: false };
export type DiscussionFilter = "all" | "unread";

/**
 * What a followed discussion holds for its follower: the newest standing comment by anyone, the
 * newest by others, and how many of others' arrived after `seenAt`. A link that no longer opens
 * says only that (spec 2026-10-22 § The follower's Inbox): nothing written, before or after, is passed on.
 */
export function summarizeFollowedThread({ thread, comments, userId, seenAt, linkValid, excludeCommentIds }: {
  thread: ReviewThread; comments: ReviewComment[]; userId: string; seenAt: Date; linkValid: boolean;
  /** Comments the Inbox already shows as mentions: neither unread nor the latest reply. */
  excludeCommentIds?: ReadonlySet<string>;
}): { latest: ReviewComment; latestReply: ReviewComment | null; unread: number } | { unavailable: true } | null {
  if (!linkValid) return { unavailable: true };
  if (thread.visibility === "HIDDEN" || isRetractedThread(comments)) return null;
  const standing = comments.filter(comment => !comment.deletedAt && comment.visibility === "VISIBLE");
  const latest = standing.at(-1);
  if (!latest) return null;
  const replies = standing.filter(comment => comment.authorUserId !== userId && !excludeCommentIds?.has(comment.id));
  return { latest, latestReply: replies.at(-1) ?? null, unread: replies.filter(comment => comment.createdAt > seenAt).length };
}

/** Unread first, then the newest activity; a dead link has no time to sort by and goes last. */
export function orderFollowedDiscussions(items: FollowedDiscussionView[]): FollowedDiscussionView[] {
  const rank = (item: FollowedDiscussionView) => !item.linkAvailable ? 2 : item.unread > 0 ? 0 : 1;
  const time = (item: FollowedDiscussionView) => item.linkAvailable ? item.latestAt.getTime() : 0;
  return [...items].sort((a, b) => rank(a) - rank(b) || time(b) - time(a) || a.threadId.localeCompare(b.threadId));
}

export function parseDiscussionFilter(value: string | undefined): DiscussionFilter {
  if (!value || value === "all") return "all";
  if (value === "unread") return "unread";
  throw new ValidationError("Choose All or Unread.");
}

export function filterFollowedDiscussions(items: FollowedDiscussionView[], filter: DiscussionFilter): FollowedDiscussionView[] {
  return filter === "all" ? items : items.filter(item => item.linkAvailable && item.unread > 0);
}
