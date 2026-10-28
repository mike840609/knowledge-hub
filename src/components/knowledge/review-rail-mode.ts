"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { REVIEW_ITEM_PARAGRAPH, REVIEW_PATH } from "@/shared/markdown/remark-review-paths";

const DOCUMENT = ".kh-review-document";

/**
 * Whether discussions are a rail beside the article here, or a drawer over it.
 *
 * The stylesheet decides, and this asks it: `--review-rail` is `inline` where there is room. On a
 * shared page that is a matter of the window; in the workspace it is a matter of the document
 * pane, whose width depends on what else is open beside it — which is why no media query in a
 * script can answer for both.
 */
export function reviewRailInline(): boolean {
  const reviewed = document.querySelector<HTMLElement>(DOCUMENT);
  return !!reviewed && getComputedStyle(reviewed).getPropertyValue("--review-rail").trim() === "inline";
}

/** Calls back when the answer may have changed: the window was resized, or the pane was. */
export function watchReviewRail(onChange: () => void): () => void {
  const pane = document.querySelector<HTMLElement>(DOCUMENT)?.closest<HTMLElement>(".kh-document-pane");
  const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(onChange);
  if (pane) observer?.observe(pane);
  window.addEventListener("resize", onChange);
  return () => {
    observer?.disconnect();
    window.removeEventListener("resize", onChange);
  };
}

export function useReviewRailInline(): boolean {
  const [inline, setInline] = useState(false);
  useEffect(() => {
    const update = () => setInline(reviewRailInline());
    update();
    return watchReviewRail(update);
  }, []);
  return inline;
}

/** As long as `.kh-reading-column`'s margin takes to slide (120ms in globals.css), and a frame over. */
const SETTLE_MS = 200;
const BLOCK = `[${REVIEW_PATH}],li[${REVIEW_ITEM_PARAGRAPH}]`;

/**
 * Opening or closing the rail moves the article under the reader: where the outline gives the rail
 * its place it is drawn above the article instead, the column narrows or widens and its text wraps
 * again; in the workspace pane the column's sliding margin keeps the browser's own scroll anchoring
 * from making up for any of it. Called just before the change: `place` (the paragraph a button
 * beside it was pressed for), else what is selected, else the first block in sight, is held where
 * it is on screen until the column has stopped moving. At the very top of the page with nothing
 * selected nothing is held, so the outline drawn above the article is seen.
 * ponytail: a scroll by the reader in those 200ms is undone; hold on a transitionend if that bites.
 */
export function holdReadingPlace(reading: HTMLElement | null, place?: Element | null): void {
  const article = reading?.querySelector<HTMLElement>("[data-review-document]");
  const scroller = article?.closest<HTMLElement>(".kh-document-pane") ?? document.scrollingElement;
  if (!article || !scroller || !reviewRailInline()) return;
  const selection = window.getSelection();
  const range = selection?.rangeCount && !selection.isCollapsed && article.contains(selection.getRangeAt(0).commonAncestorContainer) ? selection.getRangeAt(0).cloneRange() : null;
  if (!place && !range && scroller.scrollTop < 1) return;
  const sightTop = scroller === document.scrollingElement ? 0 : scroller.getBoundingClientRect().top;
  const anchor = place ?? range ?? Array.from(article.querySelectorAll<HTMLElement>(BLOCK)).find(block => block.getBoundingClientRect().bottom > sightTop);
  if (!anchor) return;
  const before = anchor.getBoundingClientRect().top;
  const start = performance.now();
  const hold = () => {
    const moved = anchor.getBoundingClientRect().top - before;
    if (Math.abs(moved) >= 1) scroller.scrollTop += moved;
    if (performance.now() - start < SETTLE_MS) requestAnimationFrame(hold);
  };
  requestAnimationFrame(hold);
}

/**
 * The rail's open state, set only through what holds the reader's place (`holdReadingPlace`).
 * `holdAt` names the paragraph to hold should the rail open in this frame: a paragraph's button
 * opens it through paths (`changeOpen`, the Drawer's `onOpenChange`) that take no argument for it.
 */
export function useReviewRailOpen(readingRef: RefObject<HTMLElement | null>) {
  const [open, setOpen] = useState(false);
  const current = useRef(open);
  current.current = open;
  const place = useRef<Element | null>(null);
  const change = useCallback((next: boolean) => {
    if (next !== current.current) holdReadingPlace(readingRef.current, place.current);
    place.current = null;
    current.current = next;
    setOpen(next);
  }, [readingRef]);
  const holdAt = useCallback((element: Element) => {
    place.current = element;
    requestAnimationFrame(() => { place.current = null; });
  }, []);
  return [open, change, holdAt] as const;
}
