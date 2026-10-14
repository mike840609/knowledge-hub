"use client";

import { useSyncExternalStore } from "react";

const WIDE = "(min-width: 1024px)";

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia(WIDE);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/**
 * Whether the sidebar is a column (wide) or the menu drawer (narrow). The server renders the column,
 * which CSS hides below 1024px, so a narrow first paint shows nothing that then moves.
 */
export function useIsWide(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia(WIDE).matches, () => true);
}
