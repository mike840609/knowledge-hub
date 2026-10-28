"use client";

import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_THEME_CHOICE,
  isThemeChoice,
  resolveTheme,
  type ResolvedTheme,
  type ThemeChoice,
} from "@/lib/theme";

/** Kept as the historical export: callers speak of "the theme" and mean the choice. */
export type Theme = ThemeChoice;

/** Shared with the pre-paint script in the document head. */
export const THEME_STORAGE_KEY = "kh:theme";

const DARK_QUERY = "(prefers-color-scheme: dark)";

function prefersDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.(DARK_QUERY).matches === true;
}

function applyTheme(choice: ThemeChoice): ResolvedTheme {
  const resolved = resolveTheme(choice, prefersDark());
  document.documentElement.dataset.theme = resolved;
  return resolved;
}

/**
 * The theme is the reader's choice between Light, Dark and System. System is
 * resolved from `prefers-color-scheme` and keeps following it while chosen;
 * an explicit Light or Dark never changes underfoot when the OS switches.
 * Light is the starting point until someone picks otherwise.
 *
 * Returns null until the effect resolves, so the server and the first client
 * render agree. The head script has already applied any stored choice by then,
 * which is what keeps the first paint from being the wrong theme.
 */
export function useTheme(): {
  theme: ThemeChoice | null;
  resolved: ResolvedTheme | null;
  setTheme: (next: ThemeChoice) => void;
} {
  const [theme, setState] = useState<ThemeChoice | null>(null);
  const [resolved, setResolved] = useState<ResolvedTheme | null>(null);

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    } catch {
      /* Storage may be unavailable. */
    }
    const choice = isThemeChoice(stored) ? stored : DEFAULT_THEME_CHOICE;
    setState(choice);
    setResolved(applyTheme(choice));
  }, []);

  // While System is chosen, the OS can change under the page. The listener is
  // attached only for that choice: Light and Dark are promises, not defaults.
  useEffect(() => {
    if (theme !== "system") return;
    const media = window.matchMedia?.(DARK_QUERY);
    if (!media) return;
    const onChange = () => setResolved(applyTheme("system"));
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [theme]);

  const setTheme = useCallback((next: ThemeChoice) => {
    setState(next);
    setResolved(applyTheme(next));
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      /* Storage may be unavailable; the choice then lasts for this page only. */
    }
  }, []);

  return { theme, resolved, setTheme };
}
