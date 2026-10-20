"use client";

import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { Button } from "@/components/ui/button";
import { CopyCodeButton } from "./copy-code-button";
import { ScrollablePre } from "./scrollable-pre";

/** A block longer than this opens collapsed (code-block-label-collapse spec §2). */
export const COLLAPSE_OVER_LINES = 30;

/**
 * Sent to a block's `[data-code-block]` to open it whole. A comment on a line the fold holds out of
 * sight would otherwise be marked, placed and jumped to where nothing is shown: those are measured
 * from the line's own box, which the fold clips but does not move (spec §2).
 */
export const EXPAND_CODE_BLOCK = "kh:code-block-expand";

/**
 * A code block as the reader shows it: the box, its language and copy button in the corner, and,
 * for a long block, a fold. Collapsed, the code is held to 20 lines' height and scrolls inside it
 * rather than being cut off, so find-in-page and a comment's highlight still reach every line.
 * Printed, it is whole.
 */
export function CodeBlock({ children, language, lines = 0 }: { children?: ReactNode; language?: string; lines?: number }) {
  const [expanded, setExpanded] = useState(false);
  const footerRef = useRef<HTMLDivElement>(null);
  const scrollerId = useId();
  const collapsible = lines > COLLAPSE_OVER_LINES;

  // A layout effect, so it listens before any passive effect — the review's — can send it.
  useLayoutEffect(() => {
    const box = footerRef.current?.closest("[data-code-block]");
    if (!box) return;
    const open = () => setExpanded(true);
    box.addEventListener(EXPAND_CODE_BLOCK, open);
    return () => box.removeEventListener(EXPAND_CODE_BLOCK, open);
  }, [collapsible]);

  function toggle() {
    if (!expanded) return setExpanded(true);
    // Shrinking leaves the reader below the block, the button gone above them: shrink now, then bring it back.
    flushSync(() => setExpanded(false));
    footerRef.current?.scrollIntoView({ block: "nearest" });
  }

  const footer = collapsible && (
    <div ref={footerRef} className="border-t border-kh-border px-1.5 py-1 print:hidden">
      <Button variant="ghost" size="sm" aria-expanded={expanded} aria-controls={scrollerId} onClick={toggle}>
        {expanded ? "Show fewer lines" : `Show all ${lines} lines`}
      </Button>
    </div>
  );

  return (
    <ScrollablePre
      scrollerId={scrollerId}
      scrollerClassName={collapsible && !expanded ? "max-h-[31.5rem] overflow-y-auto print:max-h-none" : ""}
      footer={footer}
      action={<CopyCodeButton language={language} />}
    >
      {children}
    </ScrollablePre>
  );
}
