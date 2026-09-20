"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { buttonClasses } from "@/components/ui/button";

type Theme = "light" | "dark";

/** Shared with the pre-paint script in the document head. */
export const THEME_STORAGE_KEY = "kh:theme";

/**
 * The theme is the reader's explicit choice and nothing else. The system's
 * `prefers-color-scheme` is deliberately not consulted, so the control always
 * reflects what was last picked rather than changing underfoot when the OS
 * switches. Light is the starting point until someone picks otherwise.
 */
const DEFAULT_THEME: Theme = "light";

function apply(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

export function ThemeToggle() {
  // Server and first client render must agree, so resolve in an effect. The
  // head script has already applied any stored choice by now, which is what
  // keeps the first paint from being the wrong theme.
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    } catch {
      /* Storage may be unavailable. */
    }
    const resolved: Theme = stored === "dark" || stored === "light" ? stored : DEFAULT_THEME;
    setTheme(resolved);
    apply(resolved);
  }, []);

  function toggle() {
    const next: Theme = (theme ?? DEFAULT_THEME) === "dark" ? "light" : "dark";
    setTheme(next);
    apply(next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      /* Storage may be unavailable; the choice then lasts for this page only. */
    }
  }

  const dark = theme === "dark";
  const label = dark ? "Switch to light theme" : "Switch to dark theme";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      aria-pressed={dark}
      className={buttonClasses({ variant: "ghost", icon: true })}
    >
      {theme === null ? null : dark
        ? <Sun className="h-4 w-4" aria-hidden="true" />
        : <Moon className="h-4 w-4" aria-hidden="true" />}
    </button>
  );
}
