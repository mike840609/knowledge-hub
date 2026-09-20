"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { buttonClasses } from "@/components/ui/button";

type Theme = "light" | "dark";

/** Shared with the pre-paint script in the document head. */
export const THEME_STORAGE_KEY = "kh:theme";

function systemTheme(): Theme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ThemeToggle() {
  // Server and first client render must agree, so resolve the theme in an
  // effect. The head script has already applied a stored choice by now, which
  // is what keeps the paint from flashing.
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    } catch {
      /* Storage may be unavailable. */
    }
    if (stored === "light" || stored === "dark") {
      setTheme(stored);
      return;
    }
    // No explicit choice: follow the system, and keep following it.
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setTheme(query.matches ? "dark" : "light");
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  function toggle() {
    const next: Theme = (theme ?? systemTheme()) === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      /* Storage may be unavailable. */
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
      className={buttonClasses({ variant: "ghost", icon: true })}
    >
      {theme === null ? null : dark
        ? <Sun className="h-4 w-4" aria-hidden="true" />
        : <Moon className="h-4 w-4" aria-hidden="true" />}
    </button>
  );
}
