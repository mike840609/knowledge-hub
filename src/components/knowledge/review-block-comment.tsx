"use client";
import { useReviewDomVersion } from "./review-dom-version";

import { useEffect, useRef, useState, type RefObject } from "react";
import { MessageSquarePlus } from "lucide-react";
import type { ReviewAnchor } from "@/modules/knowledge/domain/document-review";
import { reviewBlockAnchor } from "./review-selection";

/** Review styling inside the editor is owned by its decoration plugin. */
export function setReviewBlockSelected(element: HTMLElement, selected: boolean) {
  const editor = element.closest<HTMLElement>('[contenteditable="true"]');
  const event = new CustomEvent("kh:review-block-selected", { cancelable: true, detail: { element, selected } });
  if (!editor || editor.dispatchEvent(event)) element.classList.toggle("kh-comment-block-selected", selected);
}

/** A comment button beside each paragraph, in the reading column's own right padding: the article
 * keeps its width and nothing moves when they arrive. Siblings of the article, so the Markdown DOM
 * and its canonical comment offsets are untouched. */
export function ReviewBlockComment({ readingRef, markdown, chosen, onChoose }: {
  readingRef: RefObject<HTMLDivElement | null>;
  markdown: string;
  chosen: ReviewAnchor | null;
  onChoose: (anchor: ReviewAnchor) => void;
}) {
  const domVersion = useReviewDomVersion();
  const [blocks, setBlocks] = useState<{ element: HTMLElement; anchor: ReviewAnchor; top: number; height: number }[]>([]);
  const selected = useRef<HTMLElement | null>(null);
  const [hovered, setHovered] = useState<HTMLElement | null>(null);
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
      // A paragraph in a closed disclosure has no box: no button for what is not on screen.
      setBlocks(candidates.filter(block => !block.element.closest("details:not([open])")).map(block => {
        const rect = block.element.getBoundingClientRect();
        return { ...block, top: rect.top - origin, height: Math.max(24, rect.height) };
      }));
    };
    // The button of the paragraph under the pointer shows; it is beside the paragraph, not in it.
    const point = (event: PointerEvent) => setHovered((event.target as Element).closest<HTMLElement>("p[data-review-path],li[data-review-para]"));
    article.addEventListener("pointerover", point);
    const observer = new ResizeObserver(measure);
    observer.observe(article);
    measure();
    return () => { observer.disconnect(); article.removeEventListener("pointerover", point); };
  }, [readingRef, markdown, domVersion]);
  useEffect(() => {
    if (!chosen && selected.current) {
      setReviewBlockSelected(selected.current, false);
      selected.current = null;
    }
  }, [chosen]);
  useEffect(() => () => { if (selected.current) setReviewBlockSelected(selected.current, false); }, [markdown]);
  return <div className="kh-block-comment-controls pointer-events-none absolute inset-0" aria-label="Paragraph comments">
    {blocks.map(({ element, anchor, top, height }) => <div key={anchor.blockPath.join(".")}
      className="kh-block-comment-zone pointer-events-auto absolute" data-hovered={hovered === element ? "" : undefined} style={{ top, height }}>
      <button type="button" disabled={!!chosen && chosen.blockPath.join(".") !== anchor.blockPath.join(".")} aria-label={`Comment on paragraph: ${anchor.exact.slice(0, 80)}`}
        className="kh-block-comment-button kh-focus-ring flex size-6 items-center justify-center rounded-sm text-kh-text-muted hover:bg-kh-bg-selected hover:text-kh-selected-text"
        onClick={() => {
          if (selected.current) setReviewBlockSelected(selected.current, false);
          selected.current = element;
          setReviewBlockSelected(element, true);
          onChoose(anchor);
        }}>
        <MessageSquarePlus className="size-4" aria-hidden="true" />
      </button>
    </div>)}
  </div>;
}
