import type { Nodes, Parent, Root } from "mdast";
import { findWikiLinks, type WikiLinkMatch } from "@/modules/knowledge/domain/document-links";

/** Where `[[x]]` is being shown rather than written, or already means something else. */
const LEAVE_ALONE = new Set<Nodes["type"]>(["link", "linkReference", "definition", "code", "inlineCode", "html", "image", "imageReference"]);

/**
 * Replaces each `[[…]]` a reader would take as a link with the node `make` builds for it, and
 * leaves everything else in the tree as it was — the text around a link stays in text nodes of
 * its own, and no empty one is left behind.
 *
 * Which text counts, and where, is decided here and by `findWikiLinks`, and nowhere else: the
 * reader's plugin and the editor's both go through this, so a link a reader can click, a link
 * the editor keeps as a link, and an edge the graph knows about cannot disagree.
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
