import { closeHistory } from "@milkdown/kit/prose/history";
import { Fragment, Mark, Slice, type Node as ProseNode } from "@milkdown/kit/prose/model";
import { NodeSelection, Plugin, PluginKey, Selection, type EditorState, type Transaction } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet, type EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import { blockKind, selectedBlockPos, type BlockKind, type EditorBlock } from "./block-actions";
import { deleteBlocks, duplicateBlocks, moveBlocks, sequenceOf, turnBlocks } from "./block-sequence";

/**
 * Several blocks chosen at once (2026-11-20 multi-block spec). A block chosen with Escape is a node selection;
 * Shift-ArrowDown/Up then widens it to the blocks around it in its sequence (2026-11-21 block-unit spec, decision 3:
 * a list item is a block, and a nested item's sequence is its own list). The selection ProseMirror holds stays
 * that one node, at the block the range began at (`anchor`); the rest of the range is this plugin's state, drawn
 * with a decoration, and ends the moment the selection or the document changes by any other way.
 * Delete, duplicate, move and turn-into then act on the whole range, each one undo step (`block-sequence.ts`);
 * typing is ignored, so a stray key never replaces one block of several.
 */
export type BlockRange = { anchor: number; head: number };
type Range = BlockRange;
const key = new PluginKey<Range | null>("khBlockRange");
// A dead key (an accent waiting for its letter) starts a composition on some platforms before any keyCode says so.
const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const composing = (event: KeyboardEvent) => event.isComposing || event.keyCode === 229 || event.key === "Dead" || event.key === "Process";

const blocksIn = (doc: ProseNode, range: Range): EditorBlock[] => {
  const low = Math.min(range.anchor, range.head);
  const high = Math.max(range.anchor, range.head);
  return sequenceOf(doc, range.anchor).filter((block) => block.pos >= low && block.pos <= high);
};

/**
 * The same shape all the way down: types, text and marks, and the number of children, differing at most in attributes.
 * (A heading nested in a quote or a list is renumbered by the editor's heading-id plugin as much as a top-level one.)
 */
function sameShape(a: ProseNode, b: ProseNode): boolean {
  if (a === b) return true;
  if (a.type !== b.type || a.childCount !== b.childCount || a.text !== b.text || !Mark.sameSet(a.marks, b.marks)) return false;
  for (let index = 0; index < a.childCount; index++) if (!sameShape(a.child(index), b.child(index))) return false;
  return true;
}

/**
 * The same top-level blocks in the same places, differing at most in attributes. A move undone, or any edit that happens to
 * keep the document's size, is not that: the range's positions would point into other blocks.
 */
function sameBlocks(before: ProseNode, after: ProseNode): boolean {
  if (before.childCount !== after.childCount) return false;
  for (let index = 0; index < before.childCount; index++) if (!sameShape(before.child(index), after.child(index))) return false;
  return true;
}

/** The anchor block, when it is chosen as a node (a block taken with Escape). */
const chosenBlock = (state: EditorState): number | null => selectedBlockPos(state);

/** Mod-Alt-0…8 and Mod-Shift-7/8/9, as the single-block keys name them. */
const BY_DIGIT: Record<string, BlockKind> = { "0": "paragraph", "1": "h1", "2": "h2", "3": "h3", "4": "task", "5": "bullet", "6": "ordered", "7": "toggle", "8": "code" };
const SHIFT_DIGIT: Record<string, BlockKind> = { "7": "ordered", "8": "bullet", "9": "task" };

function setRange(view: EditorView, tr: Transaction, range: Range | null, scroll = true) {
  const done = closeHistory(tr.setMeta(key, range));
  view.dispatch(scroll ? done.scrollIntoView() : done);
  view.dispatch(closeHistory(view.state.tr));
}

/** Dispatches `tr` as one undo step, with `range` (null ends it) as the range afterwards. The grip menu and drag use it. */
export function setBlockRange(view: EditorView, tr: Transaction, range: BlockRange | null, scroll = true): void {
  setRange(view, tr, range, scroll);
}

/** The range's blocks, when it holds two or more; else null. */
export function rangeBlocks(state: EditorState): EditorBlock[] | null {
  const range = key.getState(state);
  if (!range) return null;
  const blocks = blocksIn(state.doc, range);
  return blocks.length > 1 ? blocks : null;
}

/** The range again over the blocks' new places, in its direction: the anchor's block stays the anchor. */
function relocated(range: Range, blocks: EditorBlock[], placed: EditorBlock[]): Range {
  const at = (pos: number) => placed[blocks.findIndex((block) => block.pos === pos)].pos;
  return { anchor: at(range.anchor), head: at(range.head) };
}

