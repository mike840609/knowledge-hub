import type { Nodes } from "mdast";
import { parseMarkdown } from "@/shared/markdown/parse";

/**
 * A `\[\[…]]` in a document: what the rendered editor wrote for a `[[wikilink]]` before the
 * editor held wikilinks as nodes of their own (daily-driver spec §4). The text `[[x]]` was
 * serialised with its opening brackets escaped and its closing ones not, which is no link — so a
 * document opened and saved there lost the link, and every backlink and graph edge with it.
 *
 * Only the shape can be recognised, not the intent: someone who escaped a link on purpose
 * (`\[\[x\]\]`) and then saved from the rendered editor got the same `\[\[x]]`. These are
 * candidates for a person to look at, never something to rewrite by machine.
 */
export type EscapedWikiLink = {
  /** 1-based line within the Markdown body. */
  line: number;
  /** The `\[\[…]]` as it is written. */
  text: string;
};

/**
 * Opening brackets escaped, closing brackets not. Not preceded by `!` (an embed is not a link, so
 * losing it lost nothing). A closing `\]\]`, or one whose first bracket is escaped, is what someone
 * writes by hand when they mean the brackets as text, and is not matched. The content is what
 * `findWikiLinks` allows between the brackets — no bracket, no line break — and may hold the
 * backslash that a table cell needs before an alias's pipe.
 */
const ESCAPED_OPEN = /(?<!!)\\\[\\\[[^[\]\n]+?(?<!\\)\]\]/g;

/**
 * Every `\[\[…]]` in the text of `markdown`, in order. Text only: not code, not raw HTML. (Nor
 * in the text of a link: a `]]` cannot be written there without escaping it, so the shape does
 * not occur.)
 *
 * Judged on the source as written, since the parsed tree holds `\[\[x]]` and `[[x]]` as the same
 * text — that is the whole difficulty of the defect.
 */
export function findEscapedWikiLinks(markdown: string): EscapedWikiLink[] {
  // A necessary condition, checked before the parse (as the link extractor does): no literal
  // `\[\[` means nothing to find.
  if (!markdown.includes("\\[\\[")) return [];
  const found: EscapedWikiLink[] = [];
  const walk = (node: Nodes) => {
    if (node.type === "text") {
      const start = node.position?.start;
      const end = node.position?.end;
      if (start?.offset === undefined || end?.offset === undefined) return;
      const source = markdown.slice(start.offset, end.offset);
      for (const match of source.matchAll(ESCAPED_OPEN)) {
        const before = source.slice(0, match.index ?? 0).split("\n").length - 1;
        found.push({ line: start.line + before, text: match[0] });
      }
      return;
    }
    if ("children" in node) for (const child of node.children) walk(child);
  };
  walk(parseMarkdown(markdown));
  return found;
}
