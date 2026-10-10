"use client";

import { useCallback, useEffect, useState } from "react";
import type { OwnerReviewThreadView } from "@/modules/knowledge/domain/document-review";
import { useReviewHighlights } from "./review-highlights";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { focusReviewAnchor } from "./review-selection";
import { ReviewThreadList, reviewRequest } from "./review-thread-list";

export function OwnerReviewPanel({ documentId, markdown, revisionId, readOnly = false }: { documentId: string; revisionId: string; markdown: string; readOnly?: boolean }) {
  const [result, setResult] = useState<{ threads: OwnerReviewThreadView[]; writesEnabled: boolean; revisionId: string }>();
  const [error, setError] = useState<string>();
  const revisionChanged = !!result && result.revisionId !== revisionId;
  useReviewHighlights(markdown, revisionChanged ? undefined : result?.threads);
  const base = `/api/documents/${documentId}/review-threads`;
  const load = useCallback(async () => { try { setResult(await reviewRequest(base)); setError(undefined); } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not load discussions."); } }, [base]);
  useEffect(() => { void load(); }, [load]);
  return <aside className="kh-reading-column pb-6" aria-label="Owner document discussions"><details className="border-t border-kh-border pt-4"><summary className="cursor-pointer text-body font-semibold kh-focus-ring">Comments</summary><div className="mt-2 flex justify-end"><Button type="button" variant="ghost" icon aria-label="Refresh discussions" title="Refresh comments" onClick={() => void load()}><RefreshCw className="size-4" aria-hidden="true" /></Button></div>{error && <p role="alert" className="mt-3 text-body-sm">{error}</p>}{result && <div className="mt-3">{revisionChanged && <p role="status" className="mb-3 text-body-sm">Document changed. Refresh this page before locating a passage.</p>}<ReviewThreadList focusAnchor={revisionChanged ? undefined : anchor => { const root = document.querySelector<HTMLElement>("[data-review-document]"); if (root) focusReviewAnchor(root, markdown, anchor); }} threads={result.threads} writesEnabled={result.writesEnabled && !readOnly} canResolve={!readOnly} reply={async (threadId, body, idempotencyKey) => { await reviewRequest(`${base}/${threadId}/replies`, { body, idempotencyKey }); await load(); }} moderate={async (threadId, action, value, commentId) => { const path = commentId ? `${base}/${threadId}/comments/${commentId}/visibility` : `${base}/${threadId}/${action}`; await reviewRequest(path, action === "resolution" ? { status: value } : { visibility: value }); await load(); }} /></div>}</details></aside>;
}
