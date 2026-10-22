import { isRetractedThread, type ReviewComment, type ReviewThread } from "./document-review";

/** A shared-page reader following one discussion, through the link they last wrote in it by. */
export type ReviewFollow = { threadId: string; userId: string; shareLinkId: string; following: boolean; seenAt: Date };

/**
 * What a followed discussion holds for its follower: the replies others wrote that still stand,
 * how many arrived after `seenAt`, and the newest. A link that no longer opens says only that
 * (spec 2026-10-22 § The follower's Inbox): nothing written, before or after, is passed on.
 */
export function summarizeFollowedThread({ thread, comments, userId, seenAt, linkValid }: {
  thread: ReviewThread; comments: ReviewComment[]; userId: string; seenAt: Date; linkValid: boolean;
}): { latest: ReviewComment; unread: number } | { unavailable: true } | null {
  if (!linkValid) return { unavailable: true };
  if (thread.visibility === "HIDDEN" || isRetractedThread(comments)) return null;
  const replies = comments.filter(comment => comment.authorUserId !== userId && !comment.deletedAt && comment.visibility === "VISIBLE");
  const latest = replies.at(-1);
  if (!latest) return null;
  return { latest, unread: replies.filter(comment => comment.createdAt > seenAt).length };
}
