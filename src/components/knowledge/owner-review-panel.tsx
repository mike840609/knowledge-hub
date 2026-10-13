"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { MessageSquarePlus, RefreshCw, X } from "lucide-react";
import type { OwnerReviewThreadView } from "@/modules/knowledge/domain/document-review";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { readStored, removeStored, writeStored } from "@/components/shell/use-persisted-state";
import { awaitingOwner, dismissedKey, opensOnArrival, parseDismissed } from "./review-auto-open";
import { useReviewEntry } from "./review-entry";
import { useReviewHighlights } from "./review-highlights";
import { ReviewComposer, useReviewSelection } from "./review-composer";
import { ReviewPanelShell } from "./review-panel-shell";
import { ReviewPassageMarkers } from "./review-passage-markers";
import { reviewRailInline, useReviewRailInline } from "./review-rail-mode";
import { focusReviewAnchor } from "./review-selection";
import { ReviewFilterMenu, ReviewThreadList, reviewRequest, type ReviewFilter } from "./review-thread-list";

/**
 * The owner's discussions, beside the article they are about (`children`).
 *
 * As on a shared page: reading first, a mark on each passage that has a discussion, and — once
 * opened — a card level with its passage. Where the document pane has room the cards are a rail in
 * the outline's place; where it has not, a drawer (docs/superpowers/specs/2026-10-12-owner-comments-rail-design.md).
 * The owner replies, resolves and hides, and starts a discussion as a reader of a link does: by
 * selecting a passage (docs/superpowers/specs/2026-10-13-review-anchors-and-owner-threads-design.md).
 */
