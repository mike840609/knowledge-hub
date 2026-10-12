import { remarkStringifyOptionsCtx } from "@milkdown/kit/core";
import type { Ctx } from "@milkdown/kit/ctx";
import type { Root } from "mdast";
import { defaultHandlers } from "mdast-util-to-markdown";
import { visit } from "unist-util-visit";
import { isLineBreakHtml } from "@/shared/markdown/remark-known-html";

/**
 * A `<br>` between other things in a table cell is a line break, and is held as one: the reader
 * shows it as a break, and as an `html` node the editor would show the tag.
 *
 * Not the last thing in a cell. Milkdown drops a break that ends a cell on the way out, and reads
 * a cell that is only a `<br>` as an empty one; left as it is, that one is written back as it was.
 */
export function remarkCellBreaks() {
  return (tree: Root) => {
    visit(tree, "html", (node, index, parent) => {
      if (parent?.type !== "tableCell" || index === undefined || index === parent.children.length - 1) return;
      if (isLineBreakHtml(node.value)) parent.children[index] = { type: "break" };
    });
  };
}

/**
 * The other half: a break in a table cell is written as `<br />`. Markdown cannot hold a line
 * ending inside a table row, so the serialiser's own handler writes a space there and the line
 * comes back joined. Everywhere else the break is that handler's to write. Breaks at the end of a
 * cell are written as nothing: Milkdown already drops the last one, and a line with nothing on it
 * shows as nothing.
 *
 * Shift+Enter makes one (`editor-core.ts` lifts Milkdown's refusal of it in a table), and so does a pasted table.
 */
export function configureCellBreakStringify(ctx: Ctx): void {
  ctx.update(remarkStringifyOptionsCtx, (previous) => ({
    ...previous,
    handlers: {
      ...previous.handlers,
      break: (node, parent, state, info) => {
        if (!state.stack.includes("tableCell")) return defaultHandlers.break(node, parent, state, info);
        // Breaks that end a cell show nothing and are not kept, however many were typed.
        const after = parent?.type === "tableCell" ? parent.children.slice(parent.children.indexOf(node) + 1) : [node];
        return after.every((next) => next.type === "break") ? "" : "<br />";
      },
    },
  }));
}
