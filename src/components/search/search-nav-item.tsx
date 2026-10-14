"use client";

import { Search } from "lucide-react";
import { Kbd } from "@/components/ui/kbd";

/**
 * Asking the palette to open. The palette is mounted once, in the topbar, and owns its dialog and ⌘K;
 * the sidebar's Search row asks for it by event, as the palette asks the shell to toggle navigation.
 */
export const OPEN_SEARCH_EVENT = "kh:open-search";

export function requestQuickSearch(): void {
  window.dispatchEvent(new CustomEvent(OPEN_SEARCH_EVENT));
}

/** Search as the sidebar's first row: drawn like the navigation beneath it, not as a field of its own. */
export function SearchNavItem() {
  return (
    <button
      type="button"
      onClick={requestQuickSearch}
      aria-label="Quick search"
      aria-keyshortcuts="Meta+K Control+K /"
      className="kh-control kh-focus-ring flex h-8 w-full items-center gap-2 rounded-md px-2 text-body text-kh-text-muted transition hover:bg-kh-bg-hover hover:text-kh-text"
    >
      <Search size={15} aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate text-left">Search</span>
      <Kbd className="shrink-0">⌘K</Kbd>
    </button>
  );
}
