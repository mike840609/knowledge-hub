import { joinBackward } from "@milkdown/kit/prose/commands";
import type { Node as ProseNode, ResolvedPos } from "@milkdown/kit/prose/model";
import { TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { dispatchBlockAction } from "./block-actions";

function caretAtTextblockStart(view: EditorView): ResolvedPos | null {
  const { selection } = view.state;
  if (!(selection instanceof TextSelection) || !selection.$cursor || selection.$cursor.parentOffset !== 0) return null;
  return selection.$cursor;
}

/** Backspace at the start of the document's first textblock, inside a wrapper. Milkdown's Backspace
 * only joins textblocks, dropping ProseMirror's fallback that lifts the block out when nothing is
 * before it: a quote or callout opening the document could never be removed. Restore that fallback. */
export function liftAtDocumentStart(view: EditorView): boolean {
  if (!view.editable) return false;
  const $cursor = caretAtTextblockStart(view);
  if (!$cursor || $cursor.depth < 2) return false;
  for (let depth = 0; depth < $cursor.depth; depth++) {
    // Lists have their own Backspace; a table cell cannot be lifted out of.
    if ($cursor.index(depth) !== 0 || $cursor.node(depth).type.name === "list_item") return false;
  }
  return joinBackward(view.state, view.dispatch, view);
}

/** Backspace at the start of a list item holding nested lists, where joining and lifting fail:
 * the item either stayed put or left an empty bullet behind. Its nested items take its place in
 * the same list (Milkdown's list sync gives them that list's kind). An emptied item goes; the text
 * of a list's first item becomes a paragraph before the list, as an item without nested items is
 * lifted. A later item with text is left to the list's own join into the item above. */
export function liftListItemOverNested(view: EditorView): boolean {
  if (!view.editable) return false;
  const $cursor = caretAtTextblockStart(view);
  if (!$cursor || $cursor.depth < 3) return false;
  const item = $cursor.node(-1);
  if (item.type.name !== "list_item" || $cursor.index(-1) !== 0 || item.childCount < 2) return false;
  const empty = $cursor.parent.content.size === 0;
  if (!empty && $cursor.index(-2) !== 0) return false;
  const nested: ProseNode[] = [];
  for (let index = 1; index < item.childCount; index++) {
    const list = item.child(index);
    if (list.type.name !== "bullet_list" && list.type.name !== "ordered_list") return false;
    list.forEach(child => { nested.push(child); });
  }
  const itemPos = $cursor.before(-1);
  const tr = view.state.tr.replaceWith(itemPos, itemPos + item.nodeSize, nested);
  if (empty) {
    dispatchBlockAction(view, tr, itemPos + 2);
    return true;
  }
  const listPos = $cursor.before(-2);
  dispatchBlockAction(view, tr.insert(listPos, $cursor.parent), listPos + 1);
  return true;
}
