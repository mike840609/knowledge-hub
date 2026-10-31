"use client";

import { useCallback, useEffect, useState } from "react";

export type Density = "compact" | "comfortable";

/** Shared with the pre-paint script in the document head. */
export const DENSITY_STORAGE_KEY = "kh:density";

/**
 * How tall the rails' rows are: comfortable (32px, 14px) unless the reader picks compact (28px, 13px).
 * Kept the way the theme is kept — an attribute on <html> the stylesheet reads, stamped before first
 * paint — so the rails never jump on load.
 */
const DEFAULT_DENSITY: Density = "comfortable";

function isDensity(value: string | null): value is Density {
  return value === "compact" || value === "comfortable";
}

/** Null until the effect resolves, so the server and the first client render agree. */
export function useDensity(): { density: Density | null; setDensity: (next: Density) => void } {
  const [density, setState] = useState<Density | null>(null);

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(DENSITY_STORAGE_KEY);
    } catch {
      /* Storage may be unavailable. */
    }
    const resolved = isDensity(stored) ? stored : DEFAULT_DENSITY;
    setState(resolved);
    document.documentElement.dataset.density = resolved;
  }, []);

  const setDensity = useCallback((next: Density) => {
    setState(next);
    document.documentElement.dataset.density = next;
    try {
      window.localStorage.setItem(DENSITY_STORAGE_KEY, next);
    } catch {
      /* Storage may be unavailable; the choice then lasts for this page only. */
    }
  }, []);

  return { density, setDensity };
}
