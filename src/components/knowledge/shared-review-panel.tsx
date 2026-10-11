"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReviewAnchor, ReviewThreadView } from "@/modules/knowledge/domain/document-review";
import { useReviewHighlights } from "./review-highlights";
import { RefreshCw, MessageSquarePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ReviewReplyForm, ReviewThreadList, reviewRequest } from "./review-thread-list";
import { ReviewPanelShell } from "./review-panel-shell";
import { focusReviewAnchor, selectedReviewAnchor } from "./review-selection";

type DiscussionResult = { threads: ReviewThreadView[]; revisionId: string; writesEnabled: boolean; callerUserId: string | null };
export function SharedReviewPanel({ token, revisionId, markdown }: { token: string; revisionId: string; markdown: string }) {
  const [result, setResult] = useState<DiscussionResult>();
  const [error, setError] = useState<string>();
  const revisionChanged = !!result && result.revisionId !== revisionId;
  useReviewHighlights(markdown, revisionChanged ? undefined : result?.threads);
  const pendingSelection = useRef<ReviewAnchor | null>(null);
  const [selection, setSelection] = useState<ReviewAnchor | null>(null);
  const load = useCallback(async () => {
    setError(undefined);
    try { setResult(await reviewRequest<DiscussionResult>("/api/share-review/threads/query", { token })); } catch (failure) { setResult(undefined); setError(failure instanceof Error ? failure.message : "Discussions are unavailable."); }
  }, [token]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { pendingSelection.current = null; setSelection(null); }, [token, revisionId, markdown]);
  useEffect(() => {
    const remember = () => { const root = document.querySelector<HTMLElement>("[data-review-document]"); const anchor = root ? selectedReviewAnchor(root, markdown, window.getSelection()) : null; if (anchor || !window.getSelection()?.isCollapsed) pendingSelection.current = anchor; };
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
  // Too narrow for a rail, this is the bar that opens the drawer. It goes above the document and stays at
  // the top of the window: after the document, a reader met it only on reaching the end.
  return <aside className="min-w-0 max-[1199px]:sticky max-[1199px]:top-0 max-[1199px]:z-10 max-[1199px]:order-first max-[1199px]:w-full max-[1199px]:border-b max-[1199px]:border-kh-border max-[1199px]:bg-kh-bg min-[1200px]:sticky min-[1200px]:top-4 min-[1200px]:w-80 min-[1200px]:shrink-0 min-[1200px]:px-4 min-[1200px]:pb-6" aria-label="Document discussions">
    <ReviewPanelShell><div>
      <div className={`mb-3 flex items-center justify-between ${result ? "max-[1199px]:hidden" : ""}`}><h2 className="text-body font-semibold max-[1199px]:sr-only">Comments</h2>{!result && <Button type="button" variant="ghost" icon aria-label="Refresh discussions" title="Refresh comments" onClick={() => void load()}><RefreshCw className="size-4" aria-hidden="true" /></Button>}</div>
      {error && <p role="status" className="mt-3 text-body-sm">{error}</p>}
      {result && <div className="mt-3">
        {revisionChanged && <p role="status" className="mb-3 text-body-sm">Document changed. Refresh this page before selecting or locating a passage.</p>}
        <div className="mb-3 flex items-center justify-between gap-2">{result.writesEnabled && !revisionChanged && <Button type="button" variant="soft" onPointerDown={event => event.preventDefault()} onClick={capture} aria-label="Comment on selection"><MessageSquarePlus className="size-4" aria-hidden="true" />Add comment</Button>}<Button type="button" variant="ghost" icon aria-label="Refresh discussions" title="Refresh comments" onClick={() => void load()}><RefreshCw className="size-4" aria-hidden="true" /></Button></div>{selection && <div className="mb-4"><blockquote className="border-l-2 border-kh-border pl-3 text-body-sm">{selection.exact}</blockquote><ReviewReplyForm label="Add comment" onSubmit={async (body, idempotencyKey) => { await reviewRequest("/api/share-review/threads", { token, expectedRevisionId: revisionId, anchor: selection, body, idempotencyKey }); pendingSelection.current = null; setSelection(null); await load(); }} /></div>}
        {!result.writesEnabled && <p className="mb-3 text-body-sm text-kh-text-muted">{result.callerUserId === null ? "Sign in to add a comment." : "Adding comments is currently disabled."}</p>}
        <ReviewThreadList focusAnchor={revisionChanged ? undefined : anchor => { const root = document.querySelector<HTMLElement>("[data-review-document]"); if (root) focusReviewAnchor(root, markdown, anchor); }} threads={result.threads} writesEnabled={result.writesEnabled} reply={async (threadId, body, idempotencyKey) => { await reviewRequest(`/api/share-review/threads/${threadId}/replies`, { token, body, idempotencyKey }); await load(); }} />
      </div>}
    </div></ReviewPanelShell>
  </aside>;
}
