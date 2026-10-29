"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { LogIn, MessageSquarePlus } from "lucide-react";
import type { ReviewAnchor } from "@/modules/knowledge/domain/document-review";
import { Button, buttonClasses } from "@/components/ui/button";
import { readReviewSelection, REVIEW_SELECTION_HINTS } from "./review-selection";
import { ReviewReplyForm } from "./review-thread-list";
import type { MentionScope } from "./mention-autocomplete";

/** How long a selection must rest before it is remarked on: one being dragged out passes through many that cannot take a comment. */
const HINT_DELAY_MS = 400;

/**
 * The passage a new discussion would be about, as the reader selects it in the article under
 * `readingRef`.
 *
 * `ready` is whether what is selected now can take a comment, and `hint` what to say when it
 * cannot — a selection that goes nowhere, with no word why, reads as a feature that is broken.
 * `capture` takes the selection for the composer; `chosen` is what it took. `place` is where the
 * selection's first line is, in the reading box, for the button that floats beside it.
 */
export function useReviewSelection(readingRef: RefObject<HTMLElement | null>, markdown: string, resetKey: string, preserveChosen = false) {
  // What was last selected, kept while the selection is empty: pressing a button may empty it.
  const pending = useRef<ReviewAnchor | null>(null);
  const [ready, setReady] = useState(false);
  const [hint, setHint] = useState<string>();
  const [chosen, setChosen] = useState<ReviewAnchor | null>(null);
  const [refusal, setRefusal] = useState<string>();
  const [place, setPlace] = useState<SelectionPlace | null>(null);
  const read = useCallback(() => {
    const root = readingRef.current?.querySelector<HTMLElement>("[data-review-document]");
    return root ? readReviewSelection(root, markdown, window.getSelection()) : { problem: "none" as const };
  }, [readingRef, markdown]);
  const clear = useCallback(() => { pending.current = null; setChosen(null); setRefusal(undefined); }, []);
  useEffect(clear, [clear, resetKey]);
  useEffect(() => { if (!preserveChosen) clear(); }, [clear, markdown, preserveChosen]);
  useEffect(() => {
    let timer = 0;
    const remember = () => {
      const reading = read();
      window.clearTimeout(timer);
      setPlace(placeOf(readingRef.current, window.getSelection()));
      setReady(!!reading.anchor);
      setHint(undefined);
      if (reading.anchor || !window.getSelection()?.isCollapsed) pending.current = reading.anchor ?? null;
      if (reading.problem && reading.problem !== "none") {
        const said = REVIEW_SELECTION_HINTS[reading.problem];
        timer = window.setTimeout(() => setHint(said), HINT_DELAY_MS);
      }
    };
    document.addEventListener("selectionchange", remember);
    // The selected DOM can be created before a concurrent edit updates the Markdown prop. Recheck
    // it when the reader catches up, even if the browser has already delivered selectionchange.
    remember();
    return () => { window.clearTimeout(timer); document.removeEventListener("selectionchange", remember); };
  }, [read, readingRef]);
  const capture = useCallback(() => {
    const reading = read();
    const anchor = window.getSelection()?.isCollapsed === false ? reading.anchor ?? null : pending.current;
    setChosen(anchor);
    setRefusal(anchor ? undefined : reading.problem && reading.problem !== "none" ? REVIEW_SELECTION_HINTS[reading.problem] : "Select text in the document to comment.");
    return anchor;
  }, [read]);
  const choose = useCallback((anchor: ReviewAnchor) => { pending.current = anchor; setChosen(anchor); setRefusal(undefined); }, []);
  return { ready, hint, chosen, refusal, place, capture, clear, choose };
}

type SelectionPlace = { top: number; bottom: number; left: number };
/** The selection's first line, relative to the reading box; null when nothing in it is selected.
 * ponytail: measured on selectionchange only; a reflow while it is selected leaves it until the next change. */
