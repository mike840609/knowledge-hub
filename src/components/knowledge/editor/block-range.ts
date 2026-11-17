import { closeHistory } from "@milkdown/kit/prose/history";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { NodeSelection, Plugin, PluginKey, Selection, type EditorState, type Transaction } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet, type EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import { blockKind, topLevelBlocks, turnBlockInto, type BlockKind, type EditorBlock } from "./block-actions";

/**
 * Several top-level blocks chosen at once (2026-11-20 multi-block spec). A block chosen with Escape is a node
 * selection; Shift-ArrowDown/Up then widens it to the blocks around it. The selection ProseMirror holds stays
 * that one node, at the block the range began at (`anchor`); the rest of the range is this plugin's state, drawn
 * with a decoration, and ends the moment the selection or the document changes by any other way.
 * Delete, duplicate, move and turn-into then act on the whole range; typing is ignored, so a stray key never
 * replaces one block of several.
 */
type Range = { anchor: number; head: number };
const key = new PluginKey<Range | null>("khBlockRange");
const composing = (event: KeyboardEvent) => event.isComposing || event.keyCode === 229;

const blocksIn = (doc: ProseNode, range: Range): EditorBlock[] => {
  const low = Math.min(range.anchor, range.head);
  const high = Math.max(range.anchor, range.head);
  return topLevelBlocks(doc).filter((block) => block.pos >= low && block.pos <= high);
};

/** The anchor block, when it is chosen as a node (a block taken with Escape). */
const chosenBlock = (state: EditorState): number | null =>
  state.selection instanceof NodeSelection && state.selection.$from.depth === 0 ? state.selection.from : null;

/** Mod-Alt-0…8 and Mod-Shift-7/8/9, as the single-block keys name them. */
const BY_DIGIT: Record<string, BlockKind> = { "0": "paragraph", "1": "h1", "2": "h2", "3": "h3", "4": "task", "5": "bullet", "6": "ordered", "7": "toggle", "8": "code" };
const SHIFT_DIGIT: Record<string, BlockKind> = { "7": "ordered", "8": "bullet", "9": "task" };

function setRange(view: EditorView, tr: Transaction, range: Range | null) {
  view.dispatch(closeHistory(tr.setMeta(key, range)).scrollIntoView());
  view.dispatch(closeHistory(view.state.tr));
}

