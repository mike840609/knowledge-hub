"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { MessageSquarePlus } from "lucide-react";
import type { ReviewAnchor } from "@/modules/knowledge/domain/document-review";
import { reviewBlockAnchor } from "./review-selection";

/** Sibling buttons preserve the Markdown DOM and its canonical comment offsets. */
export function ReviewBlockComment({ readingRef, markdown, chosen, onChoose }: {
  readingRef: RefObject<HTMLDivElement | null>;
  markdown: string;
  chosen: ReviewAnchor | null;
  onChoose: (anchor: ReviewAnchor) => void;
}) {
  const [blocks, setBlocks] = useState<{ element: HTMLElement; anchor: ReviewAnchor; top: number; height: number }[]>([]);
  const selected = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const reading = readingRef.current;
    const article = reading?.querySelector<HTMLElement>("[data-review-document]");
    if (!reading || !article) return;
    const candidates = Array.from(article.querySelectorAll<HTMLElement>("p[data-review-path],li[data-review-para]"))
      .filter(element => element.tagName !== "LI" || !element.querySelector("p[data-review-path]"))
      .flatMap(element => {
        const anchor = reviewBlockAnchor(element, markdown);
        return anchor ? [{ element, anchor }] : [];
      });
    const measure = () => {
      const origin = reading.getBoundingClientRect().top;
      setBlocks(candidates.map(block => {
        const rect = block.element.getBoundingClientRect();
        return { ...block, top: rect.top - origin, height: Math.max(28, rect.height) };
      }));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(article);
    measure();
    return () => observer.disconnect();
  }, [readingRef, markdown]);
  useEffect(() => {
    if (!chosen && selected.current) {
      selected.current.classList.remove("kh-comment-block-selected");
      selected.current = null;
    }
  }, [chosen]);
  useEffect(() => () => { selected.current?.classList.remove("kh-comment-block-selected"); }, [markdown]);
  return <div className="kh-block-comment-controls pointer-events-none absolute inset-0" aria-label="Paragraph comments">
    {blocks.map(({ element, anchor, top, height }) => <div key={anchor.blockPath.join(".")}
      className="kh-block-comment-zone pointer-events-auto absolute right-0 w-8" style={{ top, height }}>
      <button type="button" disabled={!!chosen && chosen.blockPath.join(".") !== anchor.blockPath.join(".")} aria-label={`Comment on paragraph: ${anchor.exact.slice(0, 80)}`}
        className="kh-block-comment-button kh-focus-ring flex size-7 items-center justify-center rounded-sm text-kh-text-muted hover:bg-kh-bg-selected hover:text-kh-selected-text"
        onClick={() => {
          selected.current?.classList.remove("kh-comment-block-selected");
          selected.current = element;
          element.classList.add("kh-comment-block-selected");
          onChoose(anchor);
        }}>
        <MessageSquarePlus className="size-4" aria-hidden="true" />
      </button>
    </div>)}
  </div>;
}
