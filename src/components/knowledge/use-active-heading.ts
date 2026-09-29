"use client";

import { useEffect, useState, type RefObject } from "react";

/**
 * A heading inside the document, by its slug. Looked up within the article
 * rather than with `getElementById`: an author's heading "Tree Filter" has the
 * id of the explorer's filter box, and the page-wide lookup would return
 * whichever comes first in the DOM — the explorer — and scroll to it.
 */
export function findHeading(slug: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-document-pane] article [id="${CSS.escape(slug)}"]`);
}

/** How far below the top of the pane a heading counts as "the one being read". */
const READING_LINE = 96;

/**
 * Which heading the reader is in, given each heading's distance from the top
 * of the scroll pane in document order.
 *
 * It is the last heading that has reached the reading line, so a long section
 * stays attributed to its own heading until the next one arrives — a set of
 * "currently visible" headings cannot say that, and goes blank in the middle
 * of any section longer than the pane. Before the first heading has reached
 * the line the first entry is active, and at the very bottom the last one is:
 * a short final section never gets far enough up to cross the line, and would
 * otherwise never be highlighted at all.
 */
export function pickActiveIndex(tops: readonly number[], atBottom: boolean, readingLine = READING_LINE): number {
  if (tops.length === 0) return -1;
  if (atBottom) return tops.length - 1;
  let active = 0;
  for (let index = 0; index < tops.length; index += 1) {
    if (tops[index] <= readingLine) active = index;
    else break;
  }
  return active;
}

/**
 * The slug of the heading the reader is in, for the outline to highlight.
 * The pane is a scroll container of its own rather than the window, so this
 * listens to it (passively, once per frame) instead of using the window.
 */
export function useActiveHeading(slugs: readonly string[], rootRef: RefObject<HTMLElement | null>): string | null {
  const [active, setActive] = useState<string | null>(slugs[0] ?? null);
  const key = slugs.join("\n");

  useEffect(() => {
    const root = rootRef.current;
    if (!root || slugs.length === 0) {
      setActive(null);
      return;
    }
    let frame = 0;
    const measure = () => {
      frame = 0;
      const rootTop = root.getBoundingClientRect().top;
      const tops = slugs.map((slug) => {
        const element = findHeading(slug);
        return element ? element.getBoundingClientRect().top - rootTop : Number.POSITIVE_INFINITY;
      });
      const atBottom = root.scrollTop > 0 && root.scrollTop + root.clientHeight >= root.scrollHeight - 2;
      const index = pickActiveIndex(tops, atBottom);
      setActive(index < 0 ? null : slugs[index]);
    };
    const schedule = () => {
      if (frame === 0) frame = window.requestAnimationFrame(measure);
    };
    measure();
    root.addEventListener("scroll", schedule, { passive: true });
    const resize = new ResizeObserver(schedule);
    resize.observe(root);
    return () => {
      root.removeEventListener("scroll", schedule);
      resize.disconnect();
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
    // `key` stands for `slugs`: the array is rebuilt every render.
  }, [key, rootRef]);

  return active;
}
