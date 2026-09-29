import { readStored, writeStored } from "@/components/shell/use-persisted-state";

const STORAGE_KEY = "kh:inspector-tab";

/**
 * Which inspector tab to open on.
 *
 * A request (the header's links chip, the palette's "Show backlinks") wins,
 * because someone asked for that tab just now. Otherwise the tab the reader
 * last used, so that a person who lives in Links is not made to click it on
 * every document. Anything not on offer for this document falls through — the
 * Outline tab only exists when there are headings, and a remembered `outline`
 * must not leave the next document on a tab that is not there.
 */
export function resolveInspectorTab(input: {
  requested?: string | null;
  remembered?: string | null;
  available: readonly string[];
}): string {
  for (const candidate of [input.requested, input.remembered]) {
    if (candidate && input.available.includes(candidate)) return candidate;
  }
  return "details";
}

/**
 * Per reader and per browser, like the theme and the collapsed nav — an
 * arrangement, not something the server needs to know, so it lives in
 * `localStorage` behind the guarded helpers every other arrangement uses.
 *
 * It is read directly rather than through `usePersistedJson`, whose contract is
 * to start at a fallback and read in an effect so that the server and the first
 * client render agree. The inspector is never in the server's HTML — it renders
 * only once the reader has opened it — so there is nothing to agree with, and
 * starting at the fallback would show the Details panel for a frame before
 * switching.
 */
export function rememberedInspectorTab(): string | null {
  return readStored("local", STORAGE_KEY);
}

export function rememberInspectorTab(tab: string): void {
  writeStored("local", STORAGE_KEY, tab);
}
