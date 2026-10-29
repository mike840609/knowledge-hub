"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CheckCheck, MessageSquarePlus, RefreshCw, X } from "lucide-react";
import type { OwnerReviewThreadView } from "@/modules/knowledge/domain/document-review";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { readStored, removeStored, writeStored } from "@/components/shell/use-persisted-state";
import { awaitingOwner, dismissedKey, opensOnArrival, parseDismissed } from "./review-auto-open";
import { useShareCommentUnread } from "./share-comment-notifications";
import { useReviewEntry } from "./review-entry";
import { useReviewHighlights } from "./review-highlights";
import { ReviewComposer, ReviewSelectionBubble, useReviewSelection } from "./review-composer";
import { ReviewPanelShell } from "./review-panel-shell";
import { ReviewBlockComment } from "./review-block-comment";
import { ReviewPassageMarkers } from "./review-passage-markers";
import { reviewRailInline, useReviewRailInline, useReviewRailOpen } from "./review-rail-mode";
import { InlineReviewContext, type CaptureReviewAnchor, type PreparedReviewComment } from "./inline-review-context";
import { useReviewDomVersion } from "./review-dom-version";
import { COMMENT_HINT, createReviewRangeResolver, focusReviewAnchor, selectionAnchorInBlock } from "./review-selection";
import { ReviewFilterMenu, ReviewNextButtons, ReviewThreadList, reviewRequest, type ReviewFilter } from "./review-thread-list";

/**
 * The owner's discussions, beside the article they are about (`children`).
 *
 * As on a shared page: reading first, a mark on each passage that has a discussion, and — once
 * opened — a card level with its passage. Where the document pane has room the cards are a rail in
 * the outline's place; where it has not, a drawer (docs/superpowers/specs/2026-10-12-owner-comments-rail-design.md).
 * The owner replies, resolves and hides, and starts a discussion as a reader of a link does: by
 * selecting a passage (docs/superpowers/specs/2026-10-13-review-anchors-and-owner-threads-design.md).
 */
