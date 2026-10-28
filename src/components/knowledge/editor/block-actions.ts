import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { Fragment } from "@milkdown/kit/prose/model";
import { closeHistory } from "@milkdown/kit/prose/history";
import { Selection, type Transaction } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";

export type EditorBlock = { pos: number; node: ProseNode };
export function topLevelBlocks(doc: ProseNode): EditorBlock[] {
  const blocks: EditorBlock[] = [];
  doc.forEach((node, pos) => blocks.push({ pos, node }));
  return blocks;
}

export type BlockKind =
  | "paragraph"
  | "h1"
  | "h2"
  | "h3"
  | "h4"
  | "h5"
  | "h6"
  | "bullet"
  | "ordered"
  | "task"
  | "quote"
  | "code"
  | "other";

const LIST_KINDS: ReadonlySet<BlockKind> = new Set(["bullet", "ordered", "task"]);

/** What the block is now, for the menu's labels and for which conversions keep every byte. */
export function blockKind(node: ProseNode): BlockKind {
  switch (node.type.name) {
    case "paragraph":
      return "paragraph";
    case "heading": {
      const level = Number(node.attrs.level);
      return level === 2 ? "h2" : level === 3 ? "h3" : level === 4 ? "h4" : level === 5 ? "h5" : level === 6 ? "h6" : "h1";
    }
    case "bullet_list":
      return node.firstChild?.attrs.checked == null ? "bullet" : "task";
    case "ordered_list":
      return "ordered";
    case "blockquote":
      return "quote";
    case "code_block":
      return "code";
    default:
      return "other";
  }
}

/**
 * A conversion that would drop content is not offered. A list of several
 * items can become paragraphs (one each) or another list, but not a single
 * heading, quote or code block: the other items would disappear.
 */
export function canTurnInto(node: ProseNode, target: BlockKind): boolean {
  const current = blockKind(node);
  if (current === "other" || current === target) return false;
  const list = node.type.name === "bullet_list" || node.type.name === "ordered_list";
  if (list) {
    // Every item must be a single textblock: a nested list has content a
    // paragraph or heading cannot carry, and dropping it is not a "turn into".
    let simple = node.childCount > 0;
    node.forEach((item) => {
      if (item.childCount !== 1 || !item.firstChild?.isTextblock) simple = false;
    });
    if (!simple) return false;
    // Another list keeps every item; a leaf block needs a single item's text.
    return target === "paragraph" || LIST_KINDS.has(target) || node.childCount === 1;
  }
  if (node.type.name === "blockquote") {
    let paragraphs = node.childCount > 0;
    node.forEach((child) => { if (!child.isTextblock) paragraphs = false; });
    if (target === "paragraph") return paragraphs;
    return node.childCount === 1 && node.firstChild?.isTextblock === true;
  }
  return true;
}

/** The inline content a leaf block would take from this one, without its block wrapper. */
function inlineContent(node: ProseNode, schema: EditorView["state"]["schema"]): Fragment {
  if (node.isTextblock) return node.content;
  if (node.type.name === "code_block") return node.textContent ? Fragment.from(schema.text(node.textContent)) : Fragment.empty;
  let found: Fragment = Fragment.empty;
  node.descendants((child) => {
    if (found.size > 0) return false;
    if (child.isTextblock) {
      found = child.content;
      return false;
    }
    return true;
  });
  return found;
}

function paragraphFrom(node: ProseNode, schema: EditorView["state"]["schema"]): ProseNode {
  return schema.nodes.paragraph.create(null, inlineContent(node, schema));
}

function listFrom(node: ProseNode, target: BlockKind, schema: EditorView["state"]["schema"]): ProseNode {
  const ordered = target === "ordered";
  const itemAttrs = (checked: boolean | null, index: number) => ({
    listType: ordered ? "ordered" : "bullet",
    label: ordered ? `${index + 1}.` : "-",
    ...(checked === null ? {} : { checked }),
  });
  if (node.type.name === "bullet_list" || node.type.name === "ordered_list") {
    const items: ProseNode[] = [];
    node.forEach((item, _offset, index) => {
      items.push(schema.nodes.list_item.create(itemAttrs(target === "task" ? false : null, index), item.content));
    });
    return (ordered ? schema.nodes.ordered_list : schema.nodes.bullet_list).create(ordered ? { order: 1 } : null, items);
  }
  const item = schema.nodes.list_item.create(itemAttrs(target === "task" ? false : null, 0), paragraphFrom(node, schema));
  return (ordered ? schema.nodes.ordered_list : schema.nodes.bullet_list).create(ordered ? { order: 1 } : null, item);
}

