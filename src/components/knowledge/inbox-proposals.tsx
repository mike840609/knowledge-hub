"use client";

import { Button } from "@/components/ui/button";
import { Timestamp } from "@/components/ui/timestamp";
import type { ShareCommentNotificationView } from "@/modules/knowledge/domain/share-comment-event";
import { canDecideProposal, notificationLabel, notificationLine, notificationTitle } from "./notification-href";

/**
 * Proposals are notices, not discussions: they have no thread to open and no row in the
 * discussion index. The owner's pending request is the actionable one; the proposed person's
 * and the proposer's notices are unread history until they are read.
 */
export function InboxProposals({
  proposals,
  busy,
  onDecide,
  onMarkRead,
}: {
  proposals: readonly ShareCommentNotificationView[];
  busy: boolean;
  onDecide: (entry: ShareCommentNotificationView, decision: "approve" | "decline") => void;
  onMarkRead: (entry: ShareCommentNotificationView) => void;
}) {
  if (proposals.length === 0) return null;
  return <section aria-label="Proposals" className="space-y-2">
    <h2 className="text-body font-medium text-kh-text">Proposals</h2>
    <ul className="divide-y divide-kh-border">
      {proposals.map(entry => <li key={entry.id} className="flex items-start gap-3 py-2.5">
        <span aria-hidden="true" className={`mt-2 h-2 w-2 shrink-0 rounded-full ${entry.readAt === null ? "bg-kh-primary" : "bg-transparent"}`} />
        <div className="min-w-0 flex-1">
          <p className="block truncate text-body font-medium text-kh-text">{notificationTitle(entry)}</p>
          <p className="mt-0.5 block text-body-sm text-kh-text-muted">{notificationLine(entry)}</p>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-1 text-caption text-kh-text-muted">
            <Timestamp value={String(entry.createdAt)} variant="relative" />
            {notificationLabel(entry) && <><span aria-hidden="true">·</span><span>{notificationLabel(entry)}</span></>}
          </div>
          {canDecideProposal(entry) && <div className="mt-2 flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" disabled={busy} aria-label={`Approve adding ${entry.personName ?? "someone"}`} onClick={() => onDecide(entry, "approve")}>Approve</Button>
            <Button variant="ghost" size="sm" disabled={busy} aria-label={`Decline adding ${entry.personName ?? "someone"}`} onClick={() => onDecide(entry, "decline")}>Decline</Button>
          </div>}
        </div>
        {entry.readAt === null && <Button variant="ghost" size="sm" disabled={busy} onClick={() => onMarkRead(entry)}>Mark read</Button>}
      </li>)}
    </ul>
  </section>;
}
