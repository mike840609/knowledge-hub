import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import { CALLOUT_ATTRIBUTE, calloutKind } from "@/shared/markdown/remark-callouts";
import { INLINE_HTML_TAG } from "@/shared/markdown/remark-known-html";

/** A quote the reader will draw as a callout: its first line is the marker and nothing else. */
function calloutOf(quote: ProseNode): string | null {
  const paragraph = quote.firstChild;
  const line = paragraph?.type.name === "paragraph" ? paragraph.firstChild : null;
  if (!paragraph || !line?.isText) return null;
  // A line ends at a break (the editor holds a soft one as a node) or with the paragraph.
  const next = paragraph.maybeChild(1);
  if (next && next.type.name !== "hardbreak") return null;
  return calloutKind(line.text ?? "");
}

/**
 * The pairs of the inline HTML subset in one block of text, as `remark-html-subset.ts` pairs them:
 * a closing tag takes the nearest opening one of its name. What is between is given the element;
 * the two tags are marked as tags.
 */
function inlinePairs(block: ProseNode, start: number, found: Decoration[]): void {
  const open: { name: string; from: number; to: number }[] = [];
  block.forEach((child, offset) => {
    const match = child.type.name === "html" ? INLINE_HTML_TAG.exec(String(child.attrs.value)) : null;
    if (!match) return;
    const name = match[2].toLowerCase();
    const from = start + offset;
    const to = from + child.nodeSize;
    if (match[1] !== "/") {
      open.push({ name, from, to });
      return;
    }
    const at = open.map((entry) => entry.name).lastIndexOf(name);
    if (at === -1) return;
    const opening = open[at];
    open.length = at;
    found.push(Decoration.node(opening.from, opening.to, { class: "kh-html-tag" }), Decoration.node(from, to, { class: "kh-html-tag" }));
    if (from > opening.to) found.push(Decoration.inline(opening.to, from, { nodeName: name }));
  });
}

function hints(doc: ProseNode): DecorationSet {
  const found: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === "blockquote") {
      const kind = calloutOf(node);
      if (kind) found.push(Decoration.node(pos, pos + node.nodeSize, { [CALLOUT_ATTRIBUTE]: kind }));
    }
    if (node.isTextblock) inlinePairs(node, pos + 1, found);
  });
  return DecorationSet.create(doc, found);
}

const key = new PluginKey<DecorationSet>("khReaderHints");

/**
 * Shows, in the editor, what the reader will make of a callout and of the inline HTML subset
 * (docs/superpowers/specs/2026-10-12-editor-reader-hints-design.md).
 *
 * Decorations only. The document is not touched: `[!NOTE]` stays the first line of a quote and
 * `<u>` stays an `html` node, both there to be read and edited, and the Markdown written is what it
 * was without this. That is the point of doing it this way — nothing here can change what is saved.
 */
export const readerHints = $prose(
  () =>
    new Plugin({
      key,
      state: {
        init: (_config, state) => hints(state.doc),
        apply: (transaction, previous) => (transaction.docChanged ? hints(transaction.doc) : previous),
      },
      props: { decorations: (state) => key.getState(state) },
    }),
);
