"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { ReviewAnchor, ReviewThreadView } from "@/modules/knowledge/domain/document-review";
import { useReviewHighlights } from "./review-highlights";
import { RefreshCw, MessageSquare, MessageSquarePlus, PanelRightClose } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { ReviewReplyForm, ReviewThreadList, reviewRequest } from "./review-thread-list";
import { ReviewPanelShell } from "./review-panel-shell";
import { focusReviewAnchor, selectedReviewAnchor } from "./review-selection";
import { ReviewPassageMarkers } from "./review-passage-markers";
import { reviewRailInline, useReviewRailInline } from "./review-rail-mode";

type DiscussionResult = { threads: ReviewThreadView[]; revisionId: string; writesEnabled: boolean; callerUserId: string | null };
export function SharedReviewPanel({ token, revisionId, markdown, children }: { token: string; revisionId: string; markdown: string; children: ReactNode }) {
  const [result, setResult] = useState<DiscussionResult>();
  const [error, setError] = useState<string>();
  const [activeThreadId, setActiveThreadId] = useState<string>();
  const [open, setOpen] = useState(false);
  const [hasSelection, setHasSelection] = useState(false);
  const entryRef = useRef<HTMLButtonElement>(null);
  const readingRef = useRef<HTMLDivElement>(null);
  const inline = useReviewRailInline();
  const changeOpen = useCallback((next: boolean) => {
    setOpen(next);
    if (!next) {
      setActiveThreadId(undefined);
      if (reviewRailInline()) entryRef.current?.focus({ preventScroll: true });
    }
  }, []);
  const revisionChanged = !!result && result.revisionId !== revisionId;
  useReviewHighlights(markdown, revisionChanged ? undefined : result?.threads, activeThreadId);
  const pendingSelection = useRef<ReviewAnchor | null>(null);
  const [selection, setSelection] = useState<ReviewAnchor | null>(null);
  const load = useCallback(async () => {
    setError(undefined);
    try { setResult(await reviewRequest<DiscussionResult>("/api/share-review/threads/query", { token })); } catch (failure) { setResult(undefined); setError(failure instanceof Error ? failure.message : "Discussions are unavailable."); }
  }, [token]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { pendingSelection.current = null; setSelection(null); }, [token, revisionId, markdown]);
  useEffect(() => { setActiveThreadId(undefined); }, [token, revisionId, markdown]);
  useEffect(() => {
    const activate = (event: Event) => setActiveThreadId((event as CustomEvent<string>).detail);
    document.addEventListener("review-focus-thread", activate);
    return () => document.removeEventListener("review-focus-thread", activate);
  }, []);
  useEffect(() => {
    const remember = () => {
      const browserSelection = window.getSelection();
      const root = readingRef.current?.querySelector<HTMLElement>("[data-review-document]");
      const anchor = browserSelection && !browserSelection.isCollapsed && root ? selectedReviewAnchor(root, markdown, browserSelection) : null;
      setHasSelection(!!anchor);
      if (anchor || !browserSelection?.isCollapsed) pendingSelection.current = anchor;
    };
    document.addEventListener("selectionchange", remember); return () => document.removeEventListener("selectionchange", remember);
  }, [markdown]);
  function capture() {
    const root = document.querySelector<HTMLElement>("[data-review-document]");
    const browserSelection = window.getSelection();
    const anchor = root ? selectedReviewAnchor(root, markdown, browserSelection) : null;
    const chosen = browserSelection && !browserSelection.isCollapsed ? anchor : pendingSelection.current;
    setSelection(chosen);
    setError(chosen ? undefined : "Select text in a paragraph or heading to comment.");
  }
  return <>
    <div className="kh-review-entry kh-reading-column sticky top-0 z-20 flex items-center justify-end gap-2 bg-kh-bg py-2">
      {!open && hasSelection && result?.writesEnabled && !revisionChanged && <Button type="button" variant="soft" aria-label="Comment on selection" onPointerDown={event => event.preventDefault()} onClick={() => { capture(); changeOpen(true); }}><MessageSquarePlus className="size-4" aria-hidden="true" />Comment</Button>}
      <Button ref={entryRef} type="button" variant="ghost" aria-label={`${open ? "Hide discussions" : "Open discussions"}${result ? `, ${result.threads.length} comments` : ""}`} aria-expanded={open} aria-controls="shared-document-discussions" onPointerDown={event => event.preventDefault()} onClick={() => changeOpen(!open)}>
        <MessageSquare className="size-4" aria-hidden="true" />Comments{result && result.threads.length > 0 ? ` (${result.threads.length})` : ""}
      </Button>
    </div>
    {!open && (error || revisionChanged) && <div className="kh-reading-column pb-3">
      {error && <p role="status" className="text-body-sm">{error} <Button type="button" variant="ghost" aria-label="Refresh comments" onClick={() => void load()}><RefreshCw className="size-4" aria-hidden="true" />Retry</Button></p>}
      {revisionChanged && <p role="status" className="text-body-sm">Document changed. Refresh this page before selecting or locating a passage. You can still reply to existing discussions.</p>}
    </div>}
    <div className="kh-shared-document" data-review-ready={result || error ? "" : undefined} data-review-open={open ? "" : undefined} data-review-inline={inline ? "" : undefined}>
      <div ref={readingRef} className="kh-shared-reading">
        {children}
        <ReviewPassageMarkers readingRef={readingRef} markdown={markdown} threads={revisionChanged ? undefined : result?.threads} />
      </div>
      <aside id="shared-document-discussions" className="kh-shared-review-panel" aria-label="Document discussions" onKeyDown={event => { if (!event.defaultPrevented && event.key === "Escape" && reviewRailInline()) changeOpen(false); }}>
    <ReviewPanelShell open={open} inline={inline} onOpenChange={changeOpen} returnFocus={() => entryRef.current?.focus({ preventScroll: true })}><div>
      <div className="kh-review-toolbar">
      <div className="kh-review-rail-heading mb-3 items-center justify-between"><h2 className="text-body font-medium">Comments</h2><Tooltip label="Hide discussions"><Button type="button" variant="ghost" icon aria-label="Collapse discussions" onClick={() => changeOpen(false)}><PanelRightClose className="size-4" aria-hidden="true" /></Button></Tooltip></div>
      {!result && <Tooltip label="Refresh comments"><Button type="button" variant="ghost" icon aria-label="Refresh comments" onClick={() => void load()}><RefreshCw className="size-4" aria-hidden="true" /></Button></Tooltip>}
      {error && <p role="status" className="mt-3 text-body-sm">{error}</p>}
      {result && <div className="mt-3">
        {revisionChanged && <p role="status" className="mb-3 text-body-sm">Document changed. Refresh this page before selecting or locating a passage. You can still reply to existing discussions.</p>}
        <div className="mb-3 flex items-center justify-between gap-2">{result.writesEnabled && !revisionChanged && <Button type="button" variant="soft" onPointerDown={event => event.preventDefault()} onClick={capture} aria-label="Comment on selection"><MessageSquarePlus className="size-4" aria-hidden="true" />Add comment</Button>}<Tooltip label="Refresh comments"><Button type="button" variant="ghost" icon aria-label="Refresh comments" onClick={() => void load()}><RefreshCw className="size-4" aria-hidden="true" /></Button></Tooltip></div>
        {!result.writesEnabled && <p className="mb-3 text-body-sm text-kh-text-muted">{result.callerUserId === null ? "Sign in to add a comment." : "Adding comments is currently disabled."}</p>}
      </div>}
      </div>
      {selection && <div className="kh-review-composer mb-4 border border-kh-border bg-kh-bg p-4"><blockquote className="border-l border-kh-border pl-3 text-body-sm">{selection.exact}</blockquote><ReviewReplyForm label="Add comment" onSubmit={async (body, idempotencyKey) => { const created = await reviewRequest<{ id: string }>("/api/share-review/threads", { token, expectedRevisionId: revisionId, anchor: selection, body, idempotencyKey }); pendingSelection.current = null; setSelection(null); setActiveThreadId(created.id); await load(); }} /><Button type="button" variant="ghost" className="mt-2" onClick={() => { pendingSelection.current = null; setSelection(null); }}>Cancel</Button></div>}
      {result && <ReviewThreadList railMarkdown={revisionChanged ? undefined : markdown} activeThreadId={activeThreadId} onActivate={setActiveThreadId} focusAnchor={revisionChanged ? undefined : anchor => { const root = document.querySelector<HTMLElement>("[data-review-document]"); if (root) focusReviewAnchor(root, markdown, anchor); }} threads={result.threads} writesEnabled={result.writesEnabled} reply={async (threadId, body, idempotencyKey) => { await reviewRequest(`/api/share-review/threads/${threadId}/replies`, { token, body, idempotencyKey }); await load(); }} />}
    </div></ReviewPanelShell>
      </aside>
    </div>
  </>;
}