function placeOf(box: HTMLElement | null, selection: Selection | null): SelectionPlace | null {
  if (!box || !selection || selection.isCollapsed || !selection.rangeCount) return null;
  const range = selection.getRangeAt(0);
  if (!box.contains(range.commonAncestorContainer)) return null;
  const line = range.getClientRects()[0] ?? range.getBoundingClientRect();
  const origin = box.getBoundingClientRect();
  return { top: line.top - origin.top, bottom: line.bottom - origin.top, left: line.left - origin.left };
}

/**
 * Beside what is selected: the way to comment on it, or why it cannot take a comment. Above its
 * first line, or below it where the line is at the top of the article. The selection stays: the
 * button takes no focus from a pointer.
 */
/** `signInHref`: the reader may not comment yet; a chosen passage offers sign-in in place of Comment. */
export function ReviewSelectionBubble({ place, ready, hint, onComment, signInHref }: { place: SelectionPlace | null; ready: boolean; hint?: string; onComment: () => void; signInHref?: string }) {
  if (!place || (!ready && !hint)) return null;
  const above = place.top >= 40;
  const style = { top: above ? place.top - 8 : place.bottom + 8, left: Math.max(0, place.left), transform: above ? "translateY(-100%)" : undefined };
  return <div className="kh-selection-bubble absolute z-20 rounded-md border border-kh-border bg-kh-bg shadow-popover" style={style}>
    {ready && signInHref
      ? <a href={signInHref} className={buttonClasses({ variant: "ghost" })} onPointerDown={event => event.preventDefault()}><LogIn className="size-4" aria-hidden="true" />Sign in to comment</a>
      : ready
      ? <Button type="button" variant="ghost" aria-label="Comment on selection" onPointerDown={event => event.preventDefault()} onClick={onComment}><MessageSquarePlus className="size-4" aria-hidden="true" />Comment</Button>
      : <p role="status" className="max-w-xs px-3 py-2 text-body-sm text-kh-text-muted">{hint}</p>}
  </div>;
}

/** The passage chosen, and the first thing said about it. */
export function ReviewComposer({ anchor, onSubmit, onCancel, pending = false, saveError, onRetrySave, cancelOnEscape = false, draftKey, restored = false, mentionScope }: { anchor: ReviewAnchor; onSubmit: (body: string, idempotencyKey: string, mentions: string[], mentionLinkId?: string) => Promise<void>; onCancel: () => void; pending?: boolean; saveError?: string; onRetrySave?: () => void; cancelOnEscape?: boolean; /** Keeps the unsent text (`reviewDraftKey`). */ draftKey?: string; /** Brought back from an earlier visit: the passage may have changed since. */ restored?: boolean; /** Offers the `@` list. */ mentionScope?: MentionScope }) {
  return <div className="kh-review-composer mb-4 border border-kh-border bg-kh-bg p-4">
    {/* Code keeps its lines; anything else wraps as it would have. */}
    <blockquote className={`line-clamp-6 border-l border-kh-border pl-3 text-body-sm ${anchor.blockKind === "code" ? "whitespace-pre-wrap break-words font-mono" : ""}`}>{anchor.exact}</blockquote>
    {restored && <p role="status" className="mt-3 text-body-sm text-kh-text-muted">Restored your unsent comment. Check the quoted passage before sending.</p>}
    {pending && <p role="status" className="mt-3 text-body-sm text-kh-text-muted">Saving document before commenting…</p>}
    {saveError && <div className="mt-3"><p role="alert" className="text-body-sm">{saveError}</p>{onRetrySave && <Button type="button" variant="link" onClick={onRetrySave}>Retry document save</Button>}</div>}
    <ReviewReplyForm label="Add comment" draftKey={draftKey} mentionScope={mentionScope} onSubmit={onSubmit} onCancel={onCancel} cancelOnEscape={cancelOnEscape} submitDisabled={pending || !!saveError} />
  </div>;
}
