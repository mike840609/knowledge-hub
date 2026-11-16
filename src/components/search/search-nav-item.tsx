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
  // WCAG 2.5.3 (Label in Name): the shortcut badge is part of what the row shows, so it is part
  // of the name. aria-keyshortcuts still carries the key itself.
  //
  // The literal space between the label and the badge is load-bearing: `label-content-name-mismatch`
  // joins the visible text nodes with no separator and then looks for the name inside it, so the
  // row reads "Search⌘K" unless that space is really in the DOM. A whitespace-only text node is not
  // a flex item (Flexbox §4), so it changes nothing on screen.
  const button = (
    <button
      type="button"
      onClick={requestQuickSearch}
      aria-label="Search ⌘K"
      aria-keyshortcuts="Meta+K Control+K"
      className={`kh-control kh-focus-ring flex kh-rail-row w-full items-center rounded-md px-2 kh-rail-text text-kh-text-muted transition hover:bg-kh-bg-hover hover:text-kh-text ${compact ? "justify-center" : "gap-2"}`}
    >
      <Search size={15} aria-hidden="true" />
      {compact ? null : <>
        <span className="min-w-0 flex-1 truncate text-left">Search</span>{" "}
        <Kbd className="shrink-0">⌘K</Kbd>
      </>}
    </button>
  );
  return compact ? <Tooltip label="Search" shortcut="Meta+K Control+K" side="right">{button}</Tooltip> : button;
}