type LeafKind = "paragraph" | "h1" | "h2" | "h3" | "quote" | "code";

function leafFrom(node: ProseNode, target: LeafKind, schema: EditorView["state"]["schema"]): ProseNode {
  const inline = inlineContent(node, schema);
  switch (target) {
    case "paragraph":
      return schema.nodes.paragraph.create(null, inline);
    case "h1":
    case "h2":
    case "h3":
      return schema.nodes.heading.create({ level: Number(target.slice(1)) }, inline);
    case "quote":
      return schema.nodes.blockquote.create(null, schema.nodes.paragraph.create(null, inline));
    case "code": {
      // `textContent` drops a hard break entirely; a code block must keep the
      // line the writer sees. `leafText` supplies the newline for hard breaks.
      const text = node.type.name === "code_block" ? node.textContent : node.textBetween(0, node.content.size, "\n", "\n");
      return schema.nodes.code_block.create(null, text ? schema.text(text) : undefined);
    }
  }
}

/**
 * Replaces one top-level block with another kind, preserving inline content.
 * A list of several items becomes several paragraphs; every other conversion
 * is one block. One undo step, caret in the result.
 */
export function turnBlockInto(view: EditorView, pos: number, target: BlockKind): boolean {
  if (!view.editable || target === "other" || target === "h4" || target === "h5" || target === "h6") return false;
  const block = topLevelBlocks(view.state.doc).find((candidate) => candidate.pos === pos);
  if (!block || !canTurnInto(block.node, target)) return false;
  const schema = view.state.schema;
  if (target === "paragraph" && (block.node.type.name === "bullet_list" || block.node.type.name === "ordered_list")) {
    const paragraphs: ProseNode[] = [];
    block.node.forEach((item) => paragraphs.push(paragraphFrom(item, schema)));
    const transaction = view.state.tr.replaceWith(pos, pos + block.node.nodeSize, paragraphs);
    dispatchBlockAction(view, transaction, pos + 1);
    return true;
  }
  if (target === "paragraph" && block.node.type.name === "blockquote") {
    const paragraphs: ProseNode[] = [];
    block.node.forEach((child) => paragraphs.push(schema.nodes.paragraph.create(null, child.content)));
    const transaction = view.state.tr.replaceWith(pos, pos + block.node.nodeSize, paragraphs);
    dispatchBlockAction(view, transaction, pos + 1);
    return true;
  }
  const replacement = LIST_KINDS.has(target)
    ? listFrom(block.node, target, schema)
    : leafFrom(block.node, target as LeafKind, schema);
  const caret = target === "quote" ? pos + 2 : pos + 1;
  dispatchBlockAction(view, view.state.tr.replaceWith(pos, pos + block.node.nodeSize, replacement), caret);
  return true;
}

/** A copy of the block immediately below it, with the caret at the copy's start. */
export function duplicateBlock(view: EditorView, pos: number): boolean {
  if (!view.editable) return false;
  const block = topLevelBlocks(view.state.doc).find((candidate) => candidate.pos === pos);
  if (!block) return false;
  const at = pos + block.node.nodeSize;
  dispatchBlockAction(view, view.state.tr.insert(at, block.node.copy(block.node.content)), at + 1);
  return true;
}

/** Removes the block; the document keeps one empty paragraph if it would otherwise be empty. */
export function deleteBlock(view: EditorView, pos: number): boolean {
  if (!view.editable) return false;
  const blocks = topLevelBlocks(view.state.doc);
  const index = blocks.findIndex((candidate) => candidate.pos === pos);
  if (index < 0) return false;
  const block = blocks[index];
  const end = pos + block.node.nodeSize;
  if (blocks.length === 1) {
    const paragraph = view.state.schema.nodes.paragraph.create();
    dispatchBlockAction(view, view.state.tr.replaceWith(pos, end, paragraph), pos + 1);
    return true;
  }
  // After the deletion `pos` is the start of the following block, or the end
  // of the previous one when the last block was removed.
  dispatchBlockAction(view, view.state.tr.delete(pos, end), pos);
  return true;
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
