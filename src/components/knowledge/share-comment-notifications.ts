"use client";

import { useCallback, useEffect, useState } from "react";
import type { ShareCommentNotificationView } from "@/modules/knowledge/domain/share-comment-event";
import { reviewRequest } from "./review-thread-list";

/**
 * The owner's unread share-comment notices for one document. A failed fetch
 * shows no badge and never blocks the panel; a failed mark-read retries once
 * in the background, then leaves the badge until the next open.
 */
export function useShareCommentUnread(documentId: string) {
  const [unread, setUnread] = useState<ShareCommentNotificationView[]>([]);
  const refresh = useCallback(async () => {
    try {
      const result = await reviewRequest<{ notifications: ShareCommentNotificationView[] }>("/api/review-notifications/unread");
      setUnread(result.notifications.filter(notice => notice.documentId === documentId));
    } catch {
      setUnread([]);
    }
  }, [documentId]);
  useEffect(() => { void refresh(); }, [refresh]);
  const markRead = useCallback(async () => {
    const send = () => reviewRequest("/api/review-notifications/mark-read", { documentId });
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
  }, [documentId, refresh]);
  return { unreadCount: unread.length, refresh, markRead };
}
