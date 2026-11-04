import type { ReviewFollowRepository } from "../ports/review-follow-repository";

/**
 * Follows because the user was mentioned, without disturbing a live follow (spec 2026-10-29 § Writing a mention):
 * no row follows as `follow` does; an active follow keeps `seen_at` and moves to the new link only when its own
 * link no longer opens. A stopped follow is followed again for a new mention, but an old mention (someone added
 * to the link later) must leave it stopped. Runs inside the caller's transaction.
 */
export async function followForMention(
  follows: ReviewFollowRepository,
  input: {
    threadId: string;
    userId: string;
    shareLinkId: string;
    at: Date;
    currentLinkValid: (shareLinkId: string) => Promise<boolean>;
    /** Defaults to true: a new mention follows again a discussion the person stopped following. */
    reFollowWhenStopped?: boolean;
  },
): Promise<void> {
  const { threadId, userId, shareLinkId, at } = input;
  // Insert first: locking a missing row would take a gap lock, and two mentions of one person could deadlock on it.
  if (await follows.followIfAbsent({ threadId, userId, shareLinkId, at })) return;
  const row = await follows.lockFollow(threadId, userId);
  if (!row || !row.following) {
    if (input.reFollowWhenStopped === false) return;
    return follows.follow({ threadId, userId, shareLinkId, at });
  }
  if (await input.currentLinkValid(row.shareLinkId)) return;
  await follows.moveToLink(threadId, userId, shareLinkId, at);
}
