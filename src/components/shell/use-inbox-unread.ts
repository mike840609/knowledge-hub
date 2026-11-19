"use client";

import { startTransition, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { reviewRequest } from "@/components/knowledge/review-thread-list";

/**
 * How many share-comment notifications await this reader.
 *
 * The sidebar's Inbox badge refreshes when notifications change, when the
 * window regains focus, and when the reader navigates to another page.
 */
export function useInboxUnread(enabled: boolean): number {
  const pathname = usePathname();
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let latestRequest = 0;
    async function refresh() {
      const request = ++latestRequest;
      try {
        const data = await reviewRequest<{ count: number }>("/api/review-notifications/unread-count");
        if (request !== latestRequest) return;
        // Let an in-flight navigation finish before updating the shell's badge.
        startTransition(() => setCount(data.count));
      } catch {
        // Keep the last count when review notifications are temporarily unavailable.
      }
    }

    void refresh();
    window.addEventListener("kh:notification-changed", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      latestRequest++;
      window.removeEventListener("kh:notification-changed", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [enabled, pathname]);

  return count;
}
