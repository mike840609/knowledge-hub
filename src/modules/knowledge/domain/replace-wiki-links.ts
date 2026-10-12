import type { Nodes, Parent, Root } from "mdast";
import { findWikiLinks, type WikiLinkMatch } from "./document-links";

/** What is shown for a link the author wrote as `[[Target#Heading|Alias]]` — in the reader, and in the editor. */
export function shownText(match: Pick<WikiLinkMatch, "target" | "fragment" | "alias">): string {
  if (match.alias !== null) return match.alias;
  if (match.target === "") return match.fragment ?? "";
  return match.fragment === null ? match.target : `${match.target} › ${match.fragment}`;
}

/** Where `[[x]]` is being shown rather than written, or already means something else. */
const LEAVE_ALONE = new Set<Nodes["type"]>(["link", "linkReference", "definition", "code", "inlineCode", "html", "image", "imageReference"]);

/**
 * Replaces each `[[…]]` a reader would take as a link with the node `make` builds for it, and
 * leaves everything else in the tree as it was — the text around a link stays in text nodes of
 * its own, and no empty one is left behind.
 *
 * Which text counts, and where, is decided here and by `findWikiLinks`, and nowhere else: the
 * reader's plugin, the editor's and the text a comment is anchored in (`review-anchor.ts`) all go
 * through this, so a link a reader can click, a link the editor keeps as a link, an edge the graph
 * knows about and the words a reader selected cannot disagree.
 *
 * `make` gets the match and the `[[…]]` as it reads in the text (escapes resolved).
 */
export function replaceWikiLinks(tree: Root, markdown: string, make: (match: WikiLinkMatch, raw: string) => object): void {
  transform(tree, markdown, make);
}

function transform(parent: Parent, markdown: string, make: (match: WikiLinkMatch, raw: string) => object): void {
  const next: unknown[] = [];
  let changed = false;
  for (const child of parent.children as Nodes[]) {
    if (child.type === "text") {
      const matches = findWikiLinks(child, markdown);
      if (matches.length > 0) {
        changed = true;
        let cursor = 0;
        for (const match of matches) {
          if (match.index > cursor) next.push({ type: "text", value: child.value.slice(cursor, match.index) });
          next.push(make(match, child.value.slice(match.index, match.index + match.length)));
          cursor = match.index + match.length;
        }
        if (cursor < child.value.length) next.push({ type: "text", value: child.value.slice(cursor) });
        continue;
      }
    } else if (!LEAVE_ALONE.has(child.type) && "children" in child) {
      transform(child as Parent, markdown, make);
    }
    next.push(child);
  }
  if (changed) (parent as { children: unknown[] }).children = next;
}
