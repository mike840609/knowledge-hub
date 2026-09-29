"use client";

import type { MouseEvent } from "react";
import type { OutlineEntry } from "@/shared/markdown/outline";
import { findHeading } from "./use-active-heading";

/** One step of indent per outline level. Geometry that depends on data, so it is a style rather than a class. */
function indent(level: number): { paddingLeft: string } {
  return { paddingLeft: `${0.75 + level * 0.625}rem` };
}

function reduceMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Takes the reader to a heading. The link's own `href` is the fallback — it
 * works with scripts off and from "open in new tab" — this only adds the
 * smooth scroll and keeps the address in step without adding a history entry
 * per click, so Back leaves the document instead of walking its headings.
 */
function goToHeading(event: MouseEvent<HTMLAnchorElement>, slug: string, onNavigate?: () => void): void {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const target = findHeading(slug);
  if (!target) return;
  event.preventDefault();
  target.scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth", block: "start" });
  window.history.replaceState(window.history.state, "", `#${encodeURIComponent(slug)}`);
  onNavigate?.();
}

export function OutlineList({
  entries,
  activeSlug,
  onNavigate,
}: {
  entries: readonly OutlineEntry[];
  activeSlug: string | null;
  onNavigate?: () => void;
}) {
  return (
    <ol className="border-l border-kh-border">
      {entries.map((entry) => {
        const active = entry.slug === activeSlug;
        return (
          <li key={entry.slug}>
            <a
              href={`#${encodeURIComponent(entry.slug)}`}
              aria-current={active ? "location" : undefined}
              onClick={(event) => goToHeading(event, entry.slug, onNavigate)}
              className={`-ml-px block rounded-r-md border-l py-1 pr-2 text-body-sm transition-colors kh-focus-ring ${
                active
                  ? "border-kh-primary font-medium text-kh-selected-text"
                  : "border-transparent text-kh-text-muted hover:text-kh-text"
              }`}
            >
              <span className="block truncate" style={indent(entry.level)} title={entry.text}>
                {entry.text}
              </span>
            </a>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The document's outline. Three placements show the same list — a rail beside
 * the content, a disclosure above it, a tab in the inspector — and the pane's
 * width (a container query in globals.css), not the viewport, decides which of
 * the first two appears, because the sidebars and the inspector take a
 * variable share of the viewport.
 */
export function OutlineRail({ entries, activeSlug }: { entries: readonly OutlineEntry[]; activeSlug: string | null }) {
  if (entries.length === 0) return null;
  return (
    <aside
      aria-label="On this page"
      className="kh-outline-rail sticky top-4 max-h-[calc(100vh-8rem)] w-56 shrink-0 self-start overflow-y-auto overscroll-contain py-6 pr-4"
    >
      <h2 className="mb-2 text-caption font-medium text-kh-text-muted">On this page</h2>
      <OutlineList entries={entries} activeSlug={activeSlug} />
    </aside>
  );
}

export function OutlineDisclosure({ entries, activeSlug }: { entries: readonly OutlineEntry[]; activeSlug: string | null }) {
  if (entries.length === 0) return null;
  return (
    <div className="kh-reading-column kh-outline-inline">
      <details className="mb-2 rounded-md border border-kh-border bg-kh-bg-subtle px-3 py-2">
        <summary className="cursor-pointer rounded-md text-body-sm font-medium text-kh-text-secondary kh-focus-ring">
          On this page
        </summary>
        <nav aria-label="On this page" className="mt-2">
          <OutlineList entries={entries} activeSlug={activeSlug} />
        </nav>
      </details>
    </div>
  );
}
