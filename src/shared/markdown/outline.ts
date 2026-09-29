import type { Heading, Root } from "mdast";
import { toString } from "mdast-util-to-string";
import { visit } from "unist-util-visit";
import { HeadingSlugger } from "./heading-slug";
import { parseMarkdown } from "./parse";

export type OutlineEntry = {
  /** The heading's `id` in the rendered page, and the fragment that reaches it. */
  slug: string;
  text: string;
  /** 1–6, as written. */
  depth: number;
  /** Depth relative to the shallowest heading in the outline, 0-based. */
  level: number;
};

export type HeadingRecord = { node: Heading; slug: string; text: string; depth: number };

/** The deepest heading the outline lists; below this it is detail, not structure. */
export const OUTLINE_MAX_DEPTH = 4;
/** An outline longer than this stops helping a reader find anything. */
export const OUTLINE_MAX_ENTRIES = 200;
/** One heading is the page's title, not a table of contents. */
export const OUTLINE_MIN_ENTRIES = 2;

/**
 * Every heading of the tree in reading order, each with the slug it will be
 * given. This is the only place slugs are assigned: the renderer stamps them
 * onto the rendered headings and the outline lists them, so the two cannot
 * disagree.
 */
export function collectHeadings(tree: Root): HeadingRecord[] {
  const slugger = new HeadingSlugger();
  const headings: HeadingRecord[] = [];
  visit(tree, "heading", (node) => {
    const text = toString(node).trim();
    headings.push({ node, slug: slugger.slug(text), text, depth: node.depth });
  });
  return headings;
}

export function outlineFromHeadings(headings: readonly HeadingRecord[]): OutlineEntry[] {
  const listed = headings.filter((heading) => heading.depth <= OUTLINE_MAX_DEPTH).slice(0, OUTLINE_MAX_ENTRIES);
  if (listed.length < OUTLINE_MIN_ENTRIES) return [];
  const shallowest = Math.min(...listed.map((heading) => heading.depth));
  return listed.map(({ slug, text, depth }) => ({ slug, text, depth, level: depth - shallowest }));
}

export function extractOutline(markdown: string): OutlineEntry[] {
  return outlineFromHeadings(collectHeadings(parseMarkdown(markdown)));
}
