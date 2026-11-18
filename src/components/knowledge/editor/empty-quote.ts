import { remarkStringifyOptionsCtx } from "@milkdown/kit/core";
import type { Ctx } from "@milkdown/kit/ctx";
import type { Blockquote } from "mdast";
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
    },
  }));
}
