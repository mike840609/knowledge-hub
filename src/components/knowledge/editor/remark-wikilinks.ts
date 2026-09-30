import type { Root } from "mdast";
import { replaceWikiLinks } from "../replace-wiki-links";

/**
 * The mdast node the plugin makes. `value` is the link as it reads in the text,
 * `[[…]]` included, with backslash escapes resolved — which is also what is written
 * back out (`configureWikiLinkStringify`), so the editor never has to work out how
 * a link was spelled.
 */
export type WikiLinkNode = { type: "wikiLink"; value: string };

/**
 * Makes the `[[…]]` links of a document into `wikiLink` nodes, so the editor can hold
 * them as nodes of their own instead of as text — text it would write back escaped
 * (`\[\[x]]`), which is no link at all.
 *
 * Which text is a link is `findWikiLinks`' to say, through the same walk the reader
 * uses: an escaped one, one in code or in a link's text, and an embed stay text.
 */
export function remarkWikiLinks() {
  return (tree: Root, file: { toString(): string }) => {
    replaceWikiLinks(tree, String(file), (_match, raw): WikiLinkNode => ({ type: "wikiLink", value: raw }));
  };
}
