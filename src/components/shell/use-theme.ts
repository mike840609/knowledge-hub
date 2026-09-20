"use client";

import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";

/** Shared with the pre-paint script in the document head. */
export const THEME_STORAGE_KEY = "kh:theme";

/**
 * The theme is the reader's explicit choice and nothing else. The system's
 * `prefers-color-scheme` is deliberately not consulted, so the control always
 * reflects what was last picked rather than changing underfoot when the OS
 * switches. Light is the starting point until someone picks otherwise.
 */
const DEFAULT_THEME: Theme = "light";

function isTheme(value: string | null): value is Theme {
  return value === "light" || value === "dark";
}

/**
 * Returns null until the effect resolves, so the server and the first client
 * render agree. The head script has already applied any stored choice by then,
 * which is what keeps the first paint from being the wrong theme.
 */
export function useTheme(): { theme: Theme | null; setTheme: (next: Theme) => void } {
  const [theme, setState] = useState<Theme | null>(null);

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    } catch {
      /* Storage may be unavailable. */
    }
    const resolved = isTheme(stored) ? stored : DEFAULT_THEME;
    setState(resolved);
    document.documentElement.dataset.theme = resolved;
  }, []);

  const setTheme = useCallback((next: Theme) => {
    setState(next);
    document.documentElement.dataset.theme = next;
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      /* Storage may be unavailable; the choice then lasts for this page only. */
    }
  }, []);

  return { theme, setTheme };
}
