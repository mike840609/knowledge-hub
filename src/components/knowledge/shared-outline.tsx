"use client";

import type { OutlineEntry } from "@/shared/markdown/outline";
import { OutlineDisclosure, OutlineRail } from "./document-outline";
import { useActiveHeading } from "./use-active-heading";

/**
 * The shared page's outline, following the reader. The page scrolls the window
 * rather than a pane, and is otherwise a server component, so this is the one
 * client piece that feeds the outline its current heading (share-page-outline spec §3).
 */
export function SharedOutline({ entries, placement }: { entries: readonly OutlineEntry[]; placement: "rail" | "disclosure" }) {
  const activeSlug = useActiveHeading(entries.map((entry) => entry.slug), "window");
  return placement === "rail"
    ? <OutlineRail entries={entries} activeSlug={activeSlug} />
    : <OutlineDisclosure entries={entries} activeSlug={activeSlug} />;
}
