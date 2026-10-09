"use client";

import { Search } from "lucide-react";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip } from "@/components/ui/tooltip";

/**
 * Asking the palette to open. The palette is mounted once, in the topbar, and owns its dialog and ⌘K;
 * the rail's Search row asks for it by event, as the palette asks the shell to toggle navigation.
 */
export const OPEN_SEARCH_EVENT = "kh:open-search";

export function requestQuickSearch(): void {
  window.dispatchEvent(new CustomEvent(OPEN_SEARCH_EVENT));
}

/** Search as the rail's first row: drawn like the navigation beneath it, not as a field of its own. */
export function SearchNavItem({ compact = false }: { compact?: boolean }) {
  const button = (
    <button
      type="button"
      onClick={requestQuickSearch}
      aria-label="Quick search"
      aria-keyshortcuts="Meta+K Control+K /"
      className={`kh-control kh-focus-ring flex h-8 w-full items-center rounded-md px-2 text-body text-kh-text-muted transition hover:bg-kh-bg-hover hover:text-kh-text ${compact ? "justify-center" : "gap-2"}`}
    >
      <Search size={15} aria-hidden="true" />
      {compact ? null : <>
        <span className="min-w-0 flex-1 truncate text-left">Search</span>
        <Kbd className="shrink-0">⌘K</Kbd>
      </>}
    </button>
  );
  return compact ? <Tooltip label="Search" shortcut="Meta+K Control+K" side="right">{button}</Tooltip> : button;
}
