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

/** The block whose boundary is `pos`, whichever parent holds it: the document, or a list. */
export type BlockTarget = { pos: number; node: ProseNode; parent: ProseNode; index: number };
export function blockTarget(doc: ProseNode, pos: number): BlockTarget | null {
  if (pos < 0 || pos > doc.content.size) return null;
  const $pos = doc.resolve(pos);
  const parent = $pos.parent;
  // Only the document and a list hold blocks this editor gives actions to. A position inside a
  // paragraph (or a toggle body) is text, not a block boundary.
  if (parent.type.name !== "doc" && parent.type.name !== "bullet_list" && parent.type.name !== "ordered_list") return null;
  const index = $pos.index();
  if (index >= parent.childCount) return null;
  const node = parent.child(index);
  if (!parent.canReplaceWith(index, index + 1, node.type)) return null;
  return { pos, node, parent, index };
}

/** Every block in the same parent as `pos`, in document order — siblings, not the whole document. */
export function siblingBlocks(doc: ProseNode, pos: number): EditorBlock[] {
  const $pos = doc.resolve(pos);
  const start = $pos.start();
  const blocks: EditorBlock[] = [];
  $pos.parent.forEach((node, offset) => blocks.push({ pos: start + offset, node }));
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
  | "toggle"
  | "callout"
  | "other";

const LIST_KINDS: ReadonlySet<BlockKind> = new Set(["bullet", "ordered", "task"]);
const CALLOUT_MARKER = /^\[![A-Z]+\]/;

/** What the block is now, for the menu's labels and for which conversions keep every byte. */
export function blockKind(node: ProseNode): BlockKind {
  switch (node.type.name) {
    case "paragraph":
      return "paragraph";
    case "heading": {
      const level = Number(node.attrs.level);
      return level === 2 ? "h2" : level === 3 ? "h3" : level === 4 ? "h4" : level === 5 ? "h5" : level === 6 ? "h6" : "h1";
    }
    case "list_item": {
      if (node.attrs.checked != null) return "task";
      return node.attrs.listType === "ordered" ? "ordered" : "bullet";
    }
    case "bullet_list":
      return node.firstChild?.attrs.checked == null ? "bullet" : "task";
    case "ordered_list":
      return "ordered";
    case "blockquote":
      return CALLOUT_MARKER.test(node.firstChild?.firstChild?.textContent ?? "") ? "callout" : "quote";
    case "code_block":
      return "code";
    case "details":
      return "toggle";
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
  // A toggle holds a summary and a body; no single block conversion can keep both.
  if (node.type.name === "details") return false;
  // A toggle or callout is a wrapper of its own; only a paragraph's or heading's words can become one.
  if (target === "toggle" || target === "callout") return node.type.name === "paragraph" || node.type.name === "heading";
  if (node.type.name === "list_item") {
    // Another list keeps the item (and any nested list) whole, splitting the list around it.
    if (LIST_KINDS.has(target)) return true;
    // A leaf (paragraph, heading, quote, code) takes one textblock's words and nothing else.
    return node.childCount === 1 && node.firstChild?.isTextblock === true;
  }
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

/** A paragraph or heading becomes a toggle with its words as the summary, as Notion's Turn into does. */
function toggleFrom(node: ProseNode, schema: EditorView["state"]["schema"]): ProseNode {
  const title = schema.nodes.details_summary.create(null, node.textContent ? schema.text(node.textContent) : undefined);
  return schema.nodes.details.create({ open: true }, [title, schema.nodes.details_body.create(null, schema.nodes.paragraph.create())]);
}

/** A paragraph or heading becomes a Note callout; the marker is the one the reader recognises. */
function calloutFrom(node: ProseNode, schema: EditorView["state"]["schema"]): ProseNode {
  const marker = schema.nodes.paragraph.create(null, schema.text("[!NOTE]"));
  return schema.nodes.blockquote.create(null, [marker, schema.nodes.paragraph.create(null, inlineContent(node, schema))]);
}

/**
 * Turns one list item into another kind by splitting its list around it: the items before stay a
 * list, this item becomes the target, and the items after stay a list. Notion does the same when a
 * writer converts one bullet rather than the whole list.
 */
function turnListItemInto(view: EditorView, pos: number, item: ProseNode, target: BlockKind): boolean {
  if (!item.firstChild) return false;
  const schema = view.state.schema;
  const $item = view.state.doc.resolve(pos + 1);
  let itemDepth = -1;
  for (let depth = $item.depth; depth >= 1; depth--) {
    if ($item.node(depth).type.name === "list_item") { itemDepth = depth; break; }
  }
  if (itemDepth < 1) return false;
  const listDepth = itemDepth - 1;
  const list = $item.node(listDepth);
  const listPos = $item.before(listDepth);
  const index = $item.index(listDepth);
  const items: ProseNode[] = [];
  list.forEach((child) => items.push(child));
  let replacement: ProseNode;
  if (LIST_KINDS.has(target)) {
    // Keep the item whole, nested list and all; only its list kind (and to-do state) changes.
    const ordered = target === "ordered";
    const attrs = { ...item.attrs, listType: ordered ? "ordered" : "bullet", label: ordered ? "1." : "-", checked: target === "task" ? false : null };
    const converted = item.type.create(attrs, item.content);
    replacement = (ordered ? schema.nodes.ordered_list : schema.nodes.bullet_list).create(ordered ? { order: 1 } : null, converted);
  } else {
    replacement = leafFrom(item.firstChild, target as LeafKind, schema);
  }
  const pieces: ProseNode[] = [];
  if (index > 0) pieces.push(list.type.create(list.attrs, Fragment.fromArray(items.slice(0, index))));
  pieces.push(replacement);
  if (index < items.length - 1) {
    // An ordered list that goes on after the new block goes on from its number.
    const after = list.type === schema.nodes.ordered_list ? { ...list.attrs, order: (Number(list.attrs.order) || 1) + index + 1 } : list.attrs;
    pieces.push(list.type.create(after, Fragment.fromArray(items.slice(index + 1))));
  }
  const at = listPos + (index > 0 ? pieces[0].nodeSize : 0);
  dispatchBlockAction(view, view.state.tr.replaceWith(listPos, listPos + list.nodeSize, pieces), target === "quote" ? at + 2 : at + 1);
  return true;
}

/**
 * Replaces one block with another kind, preserving inline content. A list of several items becomes
 * several paragraphs; a list item splits its list around the result; every other conversion is one
 * block. One undo step, caret in the result.
 */
export function turnBlockInto(view: EditorView, pos: number, target: BlockKind): boolean {
  if (!view.editable || target === "other" || target === "h4" || target === "h5" || target === "h6") return false;
  const found = blockTarget(view.state.doc, pos);
  const block = found ? { pos: found.pos, node: found.node } : null;
  if (!block || !canTurnInto(block.node, target)) return false;
  const schema = view.state.schema;
  if (target === "toggle" || target === "callout") {
    const replacement = target === "toggle" ? toggleFrom(block.node, schema) : calloutFrom(block.node, schema);
    const caret = pos + 1 + replacement.firstChild!.nodeSize + 1;
    dispatchBlockAction(view, view.state.tr.replaceWith(pos, pos + block.node.nodeSize, replacement), target === "toggle" ? caret + 1 : caret);
    return true;
  }
  if (block.node.type.name === "list_item") return turnListItemInto(view, pos, block.node, target);
  if (target === "paragraph" && (block.node.type.name === "bullet_list" || block.node.type.name === "ordered_list")) {
    const paragraphs: ProseNode[] = [];
    block.node.forEach((item) => paragraphs.push(paragraphFrom(item, schema)));
    const transaction = view.state.tr.replaceWith(pos, pos + block.node.nodeSize, paragraphs);
    dispatchBlockAction(view, transaction, pos + 1);
    return true;
  }
  if (target === "paragraph" && block.node.type.name === "blockquote") {
    const callout = blockKind(block.node) === "callout";
    const paragraphs: ProseNode[] = [];
    block.node.forEach((child) => {
      // The marker is the callout's kind, not its prose; turning it into text drops it.
      if (callout && CALLOUT_MARKER.test(child.textContent)) return;
      paragraphs.push(schema.nodes.paragraph.create(null, child.content));
    });
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
  const target = blockTarget(view.state.doc, pos);
  if (!target) return false;
  const at = pos + target.node.nodeSize;
  dispatchBlockAction(view, view.state.tr.insert(at, target.node.copy(target.node.content)), at + 1);
  return true;
}

/** Removes the block; the document keeps one empty paragraph if it would otherwise be empty. */
export function deleteBlock(view: EditorView, pos: number): boolean {
  if (!view.editable) return false;
  const target = blockTarget(view.state.doc, pos);
  if (!target) return false;
  const end = pos + target.node.nodeSize;
  if (target.parent.type.name === "doc") {
    if (target.parent.childCount === 1) {
      const paragraph = view.state.schema.nodes.paragraph.create();
      dispatchBlockAction(view, view.state.tr.replaceWith(pos, end, paragraph), pos + 1);
      return true;
    }
    dispatchBlockAction(view, view.state.tr.delete(pos, end), pos);
    return true;
  }
  if (target.parent.type.name === "bullet_list" || target.parent.type.name === "ordered_list") {
    if (target.parent.childCount > 1) {
      dispatchBlockAction(view, view.state.tr.delete(pos, end), pos);
      return true;
    }
    // The item is the list's only one. A list cannot stand empty: remove the list itself (or leave
    // an empty paragraph where it was the document's only block).
    const $pos = view.state.doc.resolve(pos);
    const listPos = $pos.before($pos.depth);
    const listEnd = listPos + target.parent.nodeSize;
    if ($pos.depth === 1) {
      const paragraph = view.state.schema.nodes.paragraph.create();
      dispatchBlockAction(view, view.state.tr.replaceWith(listPos, listEnd, paragraph), listPos + 1);
    } else {
      dispatchBlockAction(view, view.state.tr.delete(listPos, listEnd), listPos);
    }
    return true;
  }
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
  const target = blockTarget(view.state.doc, pos);
  if (!target) return false;
  const after = pos + target.node.nodeSize;
  if (target.parent.type.name === "bullet_list" || target.parent.type.name === "ordered_list") {
    // A new sibling item, as Notion's + does on an item; a task list's new item starts unchecked.
    const attrs = { ...target.node.attrs, checked: target.node.attrs.checked == null ? null : false };
    const item = view.state.schema.nodes.list_item.create(attrs, view.state.schema.nodes.paragraph.create());
    dispatchBlockAction(view, view.state.tr.insert(after, item), after + 2);
    return true;
  }
  dispatchBlockAction(view, view.state.tr.insert(after, view.state.schema.nodes.paragraph.create()), after + 1);
  return true;
}

/** Moves a block in front of a sibling boundary. Both positions must share the block's parent. */
export function moveBlock(view: EditorView, from: number, before: number): boolean {
  if (!view.editable) return false;
  const target = blockTarget(view.state.doc, from);
  if (!target) return false;
  const siblings = siblingBlocks(view.state.doc, from);
  const end = siblings.length ? siblings[siblings.length - 1].pos + siblings[siblings.length - 1].node.nodeSize : view.state.doc.content.size;
  if (![...siblings.map(block => block.pos), end].includes(before)) return false;
  const after = from + target.node.nodeSize;
  if (before >= from && before <= after) return false;
  const insertion = before > from ? before - target.node.nodeSize : before;
  const transaction = view.state.tr.delete(from, after).insert(insertion, target.node);
  dispatchBlockAction(view, transaction, insertion + 1);
  return true;
}
