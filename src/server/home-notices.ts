import type { HomeNotice } from "@/components/knowledge/home-attention";
import { isProposalEntry } from "@/components/knowledge/notification-href";
import type { CallerContext } from "@/modules/identity/domain/caller-context";
import type { DocumentReviewService } from "@/modules/knowledge/application/document-review-service";

/** Unread share comments for Home's attention strip. A failed read yields none: it never blocks Home. */
export async function unreadHomeNotices(reviews: Pick<DocumentReviewService, "listUnreadForOwner">, caller: CallerContext): Promise<HomeNotice[]> {
  try {
    const { notifications } = await reviews.listUnreadForOwner(caller);
    // Proposals need the Inbox's decision controls; Home's discussion strip has no row that can act on them, and their
    // proposal views carry no workspace to fall back to.
    return notifications.filter(n => !isProposalEntry(n.kind)).map(n => ({ ...n, createdAt: n.createdAt.toISOString(), readAt: n.readAt ? n.readAt.toISOString() : null }));
  } catch {
    return [];
  }
}
