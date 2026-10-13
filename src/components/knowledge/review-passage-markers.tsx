"use client";

import { useLayoutEffect, useState, type RefObject } from "react";
import { MessageSquare } from "lucide-react";
import type { ReviewThreadView } from "@/modules/knowledge/domain/document-review";
import { createReviewRangeResolver } from "./review-selection";

type Marker = { id: string; count: number; quote: string; top: number };

/**
 * Where a quote is on the page. One inside a closed disclosure has no rectangle of its own — and
 * an empty range reports the top of the viewport, which put its marker wherever that happened to
 * be — so it is placed beside the nearest thing around it that is shown: the disclosure.
 */
function shownTop(range: Range): number {
  const rect = range.getClientRects()[0];
  if (rect) return rect.top;
  let host = range.startContainer.parentElement;
  while (host && host.getClientRects().length === 0) host = host.parentElement;
  return (host ?? document.body).getBoundingClientRect().top;
}

/** Sibling controls leave the rendered Markdown and its canonical offsets untouched. */
export function ReviewPassageMarkers({ readingRef, markdown, threads }: {
  readingRef: RefObject<HTMLDivElement | null>;
  markdown: string;
  threads?: ReviewThreadView[];
}) {
  const [markers, setMarkers] = useState<Marker[]>([]);
  useLayoutEffect(() => {
    const reading = readingRef.current;
    const article = reading?.querySelector<HTMLElement>("[data-review-document]");
    if (!reading || !article || !threads) { setMarkers([]); return; }
    const resolve = createReviewRangeResolver(article, markdown);
    const groups = new Map<string, { id: string; count: number; quote: string; range: Range }>();
    for (const thread of threads) {
      if (thread.currentAnchor.match === "OUTDATED" || !thread.currentAnchor.anchor) continue;
      const anchor = thread.currentAnchor.anchor;
      const range = resolve(anchor);
      if (!range) continue;
      const key = JSON.stringify(anchor.blockPath);
      const existing = groups.get(key);
      if (existing) existing.count++;
      else groups.set(key, { id: thread.id, count: 1, quote: anchor.exact, range });
    }
    let frame = 0;
    const measure = () => {
      const origin = reading.getBoundingClientRect().top;
      const next = Array.from(groups.values()).map(({ range, ...group }) => ({
        ...group, top: Math.round(shownTop(range) - origin - 2),
      }));
      setMarkers(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    const observer = new ResizeObserver(schedule);
    observer.observe(article);
    window.addEventListener("resize", schedule);
    document.fonts?.addEventListener("loadingdone", schedule);
    measure();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", schedule);
      document.fonts?.removeEventListener("loadingdone", schedule);
    };
  }, [readingRef, markdown, threads]);

  return <div className="pointer-events-none absolute inset-0" aria-label="Passage comments">
    {markers.map(marker => <button key={marker.id} type="button" data-review-marker={marker.id}
      aria-label={`${marker.count} ${marker.count === 1 ? "comment" : "comments"} on passage: ${marker.quote.slice(0, 80)}`}
      className="pointer-events-auto absolute right-1 flex h-6 min-w-7 items-center justify-center gap-0.5 rounded-sm text-caption text-kh-text-muted kh-focus-ring hover:bg-kh-bg-selected hover:text-kh-selected-text"
      style={{ top: marker.top }} onClick={() => document.dispatchEvent(new CustomEvent("review-focus-thread", { detail: marker.id }))}>
      <MessageSquare className="size-3" aria-hidden="true" /><span>{marker.count}</span>
    </button>)}
  </div>;
}
