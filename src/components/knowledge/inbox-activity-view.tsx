"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { CheckCheck, MessageSquareText, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/shell/page-header";
import { useInboxUnread } from "@/components/shell/use-inbox-unread";
import { Button } from "@/components/ui/button";
import { mergeInboxDiscussions, sortInboxDiscussions, type InboxDiscussionView, type InboxKindFilter, type InboxPage, type InboxStatusFilter } from "@/modules/knowledge/domain/inbox-discussion";
import type { ShareCommentNotificationView } from "@/modules/knowledge/domain/share-comment-event";
import { InboxDiscussion } from "./inbox-discussion";
import { InboxDiscussionRow } from "./inbox-discussion-row";
import { InboxFilters } from "./inbox-filters";
import { InboxSharedWithYou } from "./inbox-shared-with-you";
import { NotificationListSkeleton } from "./knowledge-skeletons";
import { reviewRequest } from "./review-thread-list";

type Filters = { kind: InboxKindFilter; status: InboxStatusFilter; unread: boolean };
type Cursor = InboxPage["nextCursor"];

/**
 * The box, not the window, decides: a 25rem list column (22rem of rows and its gutters) beside a document
 * pane of 48rem, the width at which its discussions sit beside the article (`--review-rail`) rather than in
 * a drawer over it — and a rem more, for a classic scrollbar the pane's stable gutter keeps (17px on Windows).
 */
const SPLIT_MIN_PX = 75 * 16;
const ABOUT = "Every discussion on your shared documents, in discussions you follow, and where someone mentioned you. Opening one marks it read; resolving it is a separate action.";

const DEFAULT_FILTERS: Filters = { kind: "all", status: "all", unread: false };

/** The URL is the view's state: defaults are omitted so the default view stays a clean address. */
function writeLocation(filters: Filters, item: string | null) {
  const url = new URL(window.location.href);
  const set = (key: string, value: string | null) => {
    if (value === null) url.searchParams.delete(key);
    else url.searchParams.set(key, value);
  };
  set("kind", filters.kind === "all" ? null : filters.kind);
  set("status", filters.status === "all" ? null : filters.status);
  set("unread", filters.unread ? "1" : null);
  set("item", item);
  window.history.replaceState(window.history.state, "", url);
}

function initialView(): { item: string | null; filters: Filters } {
  if (typeof window === "undefined") return { item: null, filters: DEFAULT_FILTERS };
  const query = new URLSearchParams(window.location.search);
  const kind = query.get("kind");
  const status = query.get("status");
  return {
    item: query.get("item"),
    filters: {
      kind: kind === "owner" || kind === "follow" || kind === "mention" ? kind : "all",
      status: status === "open" || status === "resolved" ? status : "all",
      unread: query.get("unread") === "1",
    },
  };
}

function inboxUrl(filters: Filters, options: { cursor?: Cursor; threadId?: string } = {}): string {
  const query = new URLSearchParams();
  if (filters.kind !== "all") query.set("kind", filters.kind);
  if (filters.status !== "all") query.set("status", filters.status);
  if (filters.unread) query.set("unread", "1");
  if (options.threadId) query.set("threadId", options.threadId);
  if (options.cursor) {
    query.set("beforeLatestAt", options.cursor.latestAt);
    query.set("beforeThreadId", options.cursor.threadId);
  }
  const search = query.toString();
  return "/api/review-notifications/inbox" + (search ? `?${search}` : "");
}

async function lookupDiscussion(threadId: string, filters: Filters): Promise<InboxDiscussionView | null> {
  const result = await reviewRequest<InboxPage>(inboxUrl(filters, { threadId }));
  return withDates(result.discussions).find(discussion => discussion.threadId === threadId) ?? null;
}

/** JSON carries the page's dates as ISO strings; the index sorts and merges on `Date`s. */
const asDate = (value: Date) => value instanceof Date ? value : new Date(value as unknown as string);
const withDates = (items: readonly InboxDiscussionView[]): InboxDiscussionView[] =>
  items.map(item => ({ ...item, latestAt: asDate(item.latestAt), latest: { ...item.latest, createdAt: asDate(item.latest.createdAt) } }));

