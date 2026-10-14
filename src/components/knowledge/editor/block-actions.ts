import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { closeHistory } from "@milkdown/kit/prose/history";
import { Selection, type Transaction } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";

export type EditorBlock = { pos: number; node: ProseNode };
export function topLevelBlocks(doc: ProseNode): EditorBlock[] {
  const blocks: EditorBlock[] = [];
  doc.forEach((node, pos) => blocks.push({ pos, node }));
  return blocks;
}

/** Each explicit block action is one undo step; typing afterward starts another. */
export function dispatchBlockAction(view: EditorView, transaction: Transaction, caret: number) {
  transaction.setSelection(Selection.near(transaction.doc.resolve(caret)));
  view.dispatch(closeHistory(transaction).scrollIntoView());
  view.dispatch(closeHistory(view.state.tr));
  view.focus();
}

export function insertBlockBelow(view: EditorView, pos: number): boolean {
  if (!view.editable) return false;
  const block = topLevelBlocks(view.state.doc).find(block => block.pos === pos);
  if (!block) return false;
  const after = pos + block.node.nodeSize;
  dispatchBlockAction(view, view.state.tr.insert(after, view.state.schema.nodes.paragraph.create()), after + 1);
  return true;
}

/** Both positions must be top-level boundaries in the document before the move. */
export function moveBlock(view: EditorView, from: number, before: number): boolean {
  if (!view.editable) return false;
  const blocks = topLevelBlocks(view.state.doc);
  const block = blocks.find(block => block.pos === from);
  if (!block || ![...blocks.map(block => block.pos), view.state.doc.content.size].includes(before)) return false;
  const end = from + block.node.nodeSize;
  if (before >= from && before <= end) return false;
  const insertion = before > from ? before - block.node.nodeSize : before;
  const transaction = view.state.tr.delete(from, end).insert(insertion, block.node);
  dispatchBlockAction(view, transaction, insertion + 1);
  return true;
}
