/**
 * The page icons the picker offers. A short, curated set rather than a full
 * emoji keyboard: the icon is a scanning aid in a dense tree, and a page that
 * can wear any glyph quickly becomes a second title.
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

export type PageIcon = (typeof PAGE_ICONS)[number];

export function isPageIcon(value: unknown): value is PageIcon {
  return typeof value === "string" && (PAGE_ICONS as readonly string[]).includes(value);
}
