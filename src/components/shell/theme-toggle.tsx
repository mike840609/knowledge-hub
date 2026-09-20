"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

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

const OPTIONS: { value: Theme; label: string; Icon: typeof Sun }[] = [
  { value: "light", label: "Light theme", Icon: Sun },
  { value: "dark", label: "Dark theme", Icon: Moon },
];

function apply(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

/**
 * A segmented control rather than one button that swaps its icon. A swapping
 * icon is ambiguous — readers split on whether it shows the current state or
 * the one a click would reach. Showing both options and lighting the active
 * one removes the question.
 */
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

  function choose(next: Theme) {
    setTheme(next);
    apply(next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      /* Storage may be unavailable; the choice then lasts for this page only. */
    }
  }

  return (
    <div
      role="group"
      aria-label="Theme"
      className="flex shrink-0 items-center gap-0.5 rounded-lg border border-kh-border p-0.5"
    >
      {OPTIONS.map(({ value, label, Icon }) => {
        // Until the effect resolves, neither option claims to be active.
        const active = theme === value;
        return (
          <button
            key={value}
            type="button"
            aria-label={label}
            aria-pressed={theme === null ? undefined : active}
            title={label}
            onClick={() => choose(value)}
            className={`kh-focus-ring inline-flex h-[22px] w-6 items-center justify-center rounded-md transition-colors ${
              active ? "bg-kh-bg-hover text-kh-text" : "text-kh-text-faint hover:text-kh-text-muted"
            }`}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}
