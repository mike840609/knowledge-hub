"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { codeAsWritten } from "./copy-code-button";
import { diagrams, readTheme, subscribeTheme, type DiagramOutcome } from "./mermaid-queue";

/**
 * A `mermaid` code block, and its diagram once that is drawn (reader-mermaid spec).
 *
 * `children` is the code block as the server sent it, and it stays where it is whatever happens:
 * a comment is anchored in its text, so it is never moved or made again. Until a drawing arrives —
 * and for good, when there is none — the disclosure it sits in is open and has no heading, and the
 * block reads as the code block it is. Drawn, the disclosure closes and is called `Source`.
 *
 * The diagram is an `<img>`. The SVG is never put into the page as markup: as an image it runs
 * no script, loads nothing, and its styles reach nothing outside it.
 */
export function MermaidBlock({ children }: { children?: ReactNode }) {
  const figure = useRef<HTMLElement>(null);
  const source = useRef<HTMLDetailsElement>(null);
  const wasDrawn = useRef(false);
  const [outcome, setOutcome] = useState<DiagramOutcome | null>(null);
  const theme = useSyncExternalStore(subscribeTheme, readTheme, () => "");

  // Runs when the theme changes, and when the server sends other code into this place while the block
  // stays mounted (a refresh after an edit): `children` is a new element then, and not for the block's
  // own state. The picture on show stays until its replacement arrives.
  useEffect(() => {
    const element = figure.current;
    if (!element) return;
    // Read from the page, as the copy button reads it: a prop would send the code a second time.
    const text = codeAsWritten(element.querySelector("pre")?.textContent ?? "");
    const index = Array.from(document.querySelectorAll("[data-mermaid]")).indexOf(element);
    let stale = false;
    void diagrams().draw(element, index, text).then((result) => {
      if (stale) return;
      const isDrawn = "drawn" in result;
      // Only when it changes: a redraw for a new theme must not close a source the reader opened.
      if (isDrawn !== wasDrawn.current && source.current) source.current.open = !isDrawn;
      wasDrawn.current = isDrawn;
      setOutcome(result);
    });
    return () => { stale = true; };
  }, [theme, children]);

  useEffect(() => {
    const element = figure.current;
    return () => { if (element) diagrams().forget(element); };
  }, []);

  const drawn = outcome && "drawn" in outcome ? outcome.drawn : null;
  return (
    <figure ref={figure} data-mermaid>
      {drawn && (
        <div className="my-4 w-full overflow-x-auto">
          {/* eslint-disable-next-line @next/next/no-img-element -- a blob: URL this page made; next/image has nothing to optimise. */}
          <img data-diagram src={drawn.url} width={drawn.width} height={drawn.height} alt={`Diagram (${drawn.type}). Its source follows.`} className="max-w-none" />
        </div>
      )}
      <details ref={source} open>
        <summary className={drawn ? "kh-focus-ring rounded-md text-body-sm font-medium text-kh-text-muted print:hidden" : "hidden"}>Source</summary>
        {children}
      </details>
      {outcome && "reason" in outcome && (
        <p data-diagram-reason className="-mt-2 mb-4 text-caption text-kh-text-muted">
          {outcome.reason}
        </p>
      )}
    </figure>
  );
}
