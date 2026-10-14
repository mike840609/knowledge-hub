"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { ReviewAnchor } from "@/modules/knowledge/domain/document-review";
import { Button } from "@/components/ui/button";
import { readReviewSelection, REVIEW_SELECTION_HINTS } from "./review-selection";
import { ReviewReplyForm } from "./review-thread-list";

/** How long a selection must rest before it is remarked on: one being dragged out passes through many that cannot take a comment. */
const HINT_DELAY_MS = 400;

/**
 * The passage a new discussion would be about, as the reader selects it in the article under
 * `readingRef`.
 *
 * `ready` is whether what is selected now can take a comment, and `hint` what to say when it
 * cannot — a selection that goes nowhere, with no word why, reads as a feature that is broken.
 * `capture` takes the selection for the composer; `chosen` is what it took.
 */
export function useReviewSelection(readingRef: RefObject<HTMLElement | null>, markdown: string, resetKey: string) {
  // What was last selected, kept while the selection is empty: pressing a button may empty it.
  const pending = useRef<ReviewAnchor | null>(null);
  const [ready, setReady] = useState(false);
  const [hint, setHint] = useState<string>();
  const [chosen, setChosen] = useState<ReviewAnchor | null>(null);
  const [refusal, setRefusal] = useState<string>();
  const read = useCallback(() => {
    const root = readingRef.current?.querySelector<HTMLElement>("[data-review-document]");
    return root ? readReviewSelection(root, markdown, window.getSelection()) : { problem: "none" as const };
  }, [readingRef, markdown]);
  const clear = useCallback(() => { pending.current = null; setChosen(null); setRefusal(undefined); }, []);
  useEffect(clear, [clear, resetKey, markdown]);
  useEffect(() => {
    let timer = 0;
    const remember = () => {
      const reading = read();
      window.clearTimeout(timer);
      setReady(!!reading.anchor);
      setHint(undefined);
      if (reading.anchor || !window.getSelection()?.isCollapsed) pending.current = reading.anchor ?? null;
      if (reading.problem && reading.problem !== "none") {
        const said = REVIEW_SELECTION_HINTS[reading.problem];
        timer = window.setTimeout(() => setHint(said), HINT_DELAY_MS);
      }
    };
    document.addEventListener("selectionchange", remember);
    return () => { window.clearTimeout(timer); document.removeEventListener("selectionchange", remember); };
  }, [read]);
  const capture = useCallback(() => {
    const reading = read();
    const anchor = window.getSelection()?.isCollapsed === false ? reading.anchor ?? null : pending.current;
    setChosen(anchor);
    setRefusal(anchor ? undefined : reading.problem && reading.problem !== "none" ? REVIEW_SELECTION_HINTS[reading.problem] : "Select text in the document to comment.");
    return anchor;
  }, [read]);
  const choose = useCallback((anchor: ReviewAnchor) => { pending.current = anchor; setChosen(anchor); setRefusal(undefined); }, []);
  return { ready, hint, chosen, refusal, capture, clear, choose };
}

/** The passage chosen, and the first thing said about it. */
export function ReviewComposer({ anchor, onSubmit, onCancel }: { anchor: ReviewAnchor; onSubmit: (body: string, idempotencyKey: string) => Promise<void>; onCancel: () => void }) {
  return <div className="kh-review-composer mb-4 border border-kh-border bg-kh-bg p-4">
    {/* Code keeps its lines; anything else wraps as it would have. */}
    <blockquote className={`line-clamp-6 border-l border-kh-border pl-3 text-body-sm ${anchor.blockKind === "code" ? "whitespace-pre-wrap break-words font-mono" : ""}`}>{anchor.exact}</blockquote>
    <ReviewReplyForm label="Add comment" onSubmit={onSubmit} />
    <Button type="button" variant="ghost" className="mt-2" onClick={onCancel}>Cancel</Button>
  </div>;
}
