"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * A table in the reader. `.kh-markdown-table` scrolls sideways only where the column is too narrow for the
 * table's longest words (globals.css); it is a tab stop only while it does, so a keyboard can scroll it and a
 * table that fits adds nothing to the tab order.
 */
export function MarkdownTable({ children }: { children?: ReactNode }) {
  const region = useRef<HTMLDivElement>(null);
  const [scrolls, setScrolls] = useState(false);
  useEffect(() => {
    const element = region.current;
    if (!element) return;
    const measure = () => setScrolls(element.scrollWidth > element.clientWidth + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    const table = element.querySelector("table");
    if (table) observer.observe(table);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={region} role="region" aria-label="Table" tabIndex={scrolls ? 0 : undefined} className="kh-markdown-table kh-focus-ring">
      <table>{children}</table>
    </div>
  );
}