/**
 * Dispatches a duplicate or move of the whole range (`tr`, from `state`), keeping the range over `placed`, the blocks'
 * new places, in its direction: the anchor's block is chosen again. Shared by the keys, the grip menu and drag.
 */
export function keepRange(view: EditorView, state: EditorState, tr: Transaction, placed: EditorBlock[]): void {
  const range = key.getState(state);
  if (!range) { setRange(view, tr, null); return; }
  const next = relocated(range, blocksIn(state.doc, range), placed);
  tr.setSelection(NodeSelection.create(tr.doc, next.anchor));
  setRange(view, tr, next);
}

/** A closed clipboard slice. Each run of items keeps its source list and starts at its first copied number. */
function clipboardSlice(doc: ProseNode, blocks: EditorBlock[]): Slice {
  const nodes: ProseNode[] = [];
  for (let at = 0; at < blocks.length;) {
    const block = blocks[at];
    if (block.node.type.name !== "list_item") {
      nodes.push(block.node);
      at++;
      continue;
    }
    const $item = doc.resolve(block.pos);
    const list = $item.parent;
    const first = $item.index();
    const count = Math.min(list.childCount - first, blocks.length - at);
    const attrs = list.type.name === "ordered_list" ? { ...list.attrs, order: list.attrs.order + first } : list.attrs;
    const items: ProseNode[] = [];
    for (let index = first; index < first + count; index++) items.push(list.child(index));
    nodes.push(list.type.create(attrs, Fragment.fromArray(items), list.marks));
    at += count;
  }
  return new Slice(Fragment.fromArray(nodes), 0, 0);
}

/** Copy the chosen blocks, including the list wrapper a list-item node selection leaves out. */
function clip(view: EditorView, event: ClipboardEvent, cut: boolean): boolean {
  if (!view.editable || !event.clipboardData) return false;
  const { state } = view;
  const range = key.getState(state);
  let blocks: EditorBlock[];
  if (range) {
    blocks = blocksIn(state.doc, range);
  } else {
    const { selection } = state;
    if (!(selection instanceof NodeSelection) || selection.node.type.name !== "list_item" || selectedBlockPos(state) === null) return false;
    blocks = [{ pos: selection.from, node: selection.node }];
  }
  const { dom, text } = view.serializeForClipboard(clipboardSlice(state.doc, blocks));
  event.preventDefault();
  event.clipboardData.clearData();
  event.clipboardData.setData("text/html", dom.innerHTML);
  event.clipboardData.setData("text/plain", text);
  if (cut) setRange(view, deleteBlocks(view.state, blocks), null);
  return true;
}