export const blockRange = $prose(
  () =>
    new Plugin<Range | null>({
      key,
      state: {
        init: () => null,
        apply(transaction, previous, _old, state) {
          if (transaction.getMeta(key) !== undefined) return transaction.getMeta(key) as Range | null;
          if (previous === null || transaction.docChanged || chosenBlock(state) !== previous.anchor) return null;
          return previous;
        },
      },
      props: {
        decorations(state) {
          const range = key.getState(state);
          if (!range) return null;
          return DecorationSet.create(state.doc, blocksIn(state.doc, range).map((block) => Decoration.node(block.pos, block.pos + block.node.nodeSize, { class: "kh-block-in-range" })));
        },
        handleKeyDown(view, event) {
          if (!view.editable || composing(event)) return false;
          const { state } = view;
          const anchor = chosenBlock(state);
          if (anchor === null) return false;
          const range = key.getState(state);
          const plain = !event.metaKey && !event.ctrlKey && !event.altKey;
          const moveKey = event.key === "ArrowDown" || event.key === "ArrowUp";
          // Widen, or narrow: Shift-Arrow moves the far end of the range by one block.
          if (plain && event.shiftKey && moveKey) {
            const blocks = topLevelBlocks(state.doc);
            const at = blocks.findIndex((block) => block.pos === (range?.head ?? anchor));
            const next = at + (event.key === "ArrowDown" ? 1 : -1);
            if (at < 0 || next < 0 || next >= blocks.length) { event.preventDefault(); return true; }
            event.preventDefault();
            const head = blocks[next].pos;
            setRange(view, state.tr, head === anchor ? null : { anchor, head });
            (view.nodeDOM(head) as HTMLElement | null)?.scrollIntoView?.({ block: "nearest" });
            return true;
          }
          if (!range) return false;
          const blocks = blocksIn(state.doc, range);
          if (blocks.length < 2) return false;
          const from = blocks[0].pos;
          const last = blocks[blocks.length - 1];
          const to = last.pos + last.node.nodeSize;
          // A character or Enter would replace one block of several; the range is left alone instead.
          if (plain && !event.shiftKey && (event.key.length === 1 || event.key === "Enter")) { event.preventDefault(); return true; }
          if (plain && !event.shiftKey && (event.key === "Backspace" || event.key === "Delete")) {
            event.preventDefault();
            const whole = from === 0 && to === state.doc.content.size;
            const tr = whole ? state.tr.replaceWith(from, to, state.schema.nodes.paragraph.create()) : state.tr.delete(from, to);
            tr.setSelection(Selection.near(tr.doc.resolve(Math.min(from + (whole ? 1 : 0), tr.doc.content.size)), -1));
            setRange(view, tr, null);
            return true;
          }
          if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key === "d") {
            event.preventDefault();
            const tr = state.tr.insert(to, blocks.map((block) => block.node));
            const copies = tr.doc.nodeAt(to + (last.pos - from)) ? to + (last.pos - from) : to;
            tr.setSelection(NodeSelection.create(tr.doc, to));
            setRange(view, tr, { anchor: to, head: copies });
            return true;
          }
          if ((event.metaKey || event.ctrlKey) && event.shiftKey && !event.altKey && moveKey) {
            event.preventDefault();
            const all = topLevelBlocks(state.doc);
            const index = all.findIndex((block) => block.pos === from);
            const up = event.key === "ArrowUp";
            const neighbour = up ? all[index - 1] : all[index + blocks.length];
            if (!neighbour) return true;
            const size = neighbour.node.nodeSize;
            const tr = state.tr.delete(neighbour.pos, neighbour.pos + size);
            // Up: the one above goes below the range. Down: the one below goes above it.
            tr.insert(up ? to - size : from, neighbour.node);
            const shift = up ? -size : size;
            tr.setSelection(NodeSelection.create(tr.doc, anchor + shift));
            setRange(view, tr, { anchor: anchor + shift, head: range.head + shift });
            return true;
          }
          const digit = /^Digit(\d)$/.exec(event.code ?? "")?.[1] ?? (/^\d$/.test(event.key) ? event.key : null);
          const wanted = digit === null ? undefined : (event.metaKey || event.ctrlKey) && event.altKey && !event.shiftKey ? BY_DIGIT[digit] : (event.metaKey || event.ctrlKey) && event.shiftKey && !event.altKey ? SHIFT_DIGIT[digit] : undefined;
          if (wanted) {
            event.preventDefault();
            // The same kind on every block toggles it off; bottom first, so a block's position holds until it is done.
            const into = blocks.every((block) => blockKind(block.node) === wanted) ? "paragraph" : wanted;
            const { nodes } = state.schema;
            // Lines made lists become one list, an item each, not a list apiece.
            if ((into === "bullet" || into === "ordered" || into === "task") && blocks.every((block) => block.node.type === nodes.paragraph || block.node.type === nodes.heading)) {
              const ordered = into === "ordered";
              const items = blocks.map((block) => nodes.list_item.create({ listType: ordered ? "ordered" : "bullet", label: ordered ? "1." : "-", ...(into === "task" ? { checked: false } : {}) }, nodes.paragraph.create(null, block.node.content)));
              const list = (ordered ? nodes.ordered_list : nodes.bullet_list).create(ordered ? { order: 1 } : null, items);
              const tr = state.tr.replaceWith(from, to, list);
              tr.setSelection(Selection.near(tr.doc.resolve(from + 1)));
              setRange(view, tr, null);
              return true;
            }
            for (const block of [...blocks].reverse()) turnBlockInto(view, block.pos, into);
            return true;
          }
          return false;
        },
      },
      view(view) {
        // What a screen reader is told, as the gutter's own live region does for its actions.
        const live = document.createElement("div");
        live.className = "sr-only";
        live.setAttribute("aria-live", "polite");
        view.dom.parentElement?.appendChild(live);
        let said = 0;
        return {
          update(next) {
            const range = key.getState(next.state);
            const count = range ? blocksIn(next.state.doc, range).length : 0;
            if (count !== said) { said = count; live.textContent = count > 1 ? `${count} blocks selected` : ""; }
          },
          destroy() { live.remove(); },
        };
      },
    }),
);
