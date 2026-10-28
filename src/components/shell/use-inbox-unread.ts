"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { reviewRequest } from "@/components/knowledge/review-thread-list";

/**
 * How many share-comment notifications await this reader.
 *
 * The Inbox navigation row needs the number before its popover is opened, and
 * the popover already learned when to refresh: a notification arrived, the
 * window regained focus, or the reader moved to another page. This keeps the
 * same rhythm in one place instead of a second copy of it.
 */
export function useInboxUnread(enabled: boolean): number {
  const pathname = usePathname();
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      const data = await reviewRequest<{ notifications: readonly unknown[] }>("/api/review-notifications/unread");
      setCount(data.notifications.length);
    } catch {
      // The Hub remains usable when review notifications are temporarily unavailable.
    }
  }, [enabled]);

  useEffect(() => {
    void refresh();
    window.addEventListener("kh:notification-changed", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("kh:notification-changed", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [pathname, refresh]);

  return count;
}
