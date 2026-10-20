"use client";
import { useReviewDomVersion } from "./review-dom-version";
import { useEffect } from "react";
import type { ReviewThreadView, OwnerReviewThreadView } from "@/modules/knowledge/domain/document-review";
import { EXPAND_CODE_BLOCK } from "./code-block";
import { createReviewRangeResolver } from "./review-selection";
import { reviewRailInline } from "./review-rail-mode";

/** Native highlights never rewrite Markdown DOM or expose hidden/outdated quotes.
 * Browsers without the Highlight API retain the accessible quote buttons. */
export function useReviewHighlights(markdown: string, threads?: (ReviewThreadView | OwnerReviewThreadView)[], activeThreadId?: string) {
  const domVersion = useReviewDomVersion();
  useEffect(() => {
    const root = document.querySelector<HTMLElement>("[data-review-document]");
    if (!root || !threads) return;
    const resolve = createReviewRangeResolver(root, markdown);
    const ranges = threads.flatMap(thread => {
      if (("visibility" in thread && thread.visibility === "HIDDEN") || thread.currentAnchor.match === "OUTDATED" || !thread.currentAnchor.anchor) return [];
      const range = resolve(thread.currentAnchor.anchor);
      return range ? [{ threadId: thread.id, range }] : [];
    });
    // A long code block a comment is on opens whole, as a closed disclosure does for its quote.
    for (const { range } of ranges) range.startContainer.parentElement?.closest("[data-code-block]")?.dispatchEvent(new Event(EXPAND_CODE_BLOCK));
    const registry = (globalThis.CSS as typeof CSS & { highlights?: Map<string, unknown> })?.highlights;
    const HighlightClass = (globalThis as typeof globalThis & { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
    if (registry && HighlightClass) {
      registry.set("document-review", new HighlightClass(...ranges.map(item => item.range)));
      registry.set("document-review-active", new HighlightClass(...ranges.filter(item => item.threadId === activeThreadId).map(item => item.range)));
    }
    function focusDiscussion(event: PointerEvent) {
      // Clicking editable text must place the caret, never transfer focus to a comment card.
      if (event.target instanceof Element && event.target.closest('[contenteditable="true"]')) return;
      if (!window.getSelection()?.isCollapsed) return;
      const candidates = ranges.filter(({range}) => Array.from(range.getClientRects()).some(rect => event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom));
      const target = candidates.find(item => item.threadId === activeThreadId) ?? candidates[0];
      if (!target) return;
      document.dispatchEvent(new CustomEvent("review-focus-thread", { detail: target.threadId }));
      // The drawer mounts its contents in response to the event.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const sections = Array.from(document.querySelectorAll<HTMLElement>("[data-review-thread]"));
        sections.filter(item => item.dataset.reviewThread === target.threadId).forEach(item => { const details = item.closest("details"); if (details) details.open = true; });
        const section = sections.find(item => item.dataset.reviewThread === target.threadId && item.getClientRects().length > 0);
        if (!section) return;
        const details = section.closest("details"); if (details) details.open = true;
        if (section.closest("[data-review-rail]")) return; // Shared shell owns its focus handoff.
        section.focus({preventScroll:true});
        // The desktop card is placed beside this passage. Scrolling it into view can move
        // the very text the reader just clicked; only the drawer/owner list needs scrolling.
        if (!section.closest("[data-review-rail]") || !reviewRailInline()) section.scrollIntoView({block:"nearest",behavior:"smooth"});
      }));
    }
    root.addEventListener("pointerup", focusDiscussion);
    return () => { root.removeEventListener("pointerup", focusDiscussion); registry?.delete("document-review"); registry?.delete("document-review-active"); };
  }, [markdown, threads, activeThreadId, domVersion]);
}
