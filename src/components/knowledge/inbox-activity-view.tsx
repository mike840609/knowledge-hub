"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCheck, MessageSquareText, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Timestamp } from "@/components/ui/timestamp";
import { TabsList, TabsPanel, TabsRoot, TabsTab } from "@/components/ui/tabs";
import { reviewRequest } from "./review-thread-list";
import type { ShareCommentNotificationView } from "@/modules/knowledge/domain/share-comment-event";

type Cursor = { createdAt: string; id: string };
type ActivityResponse = { notifications: ShareCommentNotificationView[]; nextCursor: Cursor | null };
type View = "inbox" | "activity";

export function InboxActivityView({ workspaceId }: { workspaceId: string }) {
  const [items, setItems] = useState<ShareCommentNotificationView[]>([]);
  const [next, setNext] = useState<Cursor | null>(null);
  const [view, setView] = useState<View>("inbox");
  const [loading, setLoading] = useState(true);
  const [moreLoading, setMoreLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (cursor?: Cursor) => {
    const search = cursor ? "?beforeCreatedAt=" + encodeURIComponent(cursor.createdAt) + "&beforeId=" + encodeURIComponent(cursor.id) : "";
    const result = await reviewRequest<ActivityResponse>("/api/review-notifications/activity" + search);
    setItems(previous => cursor ? [...previous, ...result.notifications] : result.notifications);
    setNext(result.nextCursor);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try { await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load activity."); }
    finally { setLoading(false); }
  }, [load]);

  useEffect(() => { void refresh(); }, [refresh]);

  const attention = useMemo(() => items.filter(item => item.readAt === null || item.threadStatus === "OPEN"), [items]);
  const shown = view === "inbox" ? attention : items;
  const unread = items.filter(item => item.readAt === null).length;

  const mark = async (eventId?: string) => {
    setBusy(true);
    setError(null);
    try {
      await reviewRequest("/api/review-notifications/activity", eventId
        ? { action: "mark-read", eventId }
        : { action: "mark-all-read" });
      const now = new Date();
      setItems(previous => previous.map(item => !item.readAt && (!eventId || item.id === eventId) ? { ...item, readAt: now } : item));
      window.dispatchEvent(new Event("kh:notification-changed"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not mark activity as read.");
    } finally { setBusy(false); }
  };

  return <main className="kh-page space-y-5 pb-6">
    <PageHeader location="My Space" locationHref={`/w/${workspaceId}/home`} title="Inbox" actions={
      <div className="flex items-center gap-2">
        <Button variant="ghost" icon aria-label="Refresh activity" onClick={() => void refresh()} disabled={loading || busy}><RefreshCw size={16} /></Button>
        <Button variant="secondary" onClick={() => void mark()} disabled={busy || unread === 0}><CheckCheck size={16} />Mark all read</Button>
      </div>
    } />
    <p className="text-body-sm text-kh-text-muted">Comments on your shared documents, across your personal knowledge. Opening a discussion marks that document read; resolving it is a separate action.</p>
    {error && <p role="alert" className="text-body-sm text-kh-danger">{error}</p>}
    <TabsRoot value={view} onValueChange={value => setView(value as View)}>
      <TabsList aria-label="Activity filters">
        <TabsTab value="inbox">Inbox{attention.length ? ` · ${attention.length}` : ""}</TabsTab>
        <TabsTab value="activity">All activity</TabsTab>
      </TabsList>
      {(["inbox", "activity"] as const).map(tab => <TabsPanel key={tab} value={tab}>
        {loading ? <p role="status" className="py-8 text-body text-kh-text-muted">Loading comments…</p> : shown.length === 0 ? (
          <div className="py-12 text-center text-kh-text-muted">
            <MessageSquareText size={24} className="mx-auto mb-3" aria-hidden="true" />
            <p className="text-body font-medium">{tab === "inbox" ? "You're all caught up" : "No share comments yet"}</p>
            <p className="mt-1 text-body-sm">{tab === "inbox" ? "New and open discussions will appear here." : "When someone comments on your shared article, its activity appears here."}</p>
          </div>
        ) : <ul aria-label={tab === "inbox" ? "Inbox discussions" : "Activity history"} className="divide-y divide-kh-border">
          {shown.map(item => <li key={item.id} className="flex items-start gap-3 py-3">
            <span aria-hidden="true" className={`mt-2 h-2 w-2 shrink-0 rounded-full ${item.readAt === null ? "bg-kh-primary" : "bg-transparent"}`} />
            <Link className="kh-focus-ring min-w-0 flex-1 rounded-md px-1 py-1 hover:bg-kh-bg-hover" href={`/w/${item.workspaceId}/knowledge/${item.sourceId}/${item.documentId}?thread=${item.threadId}`}>
              <span className="block truncate text-body font-medium">{item.documentTitle}</span>
              <span className="mt-1 block text-body-sm text-kh-text-muted">{item.authorName ?? "Someone"}: {item.excerpt}</span>
              <span className="mt-1 flex flex-wrap items-center gap-2 text-caption text-kh-text-muted">
                <Timestamp value={String(item.createdAt)} variant="relative" />
                {item.readAt === null ? <span className="font-medium text-kh-text">Unread</span> : <span>Read</span>}
                <span>{item.threadStatus === "OPEN" ? "Open discussion" : "Resolved"}</span>
              </span>
            </Link>
            {item.readAt === null && <Button variant="ghost" size="sm" disabled={busy} onClick={() => void mark(item.id)}>Mark read</Button>}
          </li>)}
        </ul>}
      </TabsPanel>)}
    </TabsRoot>
    {next && !loading && <div className="flex justify-center">
      <Button variant="secondary" disabled={moreLoading} onClick={async () => {
        setMoreLoading(true); setError(null);
        try { await load(next); }
        catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load older activity."); }
        finally { setMoreLoading(false); }
      }}>{moreLoading ? "Loading…" : "Load older activity"}</Button>
    </div>}
  </main>;
}
