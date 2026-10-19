"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ShareCommentNotificationView } from "@/modules/knowledge/domain/share-comment-event";
import type { FreshnessReminder } from "@/modules/personal/application/knowledge-freshness";
import { Timestamp } from "@/components/ui/timestamp";
import { reviewRequest } from "./review-thread-list";

const ORDER = ["failed", "pending", "never", "old"];

function SourceReminder({ workspaceId, reminders }: { workspaceId: string; reminders: readonly FreshnessReminder[] }) {
  const first = [...reminders].sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status))[0];
  const failed = reminders.some(item => item.status === "failed");
  const href = reminders.length > 1 ? `/w/${workspaceId}/sources` : first.previewId ? `/w/${workspaceId}/sources/imports/${first.previewId}` : `/w/${workspaceId}/sources/${first.sourceId}/update`;
  const message = reminders.length > 1 ? `${reminders.length} sources need attention${failed ? " · Import failed" : ""} · Review sources` : first.status === "failed" ? "Import failed · Retry import" : first.status === "pending" ? "Awaiting Apply · Review preview" : "Check for folder updates";
  return <Link className={`kh-interactive-row kh-focus-ring block rounded-md px-3 py-2 text-body-sm ${failed ? "text-kh-warning" : "text-kh-text"}`} href={href}>
    <span className="block font-medium">{message}</span>
    {reminders.length === 1 ? <span className="mt-1 block truncate text-caption text-kh-text-muted">{first.sourceName}</span> : null}
  </Link>;
}

/** What needs the user on Home: unread share comments and source reminders. Renders nothing otherwise. */
export function AttentionList({ workspaceId, reminders, notices }: { workspaceId: string; reminders: readonly FreshnessReminder[]; notices: readonly ShareCommentNotificationView[] }) {
  if (!reminders.length && !notices.length) return null;
  return <section aria-label="Needs attention" className="rounded-md border border-kh-border py-1">
    <div className="flex items-baseline justify-between px-3 pb-1 pt-2">
      <h2 className="text-caption font-medium text-kh-text-muted">Needs attention</h2>
      <Link className="kh-focus-ring rounded-md text-caption text-kh-link" href={`/w/${workspaceId}/updates`}>View all updates</Link>
    </div>
    {notices.length ? <ul aria-label="Unread discussions" className="space-y-0.5">{notices.slice(0, 5).map(notice => (
      <li key={notice.id}>
        <Link className="kh-interactive-row kh-focus-ring flex min-h-10 items-center gap-3 rounded-md px-3 py-1" href={`/w/${notice.workspaceId}/knowledge/${notice.sourceId}/${notice.documentId}?thread=${notice.threadId}`}>
          <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-kh-primary" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-body font-medium text-kh-text">{notice.documentTitle}</span>
            <span className="block truncate text-caption text-kh-text-muted">{notice.authorName ?? "Someone"}: {notice.excerpt}</span>
          </span>
          <span className="shrink-0 text-caption text-kh-text-muted"><Timestamp value={String(notice.createdAt)} variant="relative" /></span>
        </Link>
      </li>
    ))}</ul> : null}
    {reminders.length ? <SourceReminder workspaceId={workspaceId} reminders={reminders} /> : null}
  </section>;
}

/** Fetches unread comments after mount; a failed fetch shows reminders only and never blocks Home. */
export function HomeAttention({ workspaceId, reminders }: { workspaceId: string; reminders: readonly FreshnessReminder[] }) {
  const [notices, setNotices] = useState<ShareCommentNotificationView[]>([]);
  useEffect(() => {
    let live = true;
    reviewRequest<{ notifications: ShareCommentNotificationView[] }>("/api/review-notifications/unread")
      .then(result => { if (live) setNotices(result.notifications); })
      .catch(() => { if (live) setNotices([]); });
    return () => { live = false; };
  }, []);
  return <AttentionList workspaceId={workspaceId} reminders={reminders} notices={notices} />;
}
