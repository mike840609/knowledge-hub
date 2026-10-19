"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ShareCommentNotificationView } from "@/modules/knowledge/domain/share-comment-event";
import { Timestamp } from "@/components/ui/timestamp";
import { reviewRequest } from "./review-thread-list";

/**
 * Unread share-link comments across the owner's documents, newest first.
 * Each row jumps to its document with the thread selected. Empty, loading,
 * and failed requests stay distinct without blocking the rest of Home.
 */
export type HomeDiscussionsState = {
  notices: ShareCommentNotificationView[];
  status: "loading" | "ready" | "error";
};

export function useHomeDiscussions(workspaceId: string): HomeDiscussionsState {
  const [notices, setNotices] = useState<ShareCommentNotificationView[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const requestSequence = useRef(0);

  const refresh = useCallback(async () => {
    const sequence = ++requestSequence.current;
    try {
      const result = await reviewRequest<{ notifications: ShareCommentNotificationView[] }>("/api/review-notifications/unread");
      if (requestSequence.current !== sequence) return;
      setNotices(result.notifications);
      setStatus("ready");
    } catch {
      if (requestSequence.current === sequence) {
        setNotices([]);
        setStatus("error");
      }
    }
  }, []);

  useEffect(() => {
    setStatus("loading");
    void refresh();
    window.addEventListener("kh:notification-changed", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      requestSequence.current += 1;
      window.removeEventListener("kh:notification-changed", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [refresh, workspaceId]);

  return {
    notices: notices.filter(notice => notice.workspaceId === workspaceId && !notice.readAt && notice.threadStatus === "OPEN"),
    status,
  };
}

export function HomeDiscussions({ workspaceId, compact = false }: {
  workspaceId: string;
  compact?: boolean;
}) {
  const state = useHomeDiscussions(workspaceId);
  return <HomeDiscussionsContent workspaceId={workspaceId} compact={compact} state={state} />;
}

export function HomeDiscussionsContent({ workspaceId, compact = false, state }: {
  workspaceId: string;
  compact?: boolean;
  state: HomeDiscussionsState;
}) {
  const { notices, status } = state;
  const visible = notices;

  if (compact) {
    return <section aria-label="Discussions">
      <p role="status" className="px-3 py-2 text-body text-kh-text-muted">
        {status === "loading" ? "Checking discussions…" : <>No new comments or replies. <Link className="kh-focus-ring rounded-sm text-kh-link" href={`/w/${workspaceId}/inbox`}>Open Inbox</Link></>}
      </p>
    </section>;
  }

  return <section aria-label="Discussions">
    <div className="flex items-center justify-between gap-3 px-3 pb-3">
      <h2 className="flex min-w-0 items-center gap-2 text-body font-semibold text-kh-text">Discussions{visible.length > 0 ? <span className="shrink-0 text-caption text-kh-text-muted" aria-label={`${visible.length} unread notifications`}>{visible.length}</span> : null}</h2>
      <Link className="kh-focus-ring -my-2 shrink-0 rounded-sm py-2 text-body-sm text-kh-link" href={`/w/${workspaceId}/inbox`}>Open Inbox</Link>
    </div>
    {status === "loading" ? <p role="status" className="px-3 py-2 text-body text-kh-text-muted">Loading discussions…</p> : status === "error" ? <p role="status" className="px-3 py-2 text-body text-kh-text-muted">Could not load discussions. Try opening Inbox.</p> : !visible.length ? <p className="px-3 py-2 text-body text-kh-text-muted">No new comments or replies.</p> : <ul aria-label="Unread discussions" className="space-y-1">{visible.slice(0, 5).map(notice => (
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
  ))}</ul>}
  </section>;
}