export function OwnerReviewPanel({ documentId, markdown, revisionId, readOnly = false, children }: { documentId: string; revisionId: string; markdown: string; readOnly?: boolean; children: ReactNode }) {
  const [result, setResult] = useState<{ threads: OwnerReviewThreadView[]; writesEnabled: boolean; revisionId: string; callerUserId: string }>();
  const [error, setError] = useState<string>();
  const [open, setOpen] = useState(false);
  const [activeThreadId, setActiveThreadId] = useState<string>();
  const [filter, setFilter] = useState<ReviewFilter>("ALL");
  // The way in is the document header's (`review-entry.tsx`), not a row of this panel's.
  const shared = useReviewEntry();
  const publish = shared?.publish;
  const entryRef = shared?.buttonRef;
  const readingRef = useRef<HTMLDivElement>(null);
  const inline = useReviewRailInline();
  const revisionChanged = !!result && result.revisionId !== revisionId;
  const located = revisionChanged ? undefined : result?.threads;
  useReviewHighlights(markdown, located, activeThreadId);
  const selection = useReviewSelection(readingRef, markdown, `${documentId}:${revisionId}`);
  const canComment = !!result?.writesEnabled && !readOnly && !revisionChanged;
  const base = `/api/documents/${documentId}/review-threads`;
  const load = useCallback(async () => { try { setResult(await reviewRequest(base)); setError(undefined); } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not load discussions."); } }, [base]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setActiveThreadId(undefined); }, [documentId, revisionId]);
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
    if (reviewRailInline() && opensOnArrival(result.threads, parseDismissed(readStored("local", dismissedKey(documentId))), result.callerUserId)) setOpen(true);
  }, [result, documentId]);
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
      setActiveThreadId(undefined);
      if (reviewRailInline()) entryRef?.current?.focus({ preventScroll: true });
    }
  }, [documentId, entryRef]);
  const count = result?.threads.length ?? 0;
  const awaiting = result?.threads.filter(thread => thread.status === "OPEN").length ?? 0;
  // Only where there is something for the header to offer: discussions to open, a selection to
  // comment on, or a word on why it cannot be. On a document with none of them this would be a
  // control that opens an empty panel, on every document.
  const { ready, hint, capture } = selection;
  const startHere = canComment && ready && !open;
  const said = canComment && !ready ? hint : undefined;
  useEffect(() => {
    publish?.(count > 0 || open || startHere || said ? { count, awaiting, open, toggle: () => changeOpen(!open), comment: startHere ? () => { capture(); changeOpen(true); } : undefined, hint: said } : null);
  }, [publish, count, awaiting, open, changeOpen, startHere, said, capture]);
  useEffect(() => () => publish?.(null), [publish]);
  const refresh = <Tooltip label="Refresh comments"><Button type="button" variant="ghost" icon aria-label="Refresh comments" onClick={() => void load()}><RefreshCw className="size-4" aria-hidden="true" /></Button></Tooltip>;
  return <>
    {!open && error && <p role="alert" className="pb-3 text-body-sm">{error}</p>}
    <div className="kh-review-document" data-review-ready={result || error ? "" : undefined} data-review-open={open ? "" : undefined} data-review-inline={inline ? "" : undefined}>
      <div ref={readingRef} className="kh-review-reading">
        {children}
        <ReviewPassageMarkers readingRef={readingRef} markdown={markdown} threads={located} />
      </div>
      <aside id="owner-document-discussions" className="kh-review-panel" aria-label="Document discussions" onKeyDown={event => { if (!event.defaultPrevented && event.key === "Escape" && reviewRailInline()) changeOpen(false); }}>
        <ReviewPanelShell open={open} inline={inline} onOpenChange={changeOpen} returnFocus={() => entryRef?.current?.focus({ preventScroll: true })}><div>
          <div className="kh-review-toolbar">
            {/* One row: what this is and which of it is listed, then what acts on it. As a drawer the
                drawer names itself and closes itself, so the name and the cross are the rail's alone.
                A cross, not a panel glyph: Details, just above, is the panel glyph. */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-1"><h2 className="kh-review-rail-only text-body font-medium">Comments</h2>{count > 0 && <ReviewFilterMenu value={filter} onChange={setFilter} />}</div>
              <div className="flex shrink-0 items-center gap-1">{refresh}<span className="kh-review-rail-only"><Tooltip label="Hide comments"><Button type="button" variant="ghost" icon aria-label="Collapse discussions" onClick={() => changeOpen(false)}><X className="size-4" aria-hidden="true" /></Button></Tooltip></span></div>
            </div>
            {error && <p role="alert" className="mt-3 text-body-sm">{error}</p>}
            {selection.refusal && <p role="status" className="mt-3 text-body-sm">{selection.refusal}</p>}
            {revisionChanged && <p role="status" className="mt-3 text-body-sm">Document changed. Refresh this page before selecting or locating a passage.</p>}
            {canComment && <div className="mt-3"><Button type="button" variant="soft" onPointerDown={event => event.preventDefault()} onClick={selection.capture} aria-label="Comment on selection"><MessageSquarePlus className="size-4" aria-hidden="true" />Add comment</Button></div>}
          </div>
          {selection.chosen && <div className="mt-3"><ReviewComposer anchor={selection.chosen} onCancel={selection.clear} onSubmit={async (body, idempotencyKey) => {
            const created = await reviewRequest<{ id: string }>(base, { expectedRevisionId: revisionId, anchor: selection.chosen, body, idempotencyKey });
            selection.clear(); setFilter(current => current === "RESOLVED" ? "OPEN" : current); setActiveThreadId(created.id); await load();
          }} /></div>}
          {result && <div className="mt-3"><ReviewThreadList filter={filter} onFilterChange={setFilter} railMarkdown={revisionChanged ? undefined : markdown} activeThreadId={activeThreadId} onActivate={setActiveThreadId}
            focusAnchor={revisionChanged ? undefined : anchor => { const root = document.querySelector<HTMLElement>("[data-review-document]"); if (root) focusReviewAnchor(root, markdown, anchor); }}
            threads={result.threads} writesEnabled={result.writesEnabled && !readOnly} canResolve={!readOnly}
            reply={async (threadId, body, idempotencyKey) => { await reviewRequest(`${base}/${threadId}/replies`, { body, idempotencyKey }); await load(); }}
            moderate={async (threadId, action, value, commentId) => { const path = commentId ? `${base}/${threadId}/comments/${commentId}/visibility` : `${base}/${threadId}/${action}`; await reviewRequest(path, action === "resolution" ? { status: value } : { visibility: value }); await load(); }} /></div>}
        </div></ReviewPanelShell>
      </aside>
    </div>
  </>;
}
