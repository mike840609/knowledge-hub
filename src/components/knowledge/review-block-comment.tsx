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
  /** The anchor for the pressed paragraph. True paints the whole paragraph; false leaves
   * the narrowed selection, which the browser already shows, as the only highlight. */
  onChoose: (anchor: ReviewAnchor, element: HTMLElement) => boolean;
}) {
  const domVersion = useReviewDomVersion();
  const [blocks, setBlocks] = useState<{ element: HTMLElement; anchor: ReviewAnchor; top: number; height: number }[]>([]);
  const selected = useRef<HTMLElement | null>(null);
  const [hovered, setHovered] = useState<HTMLElement | null>(null);
  // One tab stop for all of them (a roving tabindex): a long document's paragraphs would otherwise
  // be as many stops between the article and what follows it. The arrows move between them.
  const [current, setCurrent] = useState<string>();
  const buttons = useRef(new Map<string, HTMLButtonElement>());
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
    const paragraphAt = (event: PointerEvent) => event.target instanceof Element
      ? event.target.closest<HTMLElement>("p[data-review-path],li[data-review-para]") : null;
    // The button stands beside its paragraph, not on it: crossing the gap to it must not take it
    // away. A pointer keeps the last paragraph it was over until it is over another, or leaves.
    const point = (event: PointerEvent) => {
      const paragraph = event.pointerType !== "touch" && event.pointerType !== "pen" ? paragraphAt(event) : null;
      if (paragraph) setHovered(paragraph);
    };
    const leave = (event: PointerEvent) => { if (event.pointerType !== "touch" && event.pointerType !== "pen") setHovered(null); };
    let pending: { pointerId: number; x: number; y: number; element: HTMLElement | null } | null = null;
    let revealTimer: number | undefined;
    const touchDown = (event: PointerEvent) => {
      if (event.pointerType !== "touch" && event.pointerType !== "pen") return;
      window.clearTimeout(revealTimer);
      pending = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, element: paragraphAt(event) };
    };
    const touchMove = (event: PointerEvent) => {
      if (pending && event.pointerId === pending.pointerId && Math.hypot(event.clientX - pending.x, event.clientY - pending.y) > 10) pending = null;
    };
    const touchCancel = (event: PointerEvent) => { if (pending?.pointerId === event.pointerId) pending = null; };
    const touchUp = (event: PointerEvent) => {
      if (!pending || event.pointerId !== pending.pointerId) return;
      const element = pending.element;
      pending = null;
      // Let the original tap and its click finish before revealing a control under it.
      revealTimer = window.setTimeout(() => { if (element?.isConnected) setHovered(element); }, 0);
    };
    article.addEventListener("pointerover", point);
    reading.addEventListener("pointerleave", leave);
    article.addEventListener("pointerdown", touchDown);
    window.addEventListener("pointermove", touchMove, true);
    window.addEventListener("pointerup", touchUp, true);
    window.addEventListener("pointercancel", touchCancel, true);
    const observer = new ResizeObserver(measure);
    observer.observe(article);
    measure();
    return () => {
      observer.disconnect();
      window.clearTimeout(revealTimer);
      article.removeEventListener("pointerover", point);
      reading.removeEventListener("pointerleave", leave);
      article.removeEventListener("pointerdown", touchDown);
      window.removeEventListener("pointermove", touchMove, true);
      window.removeEventListener("pointerup", touchUp, true);
      window.removeEventListener("pointercancel", touchCancel, true);
    };
  }, [readingRef, markdown, domVersion]);
  useEffect(() => {
    if (!chosen && selected.current) {
      setReviewBlockSelected(selected.current, false);
      selected.current = null;
    }
  }, [chosen]);
  useEffect(() => () => { if (selected.current) setReviewBlockSelected(selected.current, false); }, [markdown]);
  const keyOf = (anchor: ReviewAnchor) => anchor.blockPath.join(".");
  const enabled = blocks.filter(({ anchor }) => !chosen || keyOf(chosen) === keyOf(anchor)).map(({ anchor }) => keyOf(anchor));
  // The stop is the last one focused, while it can take focus; else the first that can.
  const stop = current && enabled.includes(current) ? current : enabled[0];
  const move = (key: string | undefined) => { if (!key) return; setCurrent(key); buttons.current.get(key)?.focus(); };
  return <div className="kh-block-comment-controls pointer-events-none absolute inset-0" role={blocks.length ? "toolbar" : undefined} aria-orientation={blocks.length ? "vertical" : undefined} aria-label={blocks.length ? "Paragraph comments" : undefined}
    onKeyDown={event => {
      const at = enabled.indexOf((event.target as HTMLElement).dataset.reviewBlock ?? "");
      if (at < 0) return;
      const next = event.key === "ArrowDown" ? enabled[Math.min(at + 1, enabled.length - 1)] : event.key === "ArrowUp" ? enabled[Math.max(at - 1, 0)]
        : event.key === "Home" ? enabled[0] : event.key === "End" ? enabled[enabled.length - 1] : undefined;
      if (!next) return;
      event.preventDefault();
      move(next);
    }}>
    {blocks.map(({ element, anchor, top, height }) => <div key={keyOf(anchor)}
      className="kh-block-comment-zone absolute" data-hovered={hovered === element ? "" : undefined} style={{ top, height }}>
      <button type="button" ref={button => { if (button) buttons.current.set(keyOf(anchor), button); else buttons.current.delete(keyOf(anchor)); }} data-review-block={keyOf(anchor)}
        tabIndex={keyOf(anchor) === stop ? 0 : -1} onFocus={() => setCurrent(keyOf(anchor))}
        disabled={!!chosen && keyOf(chosen) !== keyOf(anchor)} aria-label={`Comment on paragraph: ${anchor.exact.slice(0, 80)}`}
        className="kh-block-comment-button kh-focus-ring flex size-6 items-center justify-center rounded-sm text-kh-text-muted hover:bg-kh-bg-selected hover:text-kh-selected-text"
        onPointerDown={event => event.preventDefault()}
        onClick={() => {
          if (selected.current) setReviewBlockSelected(selected.current, false);
          selected.current = null;
          if (onChoose(anchor, element)) {
            selected.current = element;
            setReviewBlockSelected(element, true);
          }
        }}>
        <MessageSquarePlus className="size-4" aria-hidden="true" />
      </button>
    </div>)}
  </div>;
}
