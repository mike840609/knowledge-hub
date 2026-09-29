"use client";

import { useEffect } from "react";
import { findHeading } from "./use-active-heading";

/**
 * Takes the reader to the heading the address names, once the document is on
 * screen.
 *
 * The browser does this itself on a full page load, and Next does it after a
 * client navigation — but only for what exists when the navigation commits,
 * and a document arriving behind its loading skeleton does not, and its
 * content sits in a scroll pane of its own besides. A link into another
 * document's heading (`[[Note#Setup]]`) is exactly that case.
 *
 * Runs when the document changes, not on every hash change: the outline keeps
 * the address in step as the reader moves, and must not be scrolled back.
 */
export function useScrollToHash(documentKey: string): void {
  useEffect(() => {
    const hash = window.location.hash;
    if (hash.length < 2) return;
    let slug = hash.slice(1);
    try {
      slug = decodeURIComponent(slug);
    } catch {
      // Use it as written.
    }
    findHeading(slug)?.scrollIntoView({ block: "start" });
  }, [documentKey]);
}
