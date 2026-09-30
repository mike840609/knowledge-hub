import type { PhrasingContent, Root } from "mdast";
import type {} from "mdast-util-to-hast";
import type { WikiLinkMatch } from "@/modules/knowledge/domain/document-links";
import { headingSlug } from "@/shared/markdown/heading-slug";
import { replaceWikiLinks } from "./replace-wiki-links";

/** Attribute names the plugin puts on the link and `MarkdownAnchor` reads back. */
export const WIKILINK_TARGET = "data-kh-wikilink";
export const WIKILINK_FRAGMENT = "data-kh-fragment";
export const WIKILINK_ANCHOR = "data-kh-anchor";

/** What is shown for a link the author wrote as `[[Target#Heading|Alias]]`. */
function shownText(match: WikiLinkMatch): string {
  if (match.alias !== null) return match.alias;
  if (match.target === "") return match.fragment ?? "";
  return match.fragment === null ? match.target : `${match.target} › ${match.fragment}`;
}

function linkNode(match: WikiLinkMatch): PhrasingContent {
  const properties: Record<string, string> = {};
  if (match.target === "") properties[WIKILINK_ANCHOR] = headingSlug(match.fragment ?? "");
  else properties[WIKILINK_TARGET] = match.target;
  if (match.fragment !== null && match.target !== "") properties[WIKILINK_FRAGMENT] = match.fragment;
  return {
    type: "link",
    // Never followed: `MarkdownAnchor` decides where the link goes from the
    // attributes below. Not blank, because a blank URL is what a sanitizer
    // reads as "this was unsafe".
    url: "#",
    children: [{ type: "text", value: shownText(match) }],
    data: { hName: "a", hProperties: properties },
  };
}

/**
 * Turns `[[Target#Heading|Alias]]` into a link the renderer can resolve. It
 * only marks the link (with the target and fragment as attributes); which
 * document it reaches is decided by whoever renders, from what the server
 * resolved — and where nothing was resolved, as on a shared page, it reads as
 * its text.
 *
 * Finds links with the same `findWikiLinks` the link index is built with, so a
 * link a reader can click is a link the graph knows about.
 */
export function remarkKnowledgeLinks() {
  return (tree: Root, file: { toString(): string }) => {
    replaceWikiLinks(tree, String(file), linkNode);
  };
}
