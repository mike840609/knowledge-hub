import { HeadingSlugger } from "@/shared/markdown/heading-slug";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CALLOUTS } from "../markdown-callout";
import type { CalloutKind } from "@/shared/markdown/remark-callouts";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { Plugin, PluginKey, TextSelection, type EditorState } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import { dispatchBlockAction } from "./block-actions";
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

/** Backspace where a hidden marker would swallow visible text: either the start of the
 * paragraph right after a marker paragraph, or right after the break in a paragraph that
 * holds both. Drops the marker (and the break): the callout becomes a plain quote and every
 * word stays visible. One undo step. */
export function handleCalloutBackspace(view: EditorView): boolean {
  if (!view.editable) return false;
  const { selection } = view.state;
  if (!(selection instanceof TextSelection) || !selection.empty) return false;
  const { $from } = selection;
  if ($from.parent.type.name !== "paragraph" || $from.depth < 2) return false;
  const quote = $from.node($from.depth - 1);
  if (quote.type.name !== "blockquote" || !calloutOf(quote)) return false;
  const index = $from.index($from.depth - 1);
  // Marker paragraph followed by a body paragraph: drop the invisible marker.
  if ($from.parentOffset === 0 && index === 1) {
    const markerPos = $from.before($from.depth - 1) + 1;
    const marker = quote.firstChild!;
    const tr = view.state.tr.delete(markerPos, markerPos + marker.nodeSize);
    dispatchBlockAction(view, tr, tr.mapping.map($from.pos));
    return true;
  }
  // Marker and body share one paragraph split by a break: drop the marker and the break.
  if (index === 0) {
    const marker = $from.parent.firstChild;
    const second = $from.parent.childCount > 1 ? $from.parent.child(1) : null;
    if (marker?.isText && second?.type.name === "hardbreak" && calloutKind(marker.text ?? "") && $from.parentOffset === marker.nodeSize + 1) {
      const contentStart = $from.before($from.depth) + 1;
      const tr = view.state.tr.delete(contentStart, $from.pos);
      dispatchBlockAction(view, tr, tr.mapping.map($from.pos));
      return true;
    }
  }
  return false;
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

/** The body position for a caret in a hidden marker; null means this note has no body yet. */
function hiddenMarker(state: EditorState): { body: number | null; end: number } | undefined {
  const { $from, empty } = state.selection;
  if (!empty || !(state.selection instanceof TextSelection)) return;
  for (let depth = $from.depth; depth > 0; depth--) {
    const quote = $from.node(depth);
    if (quote.type.name !== "blockquote" || !calloutOf(quote) || $from.index(depth) !== 0) continue;
    const paragraph = quote.firstChild!;
    const start = $from.before(depth);
    const markerEnd = start + 2 + paragraph.firstChild!.nodeSize;
    if ($from.pos > markerEnd) return;
    const body = paragraph.childCount > 1
      ? markerEnd + 1
      : quote.childCount > 1 ? start + 1 + paragraph.nodeSize + 1 : null;
    return { body, end: start + quote.nodeSize - 1 };
  }
}

function hints(doc: ProseNode): DecorationSet {
  const found: Decoration[] = [];
  const slugger = new HeadingSlugger();
  doc.descendants((node, pos) => {
    if (node.type.name === "heading") found.push(Decoration.node(pos, pos + node.nodeSize, { id: slugger.slug(node.textContent) }));
    if (node.type.name === "blockquote") {
      const kind = calloutOf(node);
      if (kind) {
        found.push(Decoration.node(pos, pos + node.nodeSize, { [CALLOUT_ATTRIBUTE]: kind, role: "note" }));
        const paragraph = node.firstChild!;
        const marker = paragraph.firstChild!;
        if (paragraph.childCount === 1) {
          found.push(Decoration.node(pos + 1, pos + 1 + paragraph.nodeSize, { class: "kh-callout-marker" }));
        } else {
          found.push(Decoration.inline(pos + 2, pos + 2 + marker.nodeSize + (paragraph.maybeChild(1)?.type.name === "hardbreak" ? 1 : 0), { class: "kh-callout-marker" }));
        }
        found.push(Decoration.widget(pos + 1, () => {
          const { title, Icon, glyph } = CALLOUTS[kind as CalloutKind];
          const label = document.createElement("div");
          label.className = "kh-callout-title flex items-center gap-2 font-medium";
          // Only a bundled icon is parsed, never author-supplied HTML.
          const svg = new DOMParser().parseFromString(renderToStaticMarkup(createElement(Icon, { "aria-hidden": true, className: `h-4 w-4 shrink-0 ${glyph}` })), "image/svg+xml").documentElement;
          label.append(document.importNode(svg, true), document.createTextNode(title));
          return label;
        }, { key: `callout-${kind}`, side: -1 }));
      }
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
 * `<u>` stays an `html` node, the marker hidden behind its title, and the Markdown written is what it
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
      appendTransaction(transactions, _previous, state) {
        if (!transactions.some(transaction => transaction.selectionSet || transaction.docChanged)) return null;
        const marker = hiddenMarker(state);
        if (marker?.body == null) return null;
        return state.tr.setSelection(TextSelection.near(state.doc.resolve(marker.body)));
      },
      props: {
        decorations: (state) => key.getState(state),
        handleTextInput(view, _from, _to, text) {
          const marker = hiddenMarker(view.state);
          if (!view.editable || !marker || marker.body !== null) return false;
          const { schema } = view.state;
          const tr = view.state.tr.insert(marker.end, schema.nodes.paragraph.create(null, schema.text(text)));
          tr.setSelection(TextSelection.create(tr.doc, marker.end + 1 + text.length));
          view.dispatch(tr);
          return true;
        },
      },
    }),
);
