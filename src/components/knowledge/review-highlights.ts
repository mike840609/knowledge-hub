"use client";
import { useEffect } from "react";
import type { ReviewThreadView, OwnerReviewThreadView } from "@/modules/knowledge/domain/document-review";
import { reviewAnchorRange } from "./review-selection";

/** Native highlights never rewrite Markdown DOM or expose hidden/outdated quotes.
 * Browsers without the Highlight API retain the accessible quote buttons. */
export function useReviewHighlights(markdown: string, threads?: (ReviewThreadView | OwnerReviewThreadView)[]) {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>("[data-review-document]");
    if (!root || !threads) return;
    const ranges = threads.flatMap(thread => {
      if (("visibility" in thread && thread.visibility === "HIDDEN") || thread.currentAnchor.match === "OUTDATED" || !thread.currentAnchor.anchor) return [];
      const range = reviewAnchorRange(root, markdown, thread.currentAnchor.anchor);
      return range ? [{ threadId: thread.id, range }] : [];
    });
    const registry = (globalThis.CSS as typeof CSS & { highlights?: Map<string, unknown> })?.highlights;
    const HighlightClass = (globalThis as typeof globalThis & { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
    if (registry && HighlightClass) registry.set("document-review", new HighlightClass(...ranges.map(item => item.range)));
    function focusDiscussion(event: PointerEvent) {
      if (!window.getSelection()?.isCollapsed) return;
      const target = ranges.find(({range}) => Array.from(range.getClientRects()).some(rect => event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom));
      if (!target) return;
      document.dispatchEvent(new CustomEvent("review-focus-thread", { detail: target.threadId }));
      // The drawer mounts its contents in response to the event.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const sections = Array.from(document.querySelectorAll<HTMLElement>("[data-review-thread]"));
        sections.filter(item => item.dataset.reviewThread === target.threadId).forEach(item => { const details = item.closest("details"); if (details) details.open = true; });
        const section = sections.find(item => item.dataset.reviewThread === target.threadId && item.getClientRects().length > 0);
        if (!section) return;
        const details = section.closest("details"); if (details) details.open = true;
        section.focus({preventScroll:true}); section.scrollIntoView({block:"nearest",behavior:"smooth"});
      }));
    }
    root.addEventListener("pointerup", focusDiscussion);
    return () => { root.removeEventListener("pointerup", focusDiscussion); registry?.delete("document-review"); };
  }, [markdown, threads]);
}
