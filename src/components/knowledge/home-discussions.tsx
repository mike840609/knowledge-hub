"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ShareCommentNotificationView } from "@/modules/knowledge/domain/share-comment-event";
import { Timestamp } from "@/components/ui/timestamp";
import { reviewRequest } from "./review-thread-list";

/**
 * Unread share-link comments across the owner's documents, newest first.
 * Each row jumps to its document with the thread selected. Renders nothing
 * without unread notices, and a failed fetch never blocks the home page.
 */
export function HomeDiscussions() {
  const [notices, setNotices] = useState<ShareCommentNotificationView[]>([]);
  useEffect(() => {
    let live = true;
    reviewRequest<{ notifications: ShareCommentNotificationView[] }>("/api/review-notifications/unread")
      .then(result => { if (live) setNotices(result.notifications); })
      .catch(() => { if (live) setNotices([]); });
    return () => { live = false; };
  }, []);
  if (!notices.length) return null;
  return <ul aria-label="Unread discussions" className="mb-3 space-y-1">{notices.slice(0, 5).map(notice => (
    <li key={notice.id}>
      <Link className="kh-interactive-row kh-focus-ring block rounded-md px-3 py-2" href={`/w/${notice.workspaceId}/knowledge/${notice.sourceId}/${notice.documentId}?thread=${notice.threadId}`}>
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-body text-kh-text">{notice.documentTitle}</span>
          <span className="shrink-0 text-caption text-kh-text-muted"><Timestamp value={String(notice.createdAt)} variant="relative" /></span>
        </span>
        <span className="mt-1 flex min-w-0 items-center gap-2 text-caption text-kh-text-muted">
          <span className="min-w-0 flex-1 truncate">{notice.authorName ?? "Someone"}: {notice.excerpt}</span>
          <span className="shrink-0">Unread</span>
        </span>
      </Link>
    </li>
  ))}</ul>;
}