export const blockRange = $prose(
  () =>
    new Plugin<Range | null>({
      key,
      state: {
        init: () => null,
        apply(transaction, previous, _old, state) {
          if (transaction.getMeta(key) !== undefined) return transaction.getMeta(key) as Range | null;
          if (previous === null) return null;
          // A change that only sets attributes (the heading ids the editor keeps in step after a copy of a heading)
          // moves nothing: the range stands, and `appendTransaction` gives the chosen block back its selection.
          if (transaction.docChanged) return sameBlocks(transaction.before, transaction.doc) ? previous : null;
          return chosenBlock(state) === previous.anchor ? previous : null;
        },
      },
      appendTransaction(transactions, _old, state) {
        const range = key.getState(state);
        if (!range || chosenBlock(state) === range.anchor || !transactions.some((transaction) => transaction.docChanged) || !sequenceOf(state.doc, range.anchor).some((block) => block.pos === range.anchor)) return null;
        return state.tr.setSelection(NodeSelection.create(state.doc, range.anchor)).setMeta(key, range).setMeta("addToHistory", false);
      },
      props: {
        decorations(state) {
          const range = key.getState(state);
          if (!range) return null;
          return DecorationSet.create(state.doc, blocksIn(state.doc, range).map((block) => Decoration.node(block.pos, block.pos + block.node.nodeSize, { class: "kh-block-in-range" })));
        },
        // Backstop for text that arrives by a path the keys do not see: it never replaces one block of several.
        handleTextInput(view) {
          const range = key.getState(view.state);
          return Boolean(range && blocksIn(view.state.doc, range).length > 1);
        },
        // Paste would replace the anchor block alone, as typing would: with a range it is refused.
        handlePaste(view, event) {
          const range = key.getState(view.state);
          if (!view.editable || !range || blocksIn(view.state.doc, range).length < 2) return false;
          event.preventDefault();
          return true;
        },
        handleDOMEvents: {
          copy: (view, event) => clip(view, event as ClipboardEvent, false),
          cut: (view, event) => clip(view, event as ClipboardEvent, true),
        },
        handleKeyDown(view, event) {
          if (!view.editable) return false;
          const { state } = view;
          const anchor = chosenBlock(state);
          if (anchor === null) return false;
          const range = key.getState(state);
          // An input method cannot be told to ignore its text: the range ends first, and what is composed goes into the
          // anchor block's text, the way a character typed with one block chosen does.
          if (composing(event)) {
            if (range && blocksIn(state.doc, range).length > 1) {
              const tr = state.tr.setSelection(Selection.near(state.doc.resolve(anchor + 1), 1));
              setRange(view, tr, null, false);
            }
            return false;
          }
          const plain = !event.metaKey && !event.ctrlKey && !event.altKey;
          const moveKey = event.key === "ArrowDown" || event.key === "ArrowUp";
          // Widen, or narrow: Shift-Arrow moves the far end of the range by one block.
          if (plain && event.shiftKey && moveKey) {
            const blocks = sequenceOf(state.doc, anchor);
            const at = blocks.findIndex((block) => block.pos === (range?.head ?? anchor));
            // A whole list chosen as one node is no block of a sequence: it has no range to widen.
            if (at < 0) return false;
            const next = at + (event.key === "ArrowDown" ? 1 : -1);
            // A sequence's ends stop it: a nested item's range never leaves its own list.
            if (next < 0 || next >= blocks.length) { event.preventDefault(); return true; }
            event.preventDefault();
            const head = blocks[next].pos;
            setRange(view, state.tr, head === anchor ? null : { anchor, head }, false);
            (view.nodeDOM(head) as HTMLElement | null)?.scrollIntoView?.({ block: "nearest" });
            return true;
          }
          if (!range) return false;
          const blocks = blocksIn(state.doc, range);
          if (blocks.length < 2) return false;
          // Backspace and Delete with Shift, Ctrl, Alt or Cmd (a word, a line) take the range, as the plain keys do: none of them
          // may take the anchor block alone. Ctrl-H is Backspace on a Mac (elsewhere it is the browser's history).
          if (event.key === "Backspace" || event.key === "Delete" || (isMac() && event.ctrlKey && !event.metaKey && !event.altKey && event.key.toLowerCase() === "h")) {
            event.preventDefault();
            setRange(view, deleteBlocks(state, blocks), null);
            return true;
          }
          if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key === "d") {
            event.preventDefault();
            const { tr, copies } = duplicateBlocks(state, blocks);
            // The copies keep the range's direction: the copy of the anchor block is the anchor.
            keepRange(view, state, tr, copies);
            return true;
          }
          if ((event.metaKey || event.ctrlKey) && event.shiftKey && !event.altKey && moveKey) {
            event.preventDefault();
            const all = sequenceOf(state.doc, anchor);
            // The place in the sequence without the range: one before it, or one after its next neighbour.
            const toIndex = all.findIndex((block) => block.pos === blocks[0].pos) + (event.key === "ArrowUp" ? -1 : 1);
            if (toIndex < 0 || toIndex > all.length - blocks.length) return true;
            const { tr, moved } = moveBlocks(state, blocks, toIndex);
            keepRange(view, state, tr, moved);
            return true;
          }
          // Ctrl+Alt is also AltGr on Windows: there only the character decides (AltGr+7 is `{` on a German keyboard, not a
          // turn key). Elsewhere the physical key does, so Shift and Option, which change `key`, still find their digit.
          const altGr = event.ctrlKey && event.altKey && !event.metaKey;
          const digit = (altGr ? null : /^Digit(\d)$/.exec(event.code ?? "")?.[1]) ?? (/^\d$/.test(event.key) ? event.key : null);
          const wanted = digit === null ? undefined : (event.metaKey || event.ctrlKey) && event.altKey && !event.shiftKey ? BY_DIGIT[digit] : (event.metaKey || event.ctrlKey) && event.shiftKey && !event.altKey ? SHIFT_DIGIT[digit] : undefined;
          if (wanted) {
            event.preventDefault();
            // The same kind on every block toggles it off; bottom first, so a block's position holds until it is done.
            const into = blocks.every((block) => blockKind(block.node) === wanted) ? "paragraph" : wanted;
            // One transaction for every block; lines and items made one list kind become one list.
            const tr = turnBlocks(state, blocks, into);
            if (tr) setRange(view, tr, null);
            return true;
          }
          // A character, with Shift or Option or AltGr as much as without, or Enter, would replace one block of several;
          // the range is left alone. Shortcuts (Ctrl or Cmd, not AltGr) go on: copy, cut, paste, undo, select all.
          const shortcut = event.metaKey || (event.ctrlKey && !event.altKey);
          if (!shortcut && (event.key.length === 1 || event.key === "Enter")) { event.preventDefault(); return true; }
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
