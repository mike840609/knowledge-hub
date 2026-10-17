"use client";

import { useReviewDomVersion } from "./review-dom-version";
import { useLayoutEffect, useRef, useState } from "react";
import type { ReviewThreadView } from "@/modules/knowledge/domain/document-review";
import { reviewRailInline, watchReviewRail } from "./review-rail-mode";
import { createReviewRangeResolver } from "./review-selection";

type RailItem = { id: string; top: number | null; height: number };
type RailLayout = { positions: Record<string, number>; height: number };
const GAP = 12;

/** Keep document order and avoid collisions, giving the selected passage priority.
 * When there is no room above it, the selected card sits at the nearest feasible position. */
export function positionReviewThreads(items: RailItem[], activeId?: string): RailLayout {
  const tops: number[] = [];
  let bottom = 0;
  for (const item of items) {
    tops.push(Math.max(bottom, item.top ?? bottom));
    bottom = tops[tops.length - 1] + item.height + GAP;
  }
  const active = items.findIndex(item => item.id === activeId && item.top !== null);
  if (active >= 0) {
    tops[active] = Math.max(0, items[active].top!);
    for (let i = active - 1; i >= 0; i--) {
      tops[i] = Math.min(tops[i], tops[i + 1] - GAP - items[i].height);
    }
    const shift = Math.max(0, -tops[0]);
    for (let i = 0; i <= active; i++) tops[i] += shift;
    for (let i = active + 1; i < items.length; i++) {
      tops[i] = Math.max(items[i].top ?? 0, tops[i - 1] + items[i - 1].height + GAP);
    }
  }
  return {
    positions: Object.fromEntries(items.map((item, i) => [item.id, Math.round(tops[i])])),
    height: items.length ? Math.ceil(tops[items.length - 1] + items[items.length - 1].height) : 0,
  };
}

/** What the rail places: a thread, or the new comment being written (`data-review-draft`). */
export type RailCard = Pick<ReviewThreadView, "id" | "currentAnchor">;

export function compareReviewPassages(a: RailCard, b: RailCard) {
  const left = a.currentAnchor.match === "OUTDATED" ? undefined : a.currentAnchor.anchor;
  const right = b.currentAnchor.match === "OUTDATED" ? undefined : b.currentAnchor.anchor;
  if (!left || !right) return left ? -1 : right ? 1 : 0;
  for (let i = 0; i < Math.max(left.blockPath.length, right.blockPath.length); i++) {
    const difference = (left.blockPath[i] ?? -1) - (right.blockPath[i] ?? -1);
    if (difference) return difference;
  }
  return left.startUtf16 - right.startUtf16;
}

/** Measure live ranges, so wrapping, images, replies and font loading cannot stale the rail. */
export function useReviewRailLayout(threads: RailCard[], markdown?: string, activeId?: string) {
  const domVersion = useReviewDomVersion();
  const ref = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<RailLayout>();
  const measureRef = useRef<(() => void) | null>(null);
  // A composer/status insertion can move the list without changing its size.
  // Recheck the origin after every React commit, independently of ResizeObserver.
  useLayoutEffect(() => { measureRef.current?.(); });
  useLayoutEffect(() => {
    const list = ref.current;
    const article = document.querySelector<HTMLElement>("[data-review-document]");
    if (!list || !article || markdown === undefined) {
      setLayout(previous => previous === undefined ? previous : undefined);
      return;
    }
    let frame = 0;
    const cards = Array.from(list.querySelectorAll<HTMLElement>("[data-review-thread], [data-review-draft]"));
    const resolve = createReviewRangeResolver(article, markdown);
    const ranges = new Map(threads.map(thread => [thread.id,
      thread.currentAnchor.match !== "OUTDATED" && thread.currentAnchor.anchor ? resolve(thread.currentAnchor.anchor) : null,
    ]));
    const measure = () => {
      if (!reviewRailInline() || !list.getClientRects().length) {
        setLayout(previous => previous === undefined ? previous : undefined);
        return;
      }
      const listTop = list.getBoundingClientRect().top;
      const items = threads.flatMap(thread => {
        const card = cards.find(element => (element.dataset.reviewThread ?? element.dataset.reviewDraft) === thread.id);
        if (!card) return [];
        const range = ranges.get(thread.id);
        return [{ id: thread.id, top: range ? range.getBoundingClientRect().top - listTop : null, height: card.getBoundingClientRect().height }];
      });
      const next = positionReviewThreads(items, activeId);
      setLayout(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    };
    measureRef.current = measure;
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    const observer = new ResizeObserver(schedule);
    observer.observe(article);
    cards.forEach(card => observer.observe(card));
    // The composer/status/filter above the list can move its origin without resizing a card.
    if (list.parentElement) observer.observe(list.parentElement);
    const unwatch = watchReviewRail(schedule);
    document.fonts?.addEventListener("loadingdone", schedule);
    measure();
    return () => {
      measureRef.current = null;
      cancelAnimationFrame(frame);
      observer.disconnect();
      unwatch();
      document.fonts?.removeEventListener("loadingdone", schedule);
    };
  }, [threads, markdown, activeId, domVersion]);
  return { ref, layout };
}
