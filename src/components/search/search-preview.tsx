"use client";

import { FileText } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ComponentType, type MouseEvent } from "react";
import type { MarkdownRenderer as MarkdownRendererType } from "@/components/knowledge/markdown-renderer";
import { NOT_TEXT } from "@/components/knowledge/not-text";
import { Skeleton } from "@/components/ui/skeleton";
import { markdownOpensWithHeading } from "@/lib/markdown-title";
import { highlightSnippet } from "@/modules/knowledge/domain/search-query";

type Preview = { title: string; markdown: string };
type Shown = { id: string; preview: Preview | null; failed: boolean };
type Renderer = ComponentType<Parameters<typeof MarkdownRendererType>[0]>;

const HIGHLIGHT = "search-preview";
/** Arrow keys held down pass over rows faster than this; only the row that is stopped on is fetched. */
const PREVIEW_DELAY_MS = 120;
/** A link that leaves for another app (mail, phone) rather than another page. */
const OTHER_APP = /^(?!https?:)[a-z][a-z0-9+.-]*:/i;

/**
 * The ⌘K palette's right column: the active result's document, read through the same peek route the side
 * peek uses (so the same read authorization), with the query's terms marked and the first one scrolled to.
 * Terms are marked with the CSS Custom Highlight API rather than by wrapping text in `<mark>`: the article is
 * React's DOM, and the highlight is drawn over it without touching it.
 *
 * The palette is on every workspace page, the reader's renderer (Markdown, highlighter, diagrams) is not:
 * it is imported when a preview is first mounted, so it stays out of every page's first load.
 */
export function SearchPreview({ documentId, terms, onLeave }: { documentId: string | null; terms: readonly string[]; onLeave: () => void }) {
  const cache = useRef(new Map<string, Preview>());
  const [shown, setShown] = useState<Shown | null>(null);
  const [Renderer, setRenderer] = useState<Renderer | null>(null);
  // A chunk that cannot load (a page older than the latest deploy) would otherwise leave the pane loading.
  const [rendererFailed, setRendererFailed] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    void import("@/components/knowledge/markdown-renderer").then((module) => {
      if (live) setRenderer(() => module.MarkdownRenderer);
    }).catch(() => {
      if (live) setRendererFailed(true);
    });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    if (!documentId || cache.current.has(documentId)) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        // `?brief`: title and Markdown only, without the breadcrumb and header facts the side peek needs.
        const response = await fetch(`/api/documents/${encodeURIComponent(documentId)}/peek?brief`, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error("Preview unavailable");
        const { title, markdown } = await response.json() as Preview;
        cache.current.set(documentId, { title, markdown });
        setShown({ id: documentId, preview: { title, markdown }, failed: false });
      } catch {
        if (!controller.signal.aborted) setShown({ id: documentId, preview: null, failed: true });
      }
    }, PREVIEW_DELAY_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [documentId]);

  // Only what answers the row now selected; anything else is still loading, never the previous document.
  // A cached document is there at once. One object per arrival, so a document shown again is marked again.
  const cached = documentId ? cache.current.get(documentId) : undefined;
  const current = useMemo<Shown | null>(() => {
    if (!documentId) return null;
    if (cached) return { id: documentId, preview: cached, failed: false };
    return shown?.id === documentId ? shown : null;
  }, [documentId, cached, shown]);
  const preview = current?.preview ?? null;

  useEffect(() => {
    const body = bodyRef.current;
    if (!body || !current?.preview || !Renderer) return;
    const ranges = termRanges(body, terms);
    scrollToFirstShown(body, ranges);
    if (!supportsHighlights()) return;
    CSS.highlights.set(HIGHLIGHT, new Highlight(...ranges));
    return () => { CSS.highlights.delete(HIGHLIGHT); };
  }, [current, terms, Renderer]);

  // An in-page anchor scrolls the preview. A link opened elsewhere — a new tab, a modified click, another
  // app — leaves everything as it is. Any other link navigates, and the palette closes first rather than
  // staying on top of the page it leads to.
  const onClickCapture = (event: MouseEvent<HTMLDivElement>) => {
    const anchor = (event.target as Element).closest?.("a[href]");
    if (!anchor) return;
    const href = anchor.getAttribute("href") ?? "";
    if (href.startsWith("#")) {
      event.preventDefault();
      const id = decodeURIComponentSafe(href.slice(1));
      [...(bodyRef.current?.querySelectorAll("[id]") ?? [])].find((element) => element.id === id)?.scrollIntoView?.({ block: "start" });
      return;
    }
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (anchor.getAttribute("target") === "_blank" || OTHER_APP.test(href)) return;
    onLeave();
  };

  return (
    <div
      ref={bodyRef}
      aria-label="Document preview"
      role="region"
      tabIndex={0}
      onClickCapture={onClickCapture}
      className="kh-focus-ring h-full overflow-y-auto px-6 py-5 ring-inset"
    >
      {!documentId ? (
        <div className="flex h-full flex-col items-center justify-center gap-2 text-body text-kh-text-muted">
          <FileText size={20} aria-hidden="true" />
          <p>Select a document to preview</p>
        </div>
      ) : current?.failed || rendererFailed ? (
        <p className="text-body text-kh-text-muted">This document cannot be previewed.</p>
      ) : preview && Renderer ? (
        <>
          {/* The same size as a document's own H1, which most documents open with. */}
          {markdownOpensWithHeading(preview.markdown) ? null : <h2 className="mb-4 text-page-title font-semibold text-kh-text">{preview.title}</h2>}
          <Renderer markdown={preview.markdown} unresolvedAsText />
        </>
      ) : (
        <>
          <p role="status" className="sr-only">Loading preview</p>
          <div aria-hidden="true" className="space-y-3">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
          </div>
        </>
      )}
    </div>
  );
}

