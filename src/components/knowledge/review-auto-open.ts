import type { ReviewStatus, ReviewVisibility } from "@/modules/knowledge/domain/document-review";

type Discussion = { id: string; status: ReviewStatus; visibility: ReviewVisibility };

/** Where the owner's closing of the rail on a document is remembered, as the discussions it was closed on. */
export const dismissedKey = (documentId: string) => `kh:review-dismissed:${documentId}`;

/** The discussions that want the owner: open, and not ones the owner has hidden. */
export function awaitingOwner(threads: readonly Discussion[]): string[] {
  return threads.filter((thread) => thread.status === "OPEN" && thread.visibility === "VISIBLE").map((thread) => thread.id);
}

/**
 * Whether the rail opens by itself when the document is opened: when a discussion awaits the owner
 * that the owner has not already closed the rail on. So it is there when someone has said something
 * new, and stays out of the way once that has been seen — or dealt with.
 */
export function opensOnArrival(threads: readonly Discussion[], dismissed: readonly string[]): boolean {
  return awaitingOwner(threads).some((id) => !dismissed.includes(id));
}

export function parseDismissed(stored: string | null): string[] {
  try {
    const value: unknown = JSON.parse(stored ?? "");
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}