function useSplit() {
  const ref = useRef<HTMLDivElement>(null);
  const [split, setSplit] = useState(false);
  // Before the first paint, so a wide window never shows the single column first.
  useLayoutEffect(() => {
    const box = ref.current;
    if (!box) return;
    setSplit(box.getBoundingClientRect().width >= SPLIT_MIN_PX);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setSplit(entry.contentRect.width >= SPLIT_MIN_PX));
    observer.observe(box);
    return () => observer.disconnect();
  }, []);
  return { ref, split };
}

const failure = (cause: unknown, fallback: string) => cause instanceof Error ? cause.message : fallback;

export function InboxActivityView({ workspaceId }: { workspaceId: string }) {
  const [initial] = useState(initialView);
  const [kind, setKind] = useState<InboxKindFilter>(initial.filters.kind);
  const [status, setStatus] = useState<InboxStatusFilter>(initial.filters.status);
  const [unread, setUnread] = useState(initial.filters.unread);
  const [discussions, setDiscussions] = useState<InboxDiscussionView[]>([]);
  const [shared, setShared] = useState<ShareCommentNotificationView[]>([]);
  const [next, setNext] = useState<Cursor>(null);
  // Read once, from the URL; the URL follows the view from here on, never the other way round.
  const [selectedId, setSelectedId] = useState<string | null>(initial.item);
  // A selected discussion that is not on the loaded page, fetched for its own pane.
  const [selectedFallback, setSelectedFallback] = useState<InboxDiscussionView | null>(null);
  const [loading, setLoading] = useState(true);
  const [moreLoading, setMoreLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const { ref, split } = useSplit();
  // The rail badge is the only number; the page asks it only to disable `Mark all read`.
  const badge = useInboxUnread(true);

  const filters: Filters = { kind, status, unread };
  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const discussionsRef = useRef(discussions);
  discussionsRef.current = discussions;
  const selectedFallbackRef = useRef(selectedFallback);
  selectedFallbackRef.current = selectedFallback;
  // A deep link is looked up; once a row on the page is selected this is false again.
  const fromLookup = useRef(initial.item !== null);
  const marking = useRef(new Set<string>());
  const busyCount = useRef(0);
  // Bumped by a filter change or Refresh: an older page that started under the previous view is not merged.
  const generation = useRef(0);

  const beginBusy = () => { busyCount.current += 1; setBusy(true); };
  const endBusy = () => { busyCount.current = Math.max(0, busyCount.current - 1); if (busyCount.current === 0) setBusy(false); };

  const clearSelection = useCallback(() => {
    selectedIdRef.current = null;
    fromLookup.current = false;
    setSelectedId(null);
    setSelectedFallback(null);
    writeLocation(filtersRef.current, null);
  }, []);

  const reconcile = useCallback(async (items: InboxDiscussionView[], current: Filters, live: () => boolean) => {
    const id = selectedIdRef.current;
    if (!id) { setSelectedFallback(null); return; }
    if (items.some(discussion => discussion.threadId === id)) {
      fromLookup.current = false;
      setSelectedFallback(null);
      return;
    }
    // A page selection the filters exclude is dropped; a deep link is asked again under them.
    if (!fromLookup.current) { clearSelection(); return; }
    try {
      const found = await lookupDiscussion(id, current);
      if (!live()) return;
      if (found) setSelectedFallback(found);
      else clearSelection();
    } catch (cause) {
      if (!live()) return;
      setError(failure(cause, "Could not load the selected discussion."));
      clearSelection();
    }
  }, [clearSelection]);

  // The first page follows the filters; a filter change resets the cursor by starting here again.
  useEffect(() => {
    let live = true;
    const current: Filters = { kind, status, unread };
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const result = await reviewRequest<InboxPage>(inboxUrl(current));
        if (!live) return;
        const first = withDates(result.discussions);
        setDiscussions(first);
        setShared(result.shared);
        setNext(result.nextCursor);
        await reconcile(first, current, () => live);
      } catch (cause) {
        if (live) setError(failure(cause, "Could not load discussions."));
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => { live = false; };
  }, [kind, status, unread, reload, reconcile]);

  const applyFilters = (change: Partial<Filters>) => {
    const current = filtersRef.current;
    const nextFilters: Filters = { ...current, ...change };
    if (nextFilters.kind !== current.kind || nextFilters.status !== current.status || nextFilters.unread !== current.unread) {
      generation.current += 1;
    }
    filtersRef.current = nextFilters;
    setKind(nextFilters.kind);
    setStatus(nextFilters.status);
    setUnread(nextFilters.unread);
    // Keep the selection in the URL until the first page says whether it still belongs.
    writeLocation(nextFilters, selectedIdRef.current);
  };

  const refresh = () => { generation.current += 1; setReload(value => value + 1); };

  const markThread = useCallback(async (discussion: InboxDiscussionView) => {
    if (discussion.unreadCount === 0 || marking.current.has(discussion.threadId)) return;
    marking.current.add(discussion.threadId);
    beginBusy();
    setError(null);
    try {
      await reviewRequest("/api/review-notifications/inbox", { action: "mark-thread-read", threadId: discussion.threadId });
      // Under Unread a row the mark settles no longer matches the filter: it leaves the list at once,
      // unless it is the selected row, which the reader is still looking at.
      setDiscussions(previous => previous
        .filter(item => !(item.threadId === discussion.threadId && filtersRef.current.unread && discussion.threadId !== selectedIdRef.current))
        .map(item => item.threadId === discussion.threadId ? { ...item, unreadCount: 0 } : item));
      setSelectedFallback(previous => previous && previous.threadId === discussion.threadId ? { ...previous, unreadCount: 0 } : previous);
      window.dispatchEvent(new Event("kh:notification-changed"));
    } catch (cause) {
      // A failed mark leaves the row unread, and choosing it again asks again.
      setError(failure(cause, "Could not mark the discussion as read."));
    } finally {
      marking.current.delete(discussion.threadId);
      endBusy();
    }
  }, []);

  const select = (discussion: InboxDiscussionView) => {
    selectedIdRef.current = discussion.threadId;
    fromLookup.current = false;
    setSelectedId(discussion.threadId);
    setSelectedFallback(null);
    writeLocation(filtersRef.current, discussion.threadId);
    if (discussion.unreadCount > 0) void markThread(discussion);
  };

  // A write in the pane settles the row it is about: the one discussion is read unfiltered, replaced
  // in place (and in the fallback) and the list re-sorted, so the row stays even when the write makes
  // it stop matching the active filter. The owner's and a mention's view of one thread merge to one row.
  // An owner thread the server no longer returns has been hidden or retracted with its last visible
  // comment: the row goes, and with it the pane if that row was open. A followed or mentioned thread
  // may instead have lost its link, so its row stays and the pane's placeholder answers.
  const refreshOne = useCallback(async (threadId: string) => {
    try {
      const result = await reviewRequest<InboxPage>(inboxUrl(DEFAULT_FILTERS, { threadId }));
      const found = withDates(result.discussions).find(discussion => discussion.threadId === threadId);
      if (found) {
        setDiscussions(previous => mergeInboxDiscussions(previous.map(item => item.threadId === threadId ? found : item)));
        setSelectedFallback(previous => previous && previous.threadId === threadId ? found : previous);
        window.dispatchEvent(new Event("kh:notification-changed"));
        return;
      }
      const known = discussionsRef.current.find(item => item.threadId === threadId)
        ?? (selectedFallbackRef.current?.threadId === threadId ? selectedFallbackRef.current : undefined);
      if (!known || known.kind !== "OWNER") return;
      setDiscussions(previous => previous.filter(item => item.threadId !== threadId));
      if (selectedIdRef.current === threadId) clearSelection();
      window.dispatchEvent(new Event("kh:notification-changed"));
    } catch {
      // The write succeeded; a failed read of its row leaves the row as it was.
    }
  }, [clearSelection]);

  const loadOlder = async () => {
    if (!next || moreLoading) return;
    const started = generation.current;
    setMoreLoading(true);
    setError(null);
    try {
      const result = await reviewRequest<InboxPage>(inboxUrl(filtersRef.current, { cursor: next }));
      // The view moved on while this page was in flight: it belongs to a list that no longer exists.
      if (generation.current !== started) return;
      // A thread can reach the first page through a mention and the older page through its owner:
      // merge by thread (the owner's view wins) before sorting the whole list again.
      setDiscussions(previous => sortInboxDiscussions(mergeInboxDiscussions([...previous, ...withDates(result.discussions)])));
      setNext(result.nextCursor);
    } catch (cause) {
      if (generation.current === started) setError(failure(cause, "Could not load older discussions."));
    } finally {
      setMoreLoading(false);
    }
  };

  const markAll = async () => {
    if (busy || badge === 0) return;
    beginBusy();
    setError(null);
    try {
      await reviewRequest("/api/review-notifications/inbox", { action: "mark-all-read" });
      // Under Unread every row the mark settles stops matching the filter; the selected row stays as
      // the reader's place.
      setDiscussions(previous => previous
        .filter(item => !filtersRef.current.unread || item.threadId === selectedIdRef.current)
        .map(item => ({ ...item, unreadCount: 0 })));
      setSelectedFallback(previous => previous ? { ...previous, unreadCount: 0 } : previous);
      setShared([]);
      window.dispatchEvent(new Event("kh:notification-changed"));
    } catch (cause) {
      setError(failure(cause, "Could not mark discussions as read."));
    } finally {
      endBusy();
    }
  };

  const markShared = async (entry: ShareCommentNotificationView) => {
    if (busy) return;
    beginBusy();
    setError(null);
    try {
      await reviewRequest("/api/review-notifications/inbox", { action: "mark-read", eventId: entry.id });
      setShared(previous => previous.filter(item => item.id !== entry.id));
      window.dispatchEvent(new Event("kh:notification-changed"));
    } catch (cause) {
      setError(failure(cause, "Could not mark the share as read."));
    } finally {
      endBusy();
    }
  };

  // ↑/↓ move inside the discussion list; shared rows have no pane to show and are not in it.
  const step = (event: KeyboardEvent<HTMLUListElement>) => {
    if (!split || (event.key !== "ArrowDown" && event.key !== "ArrowUp")) return;
    event.preventDefault();
    const at = discussions.findIndex(discussion => discussion.threadId === selectedId);
    const target = discussions[at === -1 ? 0 : Math.min(discussions.length - 1, Math.max(0, at + (event.key === "ArrowDown" ? 1 : -1)))];
    if (!target) return;
    if (target.threadId !== selectedId) select(target);
    event.currentTarget.querySelector<HTMLElement>(`[data-inbox-entry="${target.threadId}"]`)?.focus();
  };

  const selectedDiscussion = discussions.find(discussion => discussion.threadId === selectedId)
    ?? (selectedFallback && selectedFallback.threadId === selectedId ? selectedFallback : undefined);
  // In the split layout, opening a discussion marks it read, whether a row was chosen or a deep link opened
  // it in the pane; the narrow list has no pane and marks nothing. `markThread` guards the id, so the select
  // path and this effect never post twice for one thread.
  useEffect(() => {
    if (split && selectedDiscussion && selectedDiscussion.unreadCount > 0) void markThread(selectedDiscussion);
  }, [split, selectedDiscussion, markThread]);
  const selected = split ? selectedDiscussion : undefined;
  const defaultView = kind === "all" && status === "all" && !unread;
  const filtered = kind !== "all" || status !== "all" || unread;
  const unreadOnly = unread && kind === "all" && status === "all";
  const empty = unreadOnly
    ? { title: "No unread discussions.", detail: "Clear the Unread filter to see everything." }
    : filtered
      ? { title: "No discussions match these filters.", detail: null }
      : { title: "No discussions yet.", detail: "Comments on your shared documents, replies in discussions you follow, and mentions will appear here." };

  const header = <PageHeader location="My Space" locationHref={`/w/${workspaceId}/home`} title="Inbox" actions={
    <div className="flex items-center gap-2">
      <Button variant="ghost" icon aria-label="Refresh discussions" onClick={refresh} disabled={loading || busy}><RefreshCw size={16} /></Button>
      <Button variant="secondary" onClick={() => void markAll()} disabled={busy || badge === 0}><CheckCheck size={16} />Mark all read</Button>
    </div>
  } />;
  const errorLine = error && <p role="alert" className="text-body-sm text-kh-danger">{error}</p>;
  const list = <>
    <InboxFilters kind={kind} status={status} unread={unread} sticky={split}
      onKindChange={value => applyFilters({ kind: value })}
      onStatusChange={value => applyFilters({ status: value })}
      onUnreadChange={value => applyFilters({ unread: value })} />
    {defaultView && <InboxSharedWithYou workspaceId={workspaceId} shared={shared} busy={busy} onMarkRead={entry => void markShared(entry)} />}
    {loading ? <NotificationListSkeleton /> : discussions.length === 0 ? (
      <div className="py-12 text-center text-kh-text-muted">
        <MessageSquareText size={24} className="mx-auto mb-3" aria-hidden="true" />
        <p className="text-body font-medium">{empty.title}</p>
        {empty.detail && <p className="mt-1 text-body-sm">{empty.detail}</p>}
        {filtered && !unreadOnly && <div className="mt-3 flex justify-center"><Button variant="link" onClick={() => applyFilters(DEFAULT_FILTERS)}>Clear filters</Button></div>}
      </div>
    ) : <ul aria-label="Inbox discussions" className="divide-y divide-kh-border" onKeyDown={step}>
      {discussions.map(discussion => <InboxDiscussionRow
        key={discussion.threadId}
        discussion={discussion}
        selected={selected?.threadId === discussion.threadId}
        split={split}
        busy={busy}
        onSelect={select}
        onMarkRead={item => void markThread(item)}
      />)}
    </ul>}
    {next && !loading && <div className="flex justify-center">
      <Button variant="secondary" disabled={moreLoading} onClick={() => void loadOlder()}>{moreLoading ? "Loading…" : "Load older discussions"}</Button>
    </div>}
  </>;

  // The wrapper is measured; it is the same box in both layouts.
  return <div ref={ref} className="w-full">{!split ? <main className="kh-page space-y-5 pb-6">
    {header}
    <p className="text-body-sm text-kh-text-muted">{ABOUT}</p>
    {errorLine}
    {list}
  </main>
  // Both columns are the window's height and scroll on their own; each opens on a 48px line, as the rail,
  // the explorer and a document do, so the Inbox's header and the document's title share one top edge.
  : <main className="grid h-dvh w-full grid-cols-[25rem_minmax(0,1fr)]">
    <div className="flex min-h-0 flex-col border-r border-kh-border">
      <div className="space-y-2 px-6">{header}{errorLine}</div>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 pb-6">{list}</div>
    </div>
    <div className="min-h-0 min-w-0">
      {selected ? <InboxDiscussion key={selected.threadId} entry={selected} onChanged={refreshOne} />
        : loading && selectedId ? <p role="status" className="px-6 py-4 text-body-sm text-kh-text-muted">Loading…</p>
        : <div className="px-6 py-16 text-center text-kh-text-muted">
          <MessageSquareText size={24} className="mx-auto mb-3" aria-hidden="true" />
          <p className="text-body font-medium">Select a discussion</p>
          <p className="mx-auto mt-1 max-w-measure text-body-sm">{ABOUT}</p>
        </div>}
    </div>
  </main>}</div>;
}
