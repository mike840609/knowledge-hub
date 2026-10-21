"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { ReviewThreadView } from "@/modules/knowledge/domain/document-review";
import { useReviewHighlights } from "./review-highlights";
import { LogIn, RefreshCw, MessageSquare, MessageSquarePlus, X } from "lucide-react";
import { Button, buttonClasses } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { ReviewFilterMenu, ReviewThreadList, reviewRequest, type ReviewFilter } from "./review-thread-list";
import { ReviewComposer, ReviewSelectionBubble, useReviewSelection } from "./review-composer";
import { ReviewPanelShell } from "./review-panel-shell";
import { COMMENT_HINT, focusReviewAnchor } from "./review-selection";
import { ReviewPassageMarkers } from "./review-passage-markers";
import { reviewRailInline, useReviewRailInline } from "./review-rail-mode";
import { awaitingReader, newComments, parseDismissed, sharedDismissedKey } from "./review-auto-open";
import { readStored, removeStored, writeStored } from "@/components/shell/use-persisted-state";

type DiscussionResult = { threads: ReviewThreadView[]; revisionId: string; writesEnabled: boolean; callerUserId: string | null };
export function SharedReviewPanel({ token, revisionId, markdown, signInHref, children }: { token: string; revisionId: string; markdown: string; signInHref: string; children: ReactNode }) {
  const [result, setResult] = useState<DiscussionResult>();
  const [error, setError] = useState<string>();
  const [activeThreadId, setActiveThreadId] = useState<string>();
  const [open, setOpen] = useState(false);
  const entryRef = useRef<HTMLButtonElement>(null);
  const readingRef = useRef<HTMLDivElement>(null);
  const inline = useReviewRailInline();
  const [filter, setFilter] = useState<ReviewFilter>("ALL");
  const shown = useRef<DiscussionResult | undefined>(undefined);
  useEffect(() => { shown.current = result; }, [result]);
  // The reader's own opening and closing. Closing is remembered as the discussions it was closed on,
  // so the rail stays shut on those and opens again for one that arrives later (as the owner's does).
  const changeOpen = useCallback((next: boolean) => {
    setOpen(next);
    if (next) removeStored("local", sharedDismissedKey(token));
    else writeStored("local", sharedDismissedKey(token), JSON.stringify(awaitingReader(shown.current?.threads ?? [])));
    if (!next) {
      setActiveThreadId(undefined);
      if (reviewRailInline()) entryRef.current?.focus({ preventScroll: true });
    }
  }, [token]);
  const toggle = useCallback(() => changeOpen(!open), [changeOpen, open]);
  const revisionChanged = !!result && result.revisionId !== revisionId;
  const canComment = !!result?.writesEnabled && !revisionChanged;
  const anonymous = result?.callerUserId === null;
  // Discussions are what a reviewer came for: where they fit beside the document, they open with it
  // (once) — unless this reader closed them on every discussion still waiting for them.
  const autoOpened = useRef(false);
  useEffect(() => {
    if (autoOpened.current || !result || !inline) return;
    autoOpened.current = true;
    const dismissed = parseDismissed(readStored("local", sharedDismissedKey(token)));
    if (awaitingReader(result.threads).some(id => !dismissed.includes(id))) setOpen(true);
  }, [result, inline, token]);
  useReviewHighlights(markdown, revisionChanged ? undefined : result?.threads, activeThreadId);
  const selection = useReviewSelection(readingRef, markdown, `${token}:${revisionId}`);
  // A newer reading, held back while it would move the cards: the reader chooses when to see it.
  const [arrived, setArrived] = useState<{ result: DiscussionResult; count: number }>();
  const load = useCallback(async () => {
    setError(undefined);
    try { setResult(await reviewRequest<DiscussionResult>("/api/share-review/threads/query", { token })); setArrived(undefined); } catch (failure) { setResult(undefined); setError(failure instanceof Error ? failure.message : "Discussions are unavailable."); }
  }, [token]);
  useEffect(() => { void load(); }, [load]);
  // Coming back to the tab reads the discussions again. Nothing new is taken in quietly; new
  // comments wait behind a notice, so a card is never moved under the reader.
  useEffect(() => {
    const back = async () => {
      if (document.visibilityState !== "visible" || !shown.current) return;
      try {
        const next = await reviewRequest<DiscussionResult>("/api/share-review/threads/query", { token });
        const count = shown.current ? newComments(shown.current.threads, next.threads) : 0;
        if (count === 0) setResult(next); else setArrived({ result: next, count });
      } catch { /* What is shown stays; Refresh still reads again. */ }
    };
    document.addEventListener("visibilitychange", back);
    return () => document.removeEventListener("visibilitychange", back);
  }, [token]);
  const showArrived = () => { if (!arrived) return; setResult(arrived.result); setArrived(undefined); changeOpen(true); };
  useEffect(() => { setActiveThreadId(undefined); }, [token, revisionId, markdown]);
  useEffect(() => {
    const activate = (event: Event) => setActiveThreadId((event as CustomEvent<string>).detail);
    document.addEventListener("review-focus-thread", activate);
    return () => document.removeEventListener("review-focus-thread", activate);
  }, []);
  const composer = selection.chosen && <ReviewComposer anchor={selection.chosen} onCancel={selection.clear} onSubmit={async (body, idempotencyKey) => {
    const created = await reviewRequest<{ id: string }>("/api/share-review/threads", { token, expectedRevisionId: revisionId, anchor: selection.chosen, body, idempotencyKey });
    selection.clear(); setFilter(current => current === "RESOLVED" ? "OPEN" : current); setActiveThreadId(created.id); await load();
  }} />;
  // Beside its passage where the discussions are a rail; at the top of the drawer, which covers the passage, where they are not.
  const draft = composer && inline && !revisionChanged ? { anchor: selection.chosen!, composer } : undefined;
  return <>
    <div className="kh-review-entry kh-reading-column sticky top-0 z-20 flex items-center justify-end gap-2 bg-kh-bg py-2">
      <span aria-live="polite">{arrived && <Button type="button" variant="soft" onClick={showArrived}>{arrived.count === 1 ? "1 new comment" : `${arrived.count} new comments`}</Button>}</span>
      <Button ref={entryRef} type="button" variant="ghost" aria-label={`${open ? "Hide discussions" : "Open discussions"}${result ? `, ${result.threads.length} comments` : ""}`} aria-expanded={open} aria-controls="shared-document-discussions" onPointerDown={event => event.preventDefault()} onClick={toggle}>
        <MessageSquare className="size-4" aria-hidden="true" />Comments{result && result.threads.length > 0 ? ` (${result.threads.length})` : ""}
      </Button>
    </div>
    {!open && (error || revisionChanged) && <div className="kh-reading-column pb-3">
      {error && <p role="status" className="text-body-sm">{error} <Button type="button" variant="ghost" aria-label="Refresh comments" onClick={() => void load()}><RefreshCw className="size-4" aria-hidden="true" />Retry</Button></p>}
      {revisionChanged && <p role="status" className="text-body-sm">Document changed. Refresh this page before selecting or locating a passage. You can still reply to existing discussions.</p>}
    </div>}
    <div className="kh-review-document" data-review-ready={result || error ? "" : undefined} data-review-open={open ? "" : undefined} data-review-inline={inline ? "" : undefined}>
      <div ref={readingRef} className="kh-review-reading">
        {children}
        {canComment && <ReviewSelectionBubble place={selection.place} ready={selection.ready} hint={selection.hint} onComment={() => { selection.capture(); changeOpen(true); }} />}
        {anonymous && !revisionChanged && <ReviewSelectionBubble place={selection.place} ready={selection.ready} signInHref={signInHref} onComment={() => undefined} />}
        <ReviewPassageMarkers readingRef={readingRef} markdown={markdown} threads={revisionChanged ? undefined : result?.threads} />
      </div>
      <aside id="shared-document-discussions" className="kh-review-panel" aria-label="Document discussions" onKeyDown={event => { if (!event.defaultPrevented && event.key === "Escape" && reviewRailInline()) changeOpen(false); }}>
    <ReviewPanelShell open={open} inline={inline} onOpenChange={changeOpen} returnFocus={() => entryRef.current?.focus({ preventScroll: true })}><div>
      <div className="kh-review-toolbar">
      {/* One row, as the owner's rail has: what this is and which of it is listed, then what acts
          on it. As a drawer the drawer names itself and closes itself, so the name and the cross
          are the rail's alone. */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1"><h2 className="kh-review-rail-only text-body font-medium">Comments</h2>{result && result.threads.length > 0 && <ReviewFilterMenu value={filter} onChange={setFilter} />}</div>
        <div className="flex shrink-0 items-center gap-1"><Tooltip label="Refresh comments"><Button type="button" variant="ghost" icon aria-label="Refresh comments" onClick={() => void load()}><RefreshCw className="size-4" aria-hidden="true" /></Button></Tooltip><span className="kh-review-rail-only"><Tooltip label="Hide comments"><Button type="button" variant="ghost" icon aria-label="Collapse discussions" onClick={() => changeOpen(false)}><X className="size-4" aria-hidden="true" /></Button></Tooltip></span></div>
      </div>
      {error && <p role="status" className="mt-3 text-body-sm">{error}</p>}
      {selection.refusal && <p role="status" className="mt-3 text-body-sm">{selection.refusal}</p>}
      {result && <div className="mt-3">
        {revisionChanged && <p role="status" className="mb-3 text-body-sm">Document changed. Refresh this page before selecting or locating a passage. You can still reply to existing discussions.</p>}
        {/* The one thing a reader does here that an owner does not, on a row of its own. */}
        {canComment && <div className="mb-3"><Button type="button" variant="soft" onPointerDown={event => event.preventDefault()} onClick={selection.capture} aria-label="Add comment from selected text"><MessageSquarePlus className="size-4" aria-hidden="true" />Add comment</Button>{!selection.ready && <p className="mt-1 text-caption text-kh-text-muted">{COMMENT_HINT}</p>}</div>}
        {!result.writesEnabled && <p className="mb-3 text-body-sm text-kh-text-muted">{result.callerUserId === null ? "Sign in to add a comment." : "Adding comments is currently disabled."}</p>}
        {anonymous && <div className="mb-3"><a href={signInHref} className={buttonClasses({ variant: "soft" })}><LogIn className="size-4" aria-hidden="true" />Sign in to comment</a></div>}
      </div>}
      </div>
      {!draft && composer}
      {result && <ReviewThreadList draft={draft} filter={filter} onFilterChange={setFilter} railMarkdown={revisionChanged ? undefined : markdown} activeThreadId={activeThreadId} onActivate={setActiveThreadId} focusAnchor={revisionChanged ? undefined : anchor => { const root = document.querySelector<HTMLElement>("[data-review-document]"); if (root) focusReviewAnchor(root, markdown, anchor); }} threads={result.threads} writesEnabled={result.writesEnabled} signInHref={anonymous ? signInHref : undefined} reply={async (threadId, body, idempotencyKey) => { await reviewRequest(`/api/share-review/threads/${threadId}/replies`, { token, body, idempotencyKey }); await load(); }}
        author={result.callerUserId === null ? undefined : {
          edit: async (threadId, commentId, body) => { await reviewRequest(`/api/share-review/threads/${threadId}/comments/${commentId}/body`, { token, body }); await load(); },
          remove: async (threadId, commentId) => { await reviewRequest(`/api/share-review/threads/${threadId}/comments/${commentId}/deletion`, { token }); await load(); },
        }} />}
    </div></ReviewPanelShell>
      </aside>
    </div>
  </>;
}
