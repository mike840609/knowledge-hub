"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ShareCommentNotificationView } from "@/modules/knowledge/domain/share-comment-event";
import { reviewRequest } from "./review-thread-list";

/**
 * The owner's unread share-comment notices for one document, by discussion. A failed fetch
 * shows no badge and never blocks the panel; a failed mark-read retries once in the
 * background, then leaves the badge until the next open.
 */
export function useShareCommentUnread(documentId: string) {
  const [unread, setUnread] = useState<ShareCommentNotificationView[]>([]);
  const refresh = useCallback(async () => {
    try {
      const result = await reviewRequest<{ notifications: ShareCommentNotificationView[] }>("/api/review-notifications/unread");
      setUnread(result.notifications.filter(notice => (notice.kind === "OWNER" || notice.kind === undefined) && notice.documentId === documentId));
    } catch {
      setUnread([]);
    }
  }, [documentId]);
  useEffect(() => { void refresh(); }, [refresh]);
  /** One discussion's notices with a thread; all of this document's without one. */
  const markRead = useCallback(async (threadId?: string) => {
    const send = () => reviewRequest("/api/review-notifications/mark-read", threadId ? { documentId, threadId } : { documentId });
    try {
      await send();
    } catch {
      try {
        await send();
      } catch {
        return;
      }
    }
    await refresh();
    window.dispatchEvent(new Event("kh:notification-changed"));
  }, [documentId, refresh]);
  const unreadThreadIds = useMemo(() => new Set(unread.map(notice => notice.threadId)), [unread]);
  return { unreadCount: unread.length, unreadThreadIds, refresh, markRead };
}
