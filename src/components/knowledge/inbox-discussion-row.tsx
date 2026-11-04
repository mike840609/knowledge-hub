"use client";

import Link from "next/link";
import type { MouseEvent } from "react";
import { Button } from "@/components/ui/button";
import { Timestamp } from "@/components/ui/timestamp";
import type { InboxDiscussionView } from "@/modules/knowledge/domain/inbox-discussion";

/**
 * One row per discussion, never per notice. The row is a link to its document
 * or shared page; in the split layout a plain click selects it in the pane
 * instead of navigating, while a modified click keeps the browser's behaviour.
 */
export function InboxDiscussionRow({
  discussion,
  selected,
  split,
  busy,
  onSelect,
  onMarkRead,
}: {
  discussion: InboxDiscussionView;
  selected: boolean;
  split: boolean;
  busy: boolean;
  onSelect: (discussion: InboxDiscussionView) => void;
  onMarkRead: (discussion: InboxDiscussionView) => void;
}) {
  const unread = discussion.unreadCount > 0;
  const relationship = discussion.mentioned ? "Mentioned you" : discussion.following ? "Following" : "Your document";
  const comments = `${discussion.commentCount} comment${discussion.commentCount === 1 ? "" : "s"}`;
  const said = `${discussion.latest.authorName ?? "Someone"}: ${discussion.latest.excerpt}`;
  const open = (event: MouseEvent<HTMLAnchorElement>) => {
    // A modified click still opens the document in a new tab.
    if (!split || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    onSelect(discussion);
  };
  return <li className={`flex items-start gap-3 py-3 ${selected ? "-mx-2 rounded-md bg-kh-bg-selected px-2" : ""}`}>
    <span aria-hidden="true" className={`mt-2 h-2 w-2 shrink-0 rounded-full ${unread ? "bg-kh-primary" : "bg-transparent"}`} />
    <Link
      className="kh-focus-ring min-w-0 flex-1 rounded-md px-1 py-1 text-left hover:bg-kh-bg-hover"
      href={discussion.href}
      prefetch={discussion.kind === "OWNER" ? undefined : false}
      data-inbox-entry={discussion.threadId}
      aria-current={selected ? "true" : undefined}
      onClick={open}
    >
      <span className={`block truncate text-body ${unread ? "font-medium" : ""}`}>{discussion.documentTitle || "Untitled"}</span>
      {discussion.quote && <span className="mt-1 block truncate text-caption text-kh-text-muted">{discussion.quote}</span>}
      <span className="mt-1 block truncate text-body-sm text-kh-text-muted">{said}</span>
      <span className="mt-1 flex flex-wrap items-center gap-x-1 text-caption text-kh-text-muted">
        <Timestamp value={discussion.latestAt} variant="relative" />
        <span aria-hidden="true">·</span>
        <span>{comments}</span>
        <span aria-hidden="true">·</span>
        <span>{discussion.status === "OPEN" ? "Open" : "Resolved"}</span>
        <span aria-hidden="true">·</span>
        <span>{relationship}</span>
        {discussion.unreadCount > 1 && <>
          <span aria-hidden="true">·</span>
          <span>{discussion.unreadCount} unread</span>
        </>}
      </span>
    </Link>
    {unread && <Button variant="ghost" size="sm" disabled={busy} aria-label={`Mark read: ${discussion.documentTitle || "Untitled"}`} onClick={() => onMarkRead(discussion)}>Mark read</Button>}
  </li>;
}
