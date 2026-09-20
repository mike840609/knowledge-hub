"use client";

import { useEffect, type RefObject } from "react";

/**
 * Where each view was last scrolled to. Module-level so the positions survive
 * navigation between views, and bounded so a long session does not accumulate
 * an entry per document ever opened.
 */
const positions = new Map<string, number>();
const LIMIT = 50;

function remember(key: string, top: number): void {
  // Re-inserting moves the key to the end, so the eviction below drops the
  // least recently scrolled view rather than the oldest one opened.
  positions.delete(key);
  positions.set(key, top);
  if (positions.size > LIMIT) {
    const oldest = positions.keys().next();
    if (!oldest.done) positions.delete(oldest.value);
  }
}

/**
 * Restores a scroll container to where this view left it, instead of always
 * starting at the top. Going somewhere new still starts at the top; a hash
 * target is left alone so in-page anchors keep working.
 */
export function useScrollRestoration(ref: RefObject<HTMLElement | null>, key: string): void {
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (window.location.hash) return;

    const top = positions.get(key) ?? 0;
    if (top > 0) element.scrollTo({ top });

    // Recording on scroll rather than on unmount: a detached element reports
    // scrollTop 0, which would overwrite the position with the wrong value.
    const record = () => remember(key, element.scrollTop);
    element.addEventListener("scroll", record, { passive: true });
    return () => element.removeEventListener("scroll", record);
  }, [ref, key]);
}
