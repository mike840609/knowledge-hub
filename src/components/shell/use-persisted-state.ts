"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * State that survives a refresh, for the arrangement a reader has made.
 *
 * §11 says what the user has arranged is theirs to keep, and that expansion,
 * collapsed sections and filters do not belong in component state a refresh
 * discards. Three places already did this by hand — the theme, the collapsed
 * nav, the document shortcuts — each with its own `try`/`catch` and its own
 * hydration dance. This is that dance once.
 *
 * Two rules it encodes, both of which are easy to get wrong by hand:
 *
 * - **It starts at the fallback and reads storage in an effect.** Reading
 *   during render would make the server and the first client render disagree.
 * - **It does not write until it has read.** Writing on the first render
 *   would overwrite what is stored with the fallback, which is how this kind
 *   of hook usually ends up silently forgetting everything.
 *
 * `area` picks how long the arrangement should last. `local` is for something
 * chosen — which sources are expanded, which sections are open. `session` is
 * for something in progress: a find-as-you-type filter is worth keeping
 * across a refresh and not worth greeting someone with a week later.
 */
type Area = "local" | "session";

function storage(area: Area): Storage | null {
  try {
    return area === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return null; // Blocked by the browser, or a privacy mode.
  }
}

/**
 * Reading `window.localStorage` can throw rather than return null — a privacy
 * mode, or a context where the browser blocks storage. Unguarded, that took
 * the whole shell down: the access-notice check in `AppShell` runs in an
 * effect during the first render, so the throw reached the root error
 * boundary and every route rendered "Something went wrong".
 */
export function readStored(area: Area, key: string): string | null {
  try {
    return storage(area)?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeStored(area: Area, key: string, value: string): void {
  try {
    storage(area)?.setItem(key, value);
  } catch {
    /* Blocked or full; the value then lasts for this page only. */
  }
}

export function removeStored(area: Area, key: string): void {
  try {
    storage(area)?.removeItem(key);
  } catch {
    /* Nothing to do: it was never stored. */
  }
}

export function usePersistedJson<T>(
  key: string,
  fallback: T,
  isValid: (value: unknown) => value is T,
  area: Area = "local",
): [T, (update: T | ((previous: T) => T)) => void] {
  const [value, setValue] = useState<T>(fallback);
  // Which key the current value came from. Writes are refused until this
  // matches, so a render before the read cannot clobber stored state.
  const readKey = useRef<string | null>(null);

  useEffect(() => {
    let parsed: unknown;
    try {
      const raw = readStored(area, key);
      parsed = raw === null ? undefined : JSON.parse(raw);
    } catch {
      parsed = undefined; // Unreadable or not JSON: treat as absent.
    }
    readKey.current = key;
    setValue(isValid(parsed) ? parsed : fallback);
    // Deliberately keyed on `key` and `area` alone. `fallback` and `isValid`
    // are constants at every call site, and listing them would re-read
    // storage on every render and fight the writes below.
  }, [key, area]);

  const update = useCallback(
    (next: T | ((previous: T) => T)) => {
      setValue((previous) => {
        const resolved = typeof next === "function" ? (next as (p: T) => T)(previous) : next;
        if (readKey.current === key) writeStored(area, key, JSON.stringify(resolved));
        return resolved;
      });
    },
    [key, area],
  );

  return [value, update];
}

export function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

export function isString(value: unknown): value is string {
  return typeof value === "string";
}

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

export function isBooleanRecord(value: unknown): value is Record<string, boolean> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === "boolean")
  );
}
