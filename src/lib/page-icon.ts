import { isCatalogEmoji } from "./emoji-catalog";

/**
 * The page icons the picker puts first, as "Suggested". The full choice is the
 * bundled catalog (`emoji-catalog.ts`), searchable; still a closed set rather
 * than a free emoji keyboard, because the icon is a scanning aid in a dense tree.
 */
export const PAGE_ICONS = [
  "📄",
  "📝",
  "📌",
  "📚",
  "🧭",
  "💡",
  "✅",
  "🚀",
  "🎯",
  "🧪",
  "📊",
  "🗂️",
  "🔒",
  "🌱",
  "☕",
  "🧠",
] as const;

export type PageIcon = string;

export function isPageIcon(value: unknown): value is PageIcon {
  return typeof value === "string" && ((PAGE_ICONS as readonly string[]).includes(value) || isCatalogEmoji(value));
}