export function OwnerReviewPanel({ documentId, markdown, revisionId, readOnly = false, contentPending = false, prepareComment, commentAvailable = false, thread, children }: { /** A discussion to open on arrival in place of `?thread=`, with its passage scrolled into view (the Inbox). */ thread?: string; prepareComment?: (capture: CaptureReviewAnchor) => PreparedReviewComment; commentAvailable?: boolean; documentId: string; revisionId: string; markdown: string; readOnly?: boolean; contentPending?: boolean; children: ReactNode }) {
  const [result, setResult] = useState<{ threads: OwnerReviewThreadView[]; writesEnabled: boolean; revisionId: string; callerUserId: string }>();
  const [error, setError] = useState<string>();
  const [activeThreadId, setActiveThreadId] = useState<string>();
  const [filter, setFilter] = useState<ReviewFilter>("ALL");
  // The way in is the document header's (`review-entry.tsx`), not a row of this panel's.
  const shared = useReviewEntry();
  const publish = shared?.publish;
  const entryRef = shared?.buttonRef;
  const readingRef = useRef<HTMLDivElement>(null);
  // Every way the rail opens and closes holds the reader's place.
  const [open, setOpen, holdAt] = useReviewRailOpen(readingRef);
  const inline = useReviewRailInline();
  const revisionChanged = !!result && result.revisionId !== revisionId;
  const located = revisionChanged || contentPending ? undefined : result?.threads;
  useReviewHighlights(markdown, located, activeThreadId);
  const selection = useReviewSelection(readingRef, markdown, prepareComment ? documentId : `${documentId}:${revisionId}`, !!prepareComment);
  const [prepared, setPrepared] = useState<PreparedReviewComment>();
  const [commentRevision, setCommentRevision] = useState<string>();
  const [savingDocument, setSavingDocument] = useState(false);
  const [saveError, setSaveError] = useState<string>();
  const requestVersion = useRef(0);
  const returnPassage = useRef<(() => void) | null>(null);
  const domVersion = useReviewDomVersion();
  const canRequest = !!prepareComment && !!result?.writesEnabled && !readOnly && !revisionChanged && commentAvailable;
  const canRequestSelection = canRequest && selection.ready && !selection.chosen;
  const savePrepared = useCallback(async (comment: PreparedReviewComment, version: number) => {
    setSavingDocument(true); setSaveError(undefined);
    try {
      const revision = await comment.save();
      if (requestVersion.current === version) setCommentRevision(revision);
    } catch (failure) {
      if (requestVersion.current === version) setSaveError(failure instanceof Error ? failure.message : "Could not save the document. Your comment is kept here.");
    } finally {
      if (requestVersion.current === version) setSavingDocument(false);
    }
  }, []);
  useEffect(() => () => { requestVersion.current++; }, [documentId]);
  useEffect(() => {
    const registry = (globalThis.CSS as typeof CSS & { highlights?: Map<string, unknown> })?.highlights;
    const HighlightClass = (globalThis as typeof globalThis & { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
    const root = readingRef.current?.querySelector<HTMLElement>("[data-review-document]");
    const range = root && selection.chosen && prepared ? createReviewRangeResolver(root, prepared.markdown)(selection.chosen) : null;
    if (registry && HighlightClass && range) registry.set("document-review-draft", new HighlightClass(range));
    else registry?.delete("document-review-draft");
    return () => { registry?.delete("document-review-draft"); };
  }, [selection.chosen, prepared, domVersion]);
  const canComment = !!result?.writesEnabled && !readOnly && !revisionChanged && !contentPending;
  const base = `/api/documents/${documentId}/review-threads`;
  const { unreadCount, unreadThreadIds, markRead } = useShareCommentUnread(documentId);
  // Updating is a read *again*: the first read renders nothing extra while the document is still settling in.
  const [refreshing, setRefreshing] = useState(false);
  const loaded = useRef(false);
  const load = useCallback(async () => { if (loaded.current) setRefreshing(true); try { setResult(await reviewRequest(base)); loaded.current = true; setError(undefined); } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not load discussions."); } finally { setRefreshing(false); } }, [base]);
  useEffect(() => { if (contentPending && !prepareComment) selection.clear(); }, [contentPending, prepareComment, selection.clear]);
  // Looking at a discussion marks its notices read; opening the panel marks nothing (spec 2026-10-22).
  useEffect(() => { if (open && activeThreadId && unreadThreadIds.has(activeThreadId)) void markRead(activeThreadId); }, [open, activeThreadId, unreadThreadIds, markRead]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setActiveThreadId(undefined); }, [documentId, revisionId]);
  useEffect(() => { if (revisionChanged && !contentPending) void load(); }, [revisionChanged, contentPending, load]);
  // Open on arrival, once, where a discussion awaits the owner that they have not closed the rail
  // on (`review-auto-open.ts`) — and only as a rail: a drawer would cover what they came to read.
  // It sets the state and nothing else, so it takes neither the focus nor the scroll position.
  const threads = useRef<OwnerReviewThreadView[]>([]);
  const arrived = useRef(false);
  const owner = useRef<string | null>(null);
  useEffect(() => {
    if (!result) return;
    threads.current = result.threads;
    owner.current = result.callerUserId;
    if (arrived.current) return;
    arrived.current = true;
    // The list starts on what is still open, where something is: settled discussions would
    // otherwise crowd the ones that want an answer away from their passages. With nothing open it
    // starts on everything — an empty list would say there was nothing at all.
    setFilter(result.threads.some(thread => thread.status === "OPEN") ? "OPEN" : "ALL");
    // A `?thread=` deep link (e.g. from the home discussions list) selects its
    // discussion and opens the rail; an unknown id is ignored, never an error.
    const deep = thread ?? new URLSearchParams(window.location.search).get("thread");
    const found = deep ? result.threads.find(item => item.id === deep) : undefined;
    // From the Inbox only as a rail: a drawer would cover the list the reader is working through.
    if (found) { setActiveThreadId(found.id); if (!thread || reviewRailInline()) setOpen(true); }
    const anchor = thread && found?.currentAnchor.match !== "OUTDATED" ? found?.currentAnchor.anchor : undefined;
    if (anchor) requestAnimationFrame(() => {
      const root = readingRef.current?.querySelector<HTMLElement>("[data-review-document]");
      const range = root ? createReviewRangeResolver(root, markdown)(anchor) : null;
      range?.startContainer.parentElement?.scrollIntoView({ block: "center" });
    });
    if (reviewRailInline() && opensOnArrival(result.threads, parseDismissed(readStored("local", dismissedKey(documentId))), result.callerUserId)) setOpen(true);
  }, [result, documentId, thread, markdown]);
  useEffect(() => {
    const activate = (event: Event) => setActiveThreadId((event as CustomEvent<string>).detail);
    document.addEventListener("review-focus-thread", activate);
    return () => document.removeEventListener("review-focus-thread", activate);
  }, []);
  // The owner's own opening and closing. Closing is remembered as the discussions it was closed on,
  // so the rail stays shut on those and opens again for one that arrives later.
  const changeOpen = useCallback((next: boolean) => {
    setOpen(next);
    if (next) removeStored("local", dismissedKey(documentId));
    else writeStored("local", dismissedKey(documentId), JSON.stringify(awaitingOwner(threads.current, owner.current)));
    if (!next) {
      requestVersion.current++;
      selection.clear(); setPrepared(undefined); setCommentRevision(undefined); setSaveError(undefined); setSavingDocument(false);
      setActiveThreadId(undefined);
      if (reviewRailInline()) {
        if (returnPassage.current) { const restore = returnPassage.current; returnPassage.current = null; requestAnimationFrame(restore); }
        else entryRef?.current?.focus({ preventScroll: true });
      }
    }
  }, [documentId, entryRef, selection.clear]);
  const count = result?.threads.length ?? 0;
  // The key is there when the header's control is: with discussions to open, or open ones to close.
  const toggle = useCallback(() => changeOpen(!open), [changeOpen, open]);
  const awaiting = result?.threads.filter(thread => thread.status === "OPEN").length ?? 0;
  // Only where there is something for the header to offer: discussions to open. On a document with
  // none this would be a control that opens an empty panel, on every document. A selection is
  // offered its comment beside it (`ReviewSelectionBubble`), not here.
  useEffect(() => {
    publish?.(count > 0 || open || unreadCount > 0 ? { count, awaiting, unread: unreadCount, open, toggle } : null);
  }, [publish, count, awaiting, unreadCount, open, toggle]);
  useEffect(() => () => publish?.(null), [publish]);
  const requestComment = useCallback((capture: CaptureReviewAnchor) => {
    if (!canRequest || !prepareComment) return;
    try {
      const comment = prepareComment(capture);
      const version = ++requestVersion.current;
      setPrepared(comment); setCommentRevision(undefined); setSaveError(undefined);
      selection.choose(comment.anchor); changeOpen(true);
      void savePrepared(comment, version);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not select this passage."); }
  }, [canRequest, prepareComment, selection.choose, changeOpen, savePrepared]);
  const reviewContext = useMemo(() => prepareComment ? { available: canRequestSelection, request: requestComment } : null, [prepareComment, canRequestSelection, requestComment]);
  const cancelComment = () => {
    const anchor = selection.chosen;
    const snapshot = prepared?.markdown ?? markdown;
    const restore = () => {
      const root = readingRef.current?.querySelector<HTMLElement>("[data-review-document]");
      if (root && anchor) {
        if (createReviewRangeResolver(root, snapshot)(anchor)) focusReviewAnchor(root, snapshot, anchor);
        else root.querySelector<HTMLElement>('[contenteditable="true"]')?.focus({ preventScroll: true });
      }
    };
    requestVersion.current++;
    selection.clear(); setPrepared(undefined); setCommentRevision(undefined); setSaveError(undefined); setSavingDocument(false);
    if (!inline) { returnPassage.current = restore; changeOpen(false); }
    else requestAnimationFrame(restore);
  };
  const composer = selection.chosen && <ReviewComposer anchor={selection.chosen} onCancel={cancelComment} cancelOnEscape={!!prepared}
    pending={savingDocument} saveError={saveError}
    onRetrySave={prepared ? () => { void savePrepared(prepared, ++requestVersion.current); } : undefined}
    onSubmit={async (body, idempotencyKey) => {
      const revision = prepared ? commentRevision : revisionId;
      if (!revision || savingDocument || saveError) throw new Error("Wait for the document to finish saving before commenting.");
      const created = await reviewRequest<{ id: string }>(base, { expectedRevisionId: revision, anchor: selection.chosen, body, idempotencyKey });
      selection.clear(); setPrepared(undefined); setCommentRevision(undefined);
      setFilter(current => current === "RESOLVED" ? "OPEN" : current); setActiveThreadId(created.id); await load();
    }} />;
  // Beside its passage where the discussions are a rail; at the top of the drawer, which covers the passage, where they are not.
  const draft = composer && inline && (!revisionChanged || !!prepared) ? { anchor: selection.chosen!, composer } : undefined;
  const refresh = <Tooltip label="Refresh comments"><Button type="button" variant="ghost" icon aria-label="Refresh comments" disabled={refreshing} onClick={() => void load()}><RefreshCw className={`size-4 ${refreshing ? "motion-safe:animate-spin" : ""}`} aria-hidden="true" /></Button></Tooltip>;
  return <InlineReviewContext.Provider value={reviewContext}>
    {!open && error && <p role="alert" className="pb-3 text-body-sm">{error}</p>}
    <div className="kh-review-document" data-review-ready={result || error ? "" : undefined} data-review-open={open ? "" : undefined} data-review-inline={inline ? "" : undefined}>
      <div ref={readingRef} className="kh-review-reading">
        {children}
        {canComment && (!prepareComment || !!selection.hint) && <ReviewSelectionBubble place={selection.place} ready={selection.ready} hint={selection.hint} onComment={() => { selection.capture(); changeOpen(true); }} />}
        {canComment && <ReviewBlockComment readingRef={readingRef} markdown={markdown} chosen={selection.chosen} onChoose={(anchor, element) => {
          holdAt(element);
          // What is selected inside this paragraph is the comment's passage; without a selection
          // there the button still comments on the paragraph, up to the server's quote limit.
          // The whole paragraph lights up only when the comment is about the whole paragraph.
          const resolve = (current: string) => {
            const root = readingRef.current?.querySelector<HTMLElement>("[data-review-document]");
            return (root && selectionAnchorInBlock(root, current, anchor, window.getSelection())) ?? anchor;
          };
          if (prepareComment) {
            let useBlock = true;
            requestComment(current => {
              const resolved = resolve(current);
              useBlock = resolved === anchor;
              return resolved;
            });
            return useBlock;
          }
          const resolved = resolve(markdown);
          selection.choose(resolved);
          changeOpen(true);
          return resolved === anchor;
        }} />}
        <ReviewPassageMarkers readingRef={readingRef} markdown={markdown} threads={located} />
      </div>
      <aside id="owner-document-discussions" className="kh-review-panel" aria-label="Document discussions" onKeyDown={event => { if (!event.defaultPrevented && event.key === "Escape" && reviewRailInline()) { if (selection.chosen) cancelComment(); else changeOpen(false); } }}>
        <ReviewPanelShell open={open} inline={inline} onOpenChange={changeOpen} returnFocus={() => { if (returnPassage.current) { const restore = returnPassage.current; returnPassage.current = null; restore(); } else entryRef?.current?.focus({ preventScroll: true }); }}><div>
          <div className="kh-review-toolbar">
            {/* One row: what this is and which of it is listed, then what acts on it. As a drawer the
                drawer names itself and closes itself, so the name and the cross are the rail's alone.
                A cross, not a panel glyph: Details, just above, is the panel glyph. */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-1"><h2 className="kh-review-rail-only text-body font-medium">Comments</h2>{count > 0 && <ReviewFilterMenu value={filter} onChange={setFilter} />}</div>
              <div className="flex shrink-0 items-center gap-1">{unreadCount > 0 && <Tooltip label="Mark all read"><Button type="button" variant="ghost" icon aria-label="Mark all read" onClick={() => void markRead()}><CheckCheck className="size-4" aria-hidden="true" /></Button></Tooltip>}{refresh}<span className="kh-review-rail-only"><Tooltip label="Hide comments"><Button type="button" variant="ghost" icon aria-label="Collapse discussions" onClick={() => changeOpen(false)}><X className="size-4" aria-hidden="true" /></Button></Tooltip></span></div>
            </div>
            {result && result.threads.length > 0 && <ReviewNextButtons threads={result.threads} activeThreadId={activeThreadId} onActivate={setActiveThreadId} filter={filter} onFilterChange={setFilter} unreadThreadIds={unreadThreadIds} />}
            {error && <p role="alert" className="mt-3 text-body-sm">{error}</p>}
            {refreshing && result && <p role="status" className="mt-3 text-caption text-kh-text-muted">Updating…</p>}
            {selection.refusal && <p role="status" className="mt-3 text-body-sm">{selection.refusal}</p>}
            {revisionChanged && !prepared && <p role="status" className="mt-3 text-body-sm">Document changed. Refresh this page before selecting or locating a passage.</p>}
            {canComment && !selection.chosen && <div className="mt-3"><Button type="button" variant="soft" onPointerDown={event => event.preventDefault()} onClick={() => { if (prepareComment) requestComment(() => selection.capture()); else selection.capture(); }} ><MessageSquarePlus className="size-4" aria-hidden="true" />Comment on selected text</Button>{!selection.ready && <p className="mt-1 text-caption text-kh-text-muted">{COMMENT_HINT}</p>}</div>}
          </div>
          {composer && !draft && <div className="mt-3">{composer}</div>}
          {result && <div className="mt-3"><ReviewThreadList draft={draft} filter={filter} onFilterChange={setFilter} railMarkdown={prepared?.markdown ?? (revisionChanged || contentPending ? undefined : markdown)} activeThreadId={activeThreadId} onActivate={setActiveThreadId} unreadThreadIds={unreadThreadIds}
            focusAnchor={revisionChanged || contentPending ? undefined : anchor => { const root = document.querySelector<HTMLElement>("[data-review-document]"); if (root) focusReviewAnchor(root, markdown, anchor); }}
            threads={result.threads} writesEnabled={result.writesEnabled && !readOnly} canResolve={!readOnly}
            reply={async (threadId, body, idempotencyKey) => { await reviewRequest(`${base}/${threadId}/replies`, { body, idempotencyKey }); if (unreadThreadIds.has(threadId)) void markRead(threadId); await load(); }}
            author={{
              edit: async (threadId, commentId, body) => { await reviewRequest(`${base}/${threadId}/comments/${commentId}/body`, { body }); await load(); },
              remove: async (threadId, commentId) => { await reviewRequest(`${base}/${threadId}/comments/${commentId}/deletion`, {}); await load(); },
            }}
            moderate={async (threadId, action, value, commentId) => { const path = commentId ? `${base}/${threadId}/comments/${commentId}/visibility` : `${base}/${threadId}/${action}`; await reviewRequest(path, action === "resolution" ? { status: value } : { visibility: value }); await load(); }} /></div>}
        </div></ReviewPanelShell>
      </aside>
    </div>
  </InlineReviewContext.Provider>;
}
