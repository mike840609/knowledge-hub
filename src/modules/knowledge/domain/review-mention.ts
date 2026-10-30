import { DomainError } from "@/shared/domain/errors";
import { isUuid } from "@/shared/ids/uuidv7";

/** A comment that names a user with `@`. `readAt` is that user's own read state. */
export type ReviewMention = { commentId: string; mentionedUserId: string; shareLinkId: string | null; createdAt: Date; readAt: Date | null };

export const MENTION_LIMIT = 10;
export const MENTION_PREFIX = "mention:";

/** Validated, de-duplicated mention targets; the writer and the Workspace owner dropped. Throws DomainError INVALID_REQUEST. */
export function normalizeMentions(raw: unknown, ctx: { writerId: string; ownerId: string | null }): string[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new DomainError("INVALID_REQUEST", "Mentions must be a list of user ids.");
  const skip = new Set([ctx.writerId.toLowerCase(), ctx.ownerId?.toLowerCase()]);
  const ids = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string" || !isUuid(item)) throw new DomainError("INVALID_REQUEST", "Each mention must be a user id.");
    const id = item.toLowerCase();
    if (!skip.has(id)) ids.add(id);
  }
  if (ids.size > MENTION_LIMIT) throw new DomainError("INVALID_REQUEST", `Mention at most ${MENTION_LIMIT} people in one comment.`);
  return [...ids];
}

export { splitMentions, type MentionedPerson, type MentionPart } from "./mention-text";
