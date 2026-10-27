import { markdownOpensWithHeading } from "@/lib/markdown-title";

const SUFFIX = " copy";
const MAX_TITLE = 512;

/**
 * The title a duplicate is saved under. A copy must be distinguishable in the
 * tree at a glance, so it says so; a title long enough to fill the column gives
 * up characters rather than the suffix, because the suffix is the point.
 */
export function duplicateTitle(title: string): string {
  const base = title.trim() || "Untitled document";
  if (base.length + SUFFIX.length <= MAX_TITLE) return `${base}${SUFFIX}`;
  return `${base.slice(0, MAX_TITLE - SUFFIX.length).trimEnd()}${SUFFIX}`;
}

/**
 * When the page's title is the H1 it opens with, the title field cannot name
 * the copy — the H1 would keep showing the original. Renaming that line keeps
 * the tree, the header and the content saying the same thing. Inline marks on
 * the title line are not preserved: a copy's name is text, not formatting.
 */
export function duplicateMarkdown(markdown: string, title: string): string {
  if (!markdownOpensWithHeading(markdown)) return markdown;
  const lines = markdown.split(/\r?\n/);
  const index = lines.findIndex((line) => line.trim() !== "");
  if (index === -1) return markdown;
  const match = /^(\s{0,3}#\s+).*$/.exec(lines[index]);
  if (!match) return markdown;
  lines[index] = `${match[1]}${title}`;
  return lines.join("\n");
}
