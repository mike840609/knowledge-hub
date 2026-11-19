import { remarkStringifyOptionsCtx } from "@milkdown/kit/core";
import type { Ctx } from "@milkdown/kit/ctx";
import type { Blockquote, Paragraph } from "mdast";
import { defaultHandlers } from "mdast-util-to-markdown";

/**
 * A quote holding nothing but one empty paragraph is written as an empty quote, `>`, which reads back as that same
 * quote. Milkdown writes an empty paragraph as `<br />` so a blank line survives; inside a quote that would leave a
 * tag a writer never typed (`> <br />`) where a list in a quote was emptied (2026-11-21 block-unit spec, deviations).
 * The document's own last empty paragraph is already written as nothing, by Milkdown; this is the same rule for a quote
 * that is otherwise empty. Every other quote, and every other empty paragraph, is written as before.
 */
export function configureEmptyQuoteStringify(ctx: Ctx): void {
  ctx.update(remarkStringifyOptionsCtx, (previous) => ({
    ...previous,
    handlers: {
      ...previous.handlers,
      blockquote: (node: Blockquote, parent, state, info) => {
        const only = node.children.length === 1 ? node.children[0] : null;
        const line = only?.type === "paragraph" && only.children.length === 1 ? only.children[0] : null;
        if (line?.type === "html" && line.value === "<br />") return ">";
        return defaultHandlers.blockquote(node, parent, state, info);
      },
      // A list item whose first line is empty and which goes on with a nested list is written without that line
      // (`-` and the nested list below), which reads back as the same item. Written `- <br />`, the indented lines
      // after it would read back as part of that HTML, and the nested list would be lost (2026-11-21 list commands
      // spec, deviations). The item itself is still written by the list item handler in force (GFM's, for a to-do).
      paragraph: (node: Paragraph, parent, state, info) => {
        const line = node.children.length === 1 ? node.children[0] : null;
        // A to-do keeps `[ ] <br />`: after its box the tag is inline, not an HTML block, so the nested list reads back.
        // A loose item keeps it too: the blank line after a bare `-` would end the item, and there the blank line
        // already ends the HTML block, so what follows reads back inside the item.
        if (parent?.type === "listItem" && parent.checked == null && !parent.spread && parent.children.length > 1 && parent.children[0] === node && parent.children[1].type === "list" && line?.type === "html" && line.value === "<br />") return "";
        return (previous.handlers?.paragraph ?? defaultHandlers.paragraph)(node, parent, state, info);
      },
    },
  }));
}
