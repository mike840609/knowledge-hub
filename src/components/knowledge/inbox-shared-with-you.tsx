"use client";

import Link from "next/link";
import { Button, buttonClasses } from "@/components/ui/button";
import { Timestamp } from "@/components/ui/timestamp";
import type { ShareCommentNotificationView } from "@/modules/knowledge/domain/share-comment-event";
import { notificationHref, notificationLine, notificationTitle } from "./notification-href";

/**
 * Named shares are documents, not discussions: they stay out of the index and
 * out of the relationship tabs. Only the unread ones appear here, above the
 * list, and each opens the Hub reader that marks it read.
 */
export function InboxSharedWithYou({
  workspaceId,
  shared,
  busy,
  onMarkRead,
}: {
  workspaceId: string;
  shared: ShareCommentNotificationView[];
  busy: boolean;
  onMarkRead: (entry: ShareCommentNotificationView) => void;
}) {
  if (shared.length === 0) return null;
  return <section aria-label="Shared with you" className="space-y-2 border-b border-kh-border pb-4">
    <h2 className="text-body font-medium text-kh-text">Shared with you</h2>
    <p className="text-body-sm text-kh-text-muted">Documents, folders and sources shared with you by name. They also live in Shares.</p>
    <ul className="divide-y divide-kh-border">
      {shared.map(entry => {
        const href = notificationHref(entry);
        const content = <>
          <span className="block truncate text-body font-medium">{notificationTitle(entry)}</span>
          <span className="mt-1 block text-body-sm text-kh-text-muted">{notificationLine(entry)}</span>
          <span className="mt-1 flex flex-wrap items-center gap-x-1 text-caption text-kh-text-muted">
            <Timestamp value={entry.createdAt} variant="relative" />
          </span>
        </>;
        return <li key={entry.id} className="flex items-start gap-3 py-3">
          {href
            ? <Link className="kh-focus-ring min-w-0 flex-1 rounded-md px-1 py-1 text-left hover:bg-kh-bg-hover" href={href} prefetch={false} data-inbox-entry={entry.id}>{content}</Link>
            : <div className="min-w-0 flex-1 px-1 py-1">{content}</div>}
          <Button variant="ghost" size="sm" disabled={busy} aria-label={`Mark read: ${notificationTitle(entry)}`} onClick={() => onMarkRead(entry)}>Mark read</Button>
        </li>;
      })}
    </ul>
    <div className="flex justify-end">
      <Link className={buttonClasses({ variant: "link", size: "sm" })} href={`/w/${workspaceId}/shares?tab=saved`}>See all in Shares</Link>
    </div>
  </section>;
}
