import type { Root } from "mdast";
import { SKIP, visit } from "unist-util-visit";

const BR = /^<br\s*\/?>$/i;
const COMMENT = /^<!--[\s\S]*-->$/;
/** An opening or closing tag of the inline HTML the reader draws (`remark-html-subset.ts`), written bare. */
export const INLINE_HTML_TAG = /^<(\/?)(u|sub|sup|kbd|mark)>$/i;

/** Whether a piece of HTML is `<br>`, however it is spelled. */
export function isLineBreakHtml(value: string): boolean {
  return BR.test(value.trim());
}

/** Whether a piece of HTML is a comment, which the reader does not show. */
export function isCommentHtml(value: string): boolean {
  return COMMENT.test(value.trim());
}

/**
 * What a piece of HTML reads as, where only text can be shown (a heading in the outline, its
 * slug): a `<br>` is a space, a comment and an inline tag the reader draws are nothing, and anything
 * else is itself — as on the page.
 */
export function htmlAsText(value: string): string {
  const html = value.trim();
  if (BR.test(html)) return " ";
  return COMMENT.test(html) || INLINE_HTML_TAG.test(html) ? "" : value;
}

/**
 * The two pieces of HTML the reader understands. `<br>` is a line break: the editor writes an
 * empty paragraph as `<br />` and reads it back as one, and generated Markdown breaks a line
 * inside a table cell with it. A comment is not shown, which is what its author meant.
 *
 * Only those: every other piece of HTML stays text, so this lets no markup through.
 */
export function remarkKnownHtml() {
  return (tree: Root) => {
    visit(tree, "html", (node, index, parent) => {
      if (!parent || index === undefined) return;
      const html = node.value.trim();
      if (BR.test(html)) parent.children[index] = { type: "break" };
      else if (COMMENT.test(html)) {
        parent.children.splice(index, 1);
        return [SKIP, index];
      }
    });
  };
}
