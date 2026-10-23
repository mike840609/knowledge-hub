"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MessagesSquare } from "lucide-react";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SelectMenu } from "@/components/ui/select-menu";
import { Timestamp } from "@/components/ui/timestamp";
import { EmptyState } from "@/components/ui/empty-state";
import { SharesNavigation } from "./shares-navigation";
import { navigateListRows } from "@/lib/list-row-navigation";
import type { DiscussionFilter, FollowedDiscussionView } from "@/modules/knowledge/domain/review-follow";

export function FollowedDiscussionsView({ workspaceId, items, filter, unread, filterError }: { workspaceId: string; items: FollowedDiscussionView[]; filter: DiscussionFilter; unread: number; filterError?: string }) {
  const router = useRouter(), pending = useRef(false);
  const [status, setStatus] = useState<string>(filter);
  useEffect(() => setStatus(filter), [filter]);
  const [busy, setBusy] = useState<string | null>(null), [error, setError] = useState(""), [removed, setRemoved] = useState(new Set<string>());
  // Optimistic removals belong to this server snapshot; a refresh may bring back a re-followed discussion.
  useEffect(() => setRemoved(new Set()), [items]);
  const shown = items.filter(item => !removed.has(item.threadId));
  async function drop(item: FollowedDiscussionView) {
    if (pending.current) return;
    pending.current = true; setBusy(item.threadId); setError("");
    try {
      const response = item.linkAvailable
        ? await fetch(`/api/share-review/threads/${item.threadId}/follow`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: item.token, following: false }) })
        : await fetch(`/api/review-follows/${item.threadId}/unfollow`, { method: "POST" });
      if (!response.ok) throw new Error();
      setRemoved(current => new Set([...current, item.threadId])); router.refresh();
    } catch { setError("Could not update this discussion. Try again."); }
    finally { pending.current = false; setBusy(null); }
  }
  return <main className="kh-page pb-6">
    <PageHeader location="My Space" locationHref={`/w/${workspaceId}/home`} title="Shares" description="Discussions you follow on shared articles. Following never extends a link's access."/>
    <SharesNavigation workspaceId={workspaceId} active="discussions" discussionsUnread={unread}/>
    <form action={`/w/${workspaceId}/shares`} method="get" aria-label="Filter discussions" className="mt-4 flex flex-wrap items-center gap-2">
      <Input type="hidden" name="tab" value="discussions"/>
      <label className="sr-only" htmlFor="discussions-status">Discussion status</label>
      <SelectMenu id="discussions-status" name="status" value={status} onValueChange={setStatus} options={[{ value: "all", label: "All" }, { value: "unread", label: "Unread" }]}/>
      <Button type="submit" variant="secondary">Filter</Button>
    </form>
    {(error || filterError) && <p role="alert" className="mt-3 text-body-sm text-kh-danger">{filterError || error}</p>}
    {!filterError && shown.length === 0 && <EmptyState icon={MessagesSquare} title={filter === "unread" ? "No unread discussions." : "No discussions yet."} description="Discussions you comment on through a shared link appear here."/>}
    <ul aria-label="Followed discussions" onKeyDown={navigateListRows} className="mt-4 space-y-2 md:space-y-0">{shown.map(item => <li key={item.threadId} data-thread-id={item.threadId} className="rounded-md border border-kh-border bg-kh-bg p-3 hover:bg-kh-bg-hover focus-within:bg-kh-bg-hover md:rounded-none md:border-x-0 md:border-t-0 md:py-2">
      {item.linkAvailable
        ? <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
            <Link prefetch={false} data-list-row className="kh-focus-ring min-w-0 rounded-md" href={`/s/${item.token}?thread=${item.threadId}`}>
              <span className="flex items-center gap-2">{item.unread > 0 && <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-kh-primary"/>}<span className="truncate text-body font-medium text-kh-text">{item.documentTitle || "Untitled"}</span></span>
              <span className="block truncate text-caption text-kh-text-muted">{item.authorName ?? "Someone"}: {item.excerpt}</span>
              <span className="block text-caption text-kh-text-muted">{item.threadStatus === "OPEN" ? "Open" : "Resolved"} · <Timestamp value={item.latestAt}/>{item.unread > 0 && <> · {item.unread} new {item.unread === 1 ? "reply" : "replies"}</>}</span>
            </Link>
            <Button variant="ghost" size="sm" aria-label={`Unfollow: ${item.documentTitle || "Untitled"}`} disabled={busy !== null} onClick={() => void drop(item)}>Unfollow</Button>
          </div>
        : <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
            <span className="text-body text-kh-text-muted">A shared discussion — this link is no longer available</span>
            <Button variant="ghost" size="sm" aria-label="Remove discussion" disabled={busy !== null} onClick={() => void drop(item)}>Remove</Button>
          </div>}
    </li>)}</ul>
  </main>;
}
