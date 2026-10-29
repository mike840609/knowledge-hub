/** A comment that names a user with `@`. `readAt` is that user's own read state. */
export type ReviewMention = { commentId: string; mentionedUserId: string; shareLinkId: string; createdAt: Date; readAt: Date | null };
