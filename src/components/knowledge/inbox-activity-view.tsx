"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCheck, MessageSquareText, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Timestamp } from "@/components/ui/timestamp";
import { TabsList, TabsPanel, TabsRoot, TabsTab } from "@/components/ui/tabs";
import { reviewRequest } from "./review-thread-list";
import type { ShareCommentNotificationView } from "@/modules/knowledge/domain/share-comment-event";
import { notificationHref, notificationLine, notificationTitle } from "./notification-href";
import { NotificationListSkeleton } from "./knowledge-skeletons";
import { InboxDiscussion } from "./inbox-discussion";

type Cursor = { createdAt: string; id: string };
type ActivityResponse = { notifications: ShareCommentNotificationView[]; nextCursor: Cursor | null };
type View = "inbox" | "activity";

/**
 * The box, not the window, decides: a 25rem list column (22rem of rows and its gutters) beside a document
 * pane of 48rem, the width at which its discussions sit beside the article (`--review-rail`) rather than in
 * a drawer over it. Measured on the border box, which the two layouts' different padding does not change.
 */
const SPLIT_MIN_PX = 74 * 16;
const ABOUT = "Comments on your shared documents, and replies in discussions you follow on pages shared with you. Opening a discussion marks it read; resolving it is a separate action.";

function useSplit() {
  const ref = useRef<HTMLElement>(null);
  const [split, setSplit] = useState(false);
  useEffect(() => {
    const box = ref.current;
    if (!box || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setSplit((entry.borderBoxSize?.[0]?.inlineSize ?? entry.contentRect.width) >= SPLIT_MIN_PX));
    observer.observe(box);
    return () => observer.disconnect();
  }, []);
  return { ref, split };
}