function supportsHighlights(): boolean {
  return typeof CSS !== "undefined" && "highlights" in CSS && typeof Highlight !== "undefined";
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Centres the first match that is laid out (not in `display: none` text) by the match's own box, not its
 * paragraph's: a paragraph taller than the pane would put the term out of view. With none, the top.
 */
function scrollToFirstShown(body: HTMLElement, ranges: readonly Range[]): void {
  const range = ranges.find((candidate) => typeof candidate.getClientRects === "function" && candidate.getClientRects().length > 0);
  if (!range) {
    body.scrollTop = 0;
    return;
  }
  const box = range.getBoundingClientRect();
  const pane = body.getBoundingClientRect();
  body.scrollTop += box.top - pane.top - (body.clientHeight - box.height) / 2;
}

/** Text a reader sees: not screen-reader-only or hidden text, nor the body of a closed `<details>`. */
function visible(node: Node): boolean {
  const parent = node.parentElement;
  if (!parent) return true;
  if (parent.closest(NOT_TEXT)) return false;
  return !(parent.closest("details:not([open])") && !parent.closest("summary"));
}

/** Every visible match of the terms in the rendered text, matched as the result snippets are (`highlightSnippet`). */
export function termRanges(root: Node, terms: readonly string[]): Range[] {
  if (terms.length === 0) return [];
  const ranges: Range[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => (visible(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent ?? "";
    // `highlightSnippet` finds matches in the lower-cased text; where lower-casing changes the length (İ),
    // its offsets would mark the wrong characters, so such a text is left unmarked.
    if (text.toLowerCase().length !== text.length) continue;
    let offset = 0;
    for (const segment of highlightSnippet(text, terms)) {
      if (segment.match) {
        const range = document.createRange();
        range.setStart(node, offset);
        range.setEnd(node, offset + segment.text.length);
        ranges.push(range);
      }
      offset += segment.text.length;
    }
  }
  return ranges;
}
