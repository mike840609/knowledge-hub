"use client";

import { useEffect, useState } from "react";

const DOCUMENT = ".kh-shared-document";

/**
 * Whether discussions are a rail beside the article here, or a drawer over it.
 *
 * The stylesheet decides, and this asks it: `--review-rail` is `inline` where there is room. On a
 * shared page that is a matter of the window; in the workspace it is a matter of the document
 * pane, whose width depends on what else is open beside it — which is why no media query in a
 * script can answer for both.
 */
export function reviewRailInline(): boolean {
  const reviewed = document.querySelector<HTMLElement>(DOCUMENT);
  return !!reviewed && getComputedStyle(reviewed).getPropertyValue("--review-rail").trim() === "inline";
}

/** Calls back when the answer may have changed: the window was resized, or the pane was. */
export function watchReviewRail(onChange: () => void): () => void {
  const pane = document.querySelector<HTMLElement>(DOCUMENT)?.closest<HTMLElement>(".kh-document-pane");
  const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(onChange);
  if (pane) observer?.observe(pane);
  window.addEventListener("resize", onChange);
  return () => {
    observer?.disconnect();
    window.removeEventListener("resize", onChange);
  };
}

export function useReviewRailInline(): boolean {
  const [inline, setInline] = useState(false);
  useEffect(() => {
    const update = () => setInline(reviewRailInline());
    update();
    return watchReviewRail(update);
  }, []);
  return inline;
}
