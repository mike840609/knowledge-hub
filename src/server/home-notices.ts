import type { HomeNotice } from "@/components/knowledge/home-attention";
import type { CallerContext } from "@/modules/identity/domain/caller-context";
import type { DocumentReviewService } from "@/modules/knowledge/application/document-review-service";

/** Unread share comments for Home's attention strip. A failed read yields none: it never blocks Home. */
export async function unreadHomeNotices(reviews: Pick<DocumentReviewService, "listUnreadForOwner">, caller: CallerContext): Promise<HomeNotice[]> {
  try {
    const { notifications } = await reviews.listUnreadForOwner(caller);
    return notifications.map(n => ({ ...n, createdAt: n.createdAt.toISOString(), readAt: n.readAt ? n.readAt.toISOString() : null }));
  } catch {
    return [];
  }
}
