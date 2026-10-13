import type { ReviewStatus, ReviewVisibility } from "@/modules/knowledge/domain/document-review";

type Discussion = { id: string; status: ReviewStatus; visibility: ReviewVisibility; comments: readonly { authorUserId: string; visibility: ReviewVisibility; deleted?: boolean }[] };

/** Where the owner's closing of the rail on a document is remembered, as the discussions it was closed on. */
export const dismissedKey = (documentId: string) => `kh:review-dismissed:${documentId}`;

/**
 * The discussions that want the owner: open, not ones the owner has hidden, and where the last
 * word that stands is someone else's. One the owner started, or answered, waits for a reader.
 */
export function awaitingOwner(threads: readonly Discussion[], ownerId: string | null): string[] {
  const last = (thread: Discussion) => thread.comments.filter((comment) => comment.visibility === "VISIBLE" && !comment.deleted).at(-1);
  return threads.filter((thread) => thread.status === "OPEN" && thread.visibility === "VISIBLE" && last(thread)?.authorUserId !== ownerId).map((thread) => thread.id);
}

/**
 * Whether the rail opens by itself when the document is opened: when a discussion awaits the owner
 * that the owner has not already closed the rail on. So it is there when someone has said something
 * new, and stays out of the way once that has been seen — or dealt with.
 */
export function opensOnArrival(threads: readonly Discussion[], dismissed: readonly string[], ownerId: string | null): boolean {
  return awaitingOwner(threads, ownerId).some((id) => !dismissed.includes(id));
}

export function parseDismissed(stored: string | null): string[] {
  try {
    const value: unknown = JSON.parse(stored ?? "");
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}