export function InboxActivityView({ workspaceId }: { workspaceId: string }) {
  const [items, setItems] = useState<ShareCommentNotificationView[]>([]);
  const [next, setNext] = useState<Cursor | null>(null);
  const [view, setView] = useState<View>("inbox");
  const [loading, setLoading] = useState(true);
  const [moreLoading, setMoreLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { ref, split } = useSplit();
  const deepLink = useSearchParams().get("item");
  const [selectedId, setSelectedId] = useState<string | null>(deepLink);

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

  // A dead link's entry needs nothing from anyone: it is history, not attention.
  const attention = useMemo(() => items.filter(item => item.readAt === null || (item.threadStatus === "OPEN" && item.linkAvailable !== false)), [items]);
  const shown = view === "inbox" ? attention : items;
  const unread = items.filter(item => item.readAt === null).length;

  const mark = useCallback(async (eventId?: string) => {
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
  }, []);

  const selected = split ? items.find(item => item.id === selectedId) : undefined;
  // Looking at an entry is reading it, as opening it always was; nothing is selected unasked (spec).
  const unreadSelection = selected?.readAt === null ? selected.id : null;
  useEffect(() => { if (unreadSelection) void mark(unreadSelection); }, [unreadSelection, mark]);
  const select = (item: ShareCommentNotificationView) => {
    setSelectedId(item.id);
    const url = new URL(window.location.href);
    url.searchParams.set("item", item.id);
    window.history.replaceState(window.history.state, "", url);
  };
  const openRow = (item: ShareCommentNotificationView) => (event: MouseEvent) => {
    // A modified click still opens the document in a new tab.
    if (!split || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    select(item);
  };
  const step = (event: KeyboardEvent<HTMLUListElement>) => {
    if (!split || (event.key !== "ArrowDown" && event.key !== "ArrowUp")) return;
    event.preventDefault();
    const at = shown.findIndex(item => item.id === selectedId);
    const next = shown[at === -1 ? 0 : Math.min(shown.length - 1, Math.max(0, at + (event.key === "ArrowDown" ? 1 : -1)))];
    if (!next) return;
    if (next.id !== selectedId) select(next);
    event.currentTarget.querySelector<HTMLElement>(`[data-inbox-entry="${next.id}"]`)?.focus();
  };

  const header = <PageHeader location="My Space" locationHref={`/w/${workspaceId}/home`} title="Inbox" actions={
    <div className="flex items-center gap-2">
      <Button variant="ghost" icon aria-label="Refresh activity" onClick={() => void refresh()} disabled={loading || busy}><RefreshCw size={16} /></Button>
      <Button variant="secondary" onClick={() => void mark()} disabled={busy || unread === 0}><CheckCheck size={16} />Mark all read</Button>
    </div>
  } />;
  const errorLine = error && <p role="alert" className="text-body-sm text-kh-danger">{error}</p>;
  const list = <>
    <TabsRoot value={view} onValueChange={value => setView(value as View)}>
      <TabsList aria-label="Activity filters" className={split ? "sticky top-0 z-10 bg-kh-bg" : ""}>
        <TabsTab value="inbox">Inbox{attention.length ? ` · ${attention.length}` : ""}</TabsTab>
        <TabsTab value="activity">All activity</TabsTab>
      </TabsList>
      {(["inbox", "activity"] as const).map(tab => <TabsPanel key={tab} value={tab}>
        {loading ? <NotificationListSkeleton /> : shown.length === 0 ? (
          <div className="py-12 text-center text-kh-text-muted">
            <MessageSquareText size={24} className="mx-auto mb-3" aria-hidden="true" />
            <p className="text-body font-medium">{tab === "inbox" ? "You're all caught up" : "No share comments yet"}</p>
            <p className="mt-1 text-body-sm">{tab === "inbox" ? "New and open discussions will appear here." : "When someone comments on your shared article, its activity appears here."}</p>
          </div>
        ) : <ul aria-label={tab === "inbox" ? "Inbox discussions" : "Activity history"} className="divide-y divide-kh-border" onKeyDown={step}>
          {shown.map(item => { const href = notificationHref(item); const content = <>
              <span className="block truncate text-body font-medium">{notificationTitle(item)}</span>
              <span className="mt-1 block text-body-sm text-kh-text-muted">{notificationLine(item)}</span>
              <span className="mt-1 flex flex-wrap items-center gap-2 text-caption text-kh-text-muted">
                <Timestamp value={String(item.createdAt)} variant="relative" />
                {item.readAt === null ? <span className="font-medium text-kh-text">Unread</span> : <span>Read</span>}
                <span>{item.kind === "FOLLOW" ? "Discussion you follow" : item.threadStatus === "OPEN" ? "Open discussion" : "Resolved"}</span>
              </span>
            </>;
            const current = selected?.id === item.id;
            const row = `kh-focus-ring min-w-0 flex-1 rounded-md px-1 py-1 text-left ${current ? "" : "hover:bg-kh-bg-hover"}`;
            // Selected, the whole row is marked, dot and all, so its edges line up with every other row.
            return <li key={item.id} className={`flex items-start gap-3 py-3 ${current ? "-mx-2 rounded-md bg-kh-bg-selected px-2" : ""}`}>
            <span aria-hidden="true" className={`mt-2 h-2 w-2 shrink-0 rounded-full ${item.readAt === null ? "bg-kh-primary" : "bg-transparent"}`} />
            {href
              ? <Link className={row} href={href} prefetch={item.kind === "FOLLOW" ? false : undefined} data-inbox-entry={item.id} aria-current={current ? "true" : undefined} onClick={openRow(item)}>{content}</Link>
              : split ? <button type="button" className={row} data-inbox-entry={item.id} aria-current={current ? "true" : undefined} onClick={() => select(item)}>{content}</button>
              : <div className="min-w-0 flex-1 px-1 py-1">{content}</div>}
            {item.readAt === null && <Button variant="ghost" size="sm" disabled={busy} onClick={() => void mark(item.id)}>Mark read</Button>}
          </li>; })}
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
  </>;

  if (!split) return <main ref={ref} className="w-full space-y-5 px-6 pb-6">
    {header}
    <p className="text-body-sm text-kh-text-muted">{ABOUT}</p>
    {errorLine}
    {list}
  </main>;
  // Both columns are the window's height and scroll on their own; each opens on a 48px line, as the rail,
  // the explorer and a document do, so the Inbox's header and the document's title share one top edge.
  return <main ref={ref} className="grid h-dvh w-full grid-cols-[25rem_minmax(0,1fr)]">
    <div className="flex min-h-0 flex-col border-r border-kh-border">
      <div className="space-y-2 px-6">{header}{errorLine}</div>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 pb-6">{list}</div>
    </div>
    <div className="min-h-0 min-w-0">
      {selected ? <InboxDiscussion key={selected.id} entry={selected} />
        : <div className="px-6 py-16 text-center text-kh-text-muted">
          <MessageSquareText size={24} className="mx-auto mb-3" aria-hidden="true" />
          <p className="text-body font-medium">Select a discussion</p>
          <p className="mx-auto mt-1 max-w-measure text-body-sm">{ABOUT}</p>
        </div>}
    </div>
  </main>;
}
