"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { MessageSquare, PanelRightClose, RefreshCw } from "lucide-react";
import type { OwnerReviewThreadView } from "@/modules/knowledge/domain/document-review";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { useReviewHighlights } from "./review-highlights";
import { ReviewPanelShell } from "./review-panel-shell";
import { ReviewPassageMarkers } from "./review-passage-markers";
import { reviewRailInline, useReviewRailInline } from "./review-rail-mode";
import { focusReviewAnchor } from "./review-selection";
import { ReviewThreadList, reviewRequest } from "./review-thread-list";

/**
 * The owner's discussions, beside the article they are about (`children`).
 *
 * As on a shared page: reading first, a mark on each passage that has a discussion, and — once
 * opened — a card level with its passage. Where the document pane has room the cards are a rail in
 * the outline's place; where it has not, a drawer (docs/superpowers/specs/2026-10-12-owner-comments-rail-design.md).
 * What the owner may do is what it was: reply, resolve, hide. An owner does not start a discussion.
 */
export function OwnerReviewPanel({ documentId, markdown, revisionId, readOnly = false, children }: { documentId: string; revisionId: string; markdown: string; readOnly?: boolean; children: ReactNode }) {
  const [result, setResult] = useState<{ threads: OwnerReviewThreadView[]; writesEnabled: boolean; revisionId: string }>();
  const [error, setError] = useState<string>();
  const [open, setOpen] = useState(false);
  const [activeThreadId, setActiveThreadId] = useState<string>();
  const entryRef = useRef<HTMLButtonElement>(null);
  const readingRef = useRef<HTMLDivElement>(null);
  const inline = useReviewRailInline();
  const revisionChanged = !!result && result.revisionId !== revisionId;
  const located = revisionChanged ? undefined : result?.threads;
  useReviewHighlights(markdown, located, activeThreadId);
  const base = `/api/documents/${documentId}/review-threads`;
  const load = useCallback(async () => { try { setResult(await reviewRequest(base)); setError(undefined); } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not load discussions."); } }, [base]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setActiveThreadId(undefined); }, [documentId, revisionId]);
  useEffect(() => {
    const activate = (event: Event) => setActiveThreadId((event as CustomEvent<string>).detail);
    document.addEventListener("review-focus-thread", activate);
    return () => document.removeEventListener("review-focus-thread", activate);
  }, []);
  const changeOpen = useCallback((next: boolean) => {
    setOpen(next);
    if (!next) {
      setActiveThreadId(undefined);
      if (reviewRailInline()) entryRef.current?.focus({ preventScroll: true });
    }
  }, []);
  const count = result?.threads.length ?? 0;
  return <>
    {/* Only where there is something to open: an owner does not start a discussion, so on a
        document without one this would be a button to an empty panel, on every document. */}
    {count > 0 && <div className="kh-review-entry flex items-center justify-end gap-2 pb-2">
      <Button ref={entryRef} type="button" variant="ghost" aria-label={`${open ? "Hide discussions" : "Open discussions"}${result ? `, ${count} comments` : ""}`} aria-expanded={open} aria-controls="owner-document-discussions" onPointerDown={event => event.preventDefault()} onClick={() => changeOpen(!open)}>
        <MessageSquare className="size-4" aria-hidden="true" />Comments ({count})
      </Button>
    </div>}
    {!open && error && <p role="alert" className="pb-3 text-body-sm">{error}</p>}
    <div className="kh-shared-document" data-review-ready={result || error ? "" : undefined} data-review-open={open ? "" : undefined} data-review-inline={inline ? "" : undefined}>
      <div ref={readingRef} className="kh-shared-reading">
        {children}
        <ReviewPassageMarkers readingRef={readingRef} markdown={markdown} threads={located} />
      </div>
      <aside id="owner-document-discussions" className="kh-shared-review-panel" aria-label="Document discussions" onKeyDown={event => { if (!event.defaultPrevented && event.key === "Escape" && reviewRailInline()) changeOpen(false); }}>
        <ReviewPanelShell open={open} inline={inline} onOpenChange={changeOpen} returnFocus={() => entryRef.current?.focus({ preventScroll: true })}><div>
          <div className="kh-review-toolbar">
            <div className="kh-review-rail-heading mb-3 items-center justify-between"><h2 className="text-body font-medium">Comments</h2><Tooltip label="Hide discussions"><Button type="button" variant="ghost" icon aria-label="Collapse discussions" onClick={() => changeOpen(false)}><PanelRightClose className="size-4" aria-hidden="true" /></Button></Tooltip></div>
            <div className="flex justify-end"><Tooltip label="Refresh comments"><Button type="button" variant="ghost" icon aria-label="Refresh comments" onClick={() => void load()}><RefreshCw className="size-4" aria-hidden="true" /></Button></Tooltip></div>
            {error && <p role="alert" className="mt-3 text-body-sm">{error}</p>}
            {revisionChanged && <p role="status" className="mt-3 text-body-sm">Document changed. Refresh this page before locating a passage.</p>}
          </div>
          {result && <div className="mt-3"><ReviewThreadList railMarkdown={revisionChanged ? undefined : markdown} activeThreadId={activeThreadId} onActivate={setActiveThreadId}
            focusAnchor={revisionChanged ? undefined : anchor => { const root = document.querySelector<HTMLElement>("[data-review-document]"); if (root) focusReviewAnchor(root, markdown, anchor); }}
            threads={result.threads} writesEnabled={result.writesEnabled && !readOnly} canResolve={!readOnly}
            reply={async (threadId, body, idempotencyKey) => { await reviewRequest(`${base}/${threadId}/replies`, { body, idempotencyKey }); await load(); }}
            moderate={async (threadId, action, value, commentId) => { const path = commentId ? `${base}/${threadId}/comments/${commentId}/visibility` : `${base}/${threadId}/${action}`; await reviewRequest(path, action === "resolution" ? { status: value } : { visibility: value }); await load(); }} /></div>}
        </div></ReviewPanelShell>
      </aside>
    </div>
  </>;
}
