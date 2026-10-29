import type { ReviewFollow } from "../domain/review-follow";
/** A reader's follows. Every method is keyed by the user it acts for; none reaches another's rows. */
export interface ReviewFollowRepository {
  /** Follows, or follows again: `seen_at` moves to `at`, so nothing already there reads as new. */
  follow(input: { threadId: string; userId: string; shareLinkId: string; at: Date }): Promise<void>;
  /**
   * Follows because the user was mentioned, inside the caller's transaction, without disturbing a live follow:
   * no row or `following=0` follows as `follow` does; an active follow keeps `seen_at`, and only moves to the
   * new link when `currentLinkValid(its link)` is false. The callback runs only for an active follow.
   */
  followForMention(input: { threadId: string; userId: string; shareLinkId: string; at: Date; currentLinkValid: (shareLinkId: string) => Promise<boolean> }): Promise<void>;
  unfollow(threadId: string, userId: string, at: Date): Promise<void>;
  /** No row, no change: seeing a discussion does not follow it. */
  markSeen(threadId: string, userId: string, at: Date): Promise<void>;
  markAllSeen(userId: string, at: Date): Promise<void>;
  listFollowing(userId: string, limit: number): Promise<ReviewFollow[]>;
  followingThreadIds(userId: string, threadIds: readonly string[]): Promise<Set<string>>;
}
