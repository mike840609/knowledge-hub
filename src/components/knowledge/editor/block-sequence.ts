import type { Node as ProseNode, NodeType } from "@milkdown/kit/prose/model";
import { AllSelection, NodeSelection, Selection, type EditorState, type Transaction } from "@milkdown/kit/prose/state";
import { blockKind, canTurnInto, turnInto, type BlockKind, type EditorBlock } from "./block-actions";

/**
 * Sequences of blocks, and the range operations on them, each one undoable step
 * (docs/superpowers/specs/2026-11-21-block-unit-design.md, decisions 3 and 4).
 *
 * A block is a top-level block that is not a list, or a list item with whatever is nested under it. The top-level
 * sequence is every top-level non-list block plus every item of every top-level list, in document order; a nested
 * item's sequence is its own list's items. Delete, duplicate, move and a turn into a list read the region they touch
 * into entries (a plain block, or an item with the key of the list it came from), edit the entries, and regroup
 * them: consecutive items with one key become one list. The region is then replaced in one step, so lists split and
 * join by one rule, and a block is only ever re-wrapped, never re-serialised (a wikilink stays a `wiki_link` node).
 * Every function returns an undispatched transaction.
 */

const isList = (node: ProseNode) => node.type.name === "bullet_list" || node.type.name === "ordered_list";
const LIST_TARGETS: ReadonlySet<BlockKind> = new Set(["bullet", "ordered", "task"]);

/** The sequence holding the block at `pos`: the top-level one, or a nested item's own list. */
export function sequenceOf(doc: ProseNode, pos: number): EditorBlock[] {
  const $pos = doc.resolve(pos);
  const node = doc.nodeAt(pos);
  if ($pos.depth > 1 && node?.type.name === "list_item") {
    const start = $pos.start();
    const items: EditorBlock[] = [];
    $pos.parent.forEach((item, offset) => items.push({ pos: start + offset, node: item }));
    return items;
  }
  if ($pos.depth > 1 || ($pos.depth === 1 && node?.type.name !== "list_item")) return [];
  const blocks: EditorBlock[] = [];
  doc.forEach((child, offset) => {
    if (!isList(child)) { blocks.push({ pos: offset, node: child }); return; }
    child.forEach((item, inner) => blocks.push({ pos: offset + 1 + inner, node: item }));
  });
  return blocks;
}

/**
 * One block of a region: a plain block (`key` null), or an item with the key of its list. `number` is an ordered
 * item's number before the edit, `first` marks its list's first item, and `join` a block moved, copied or turned into
 * place (it has left its list).
 */
type Entry = { node: ProseNode; pos: number; key: number | null; number: number | null; first: boolean; join: boolean };
/** A list as it was: its type and attributes, and where it stood (`pos`…`end`), to tell lists already side by side. */
type ListInfo = { type: NodeType; attrs: Record<string, unknown>; pos: number; end: number };
type Region = { from: number; to: number; entries: Entry[]; lists: Map<number, ListInfo>; base: number; whole: boolean };

/** The region spanning sequence indices `lo`…`hi`: the top-level nodes holding them, or a nested sequence's list. */
function readRegion(doc: ProseNode, sequence: EditorBlock[], lo: number, hi: number): Region {
  const $first = doc.resolve(sequence[0].pos);
  const nested = $first.depth > 1;
  const top = (pos: number) => { const $pos = doc.resolve(pos); return $pos.depth === 0 ? pos : $pos.before(1); };
  const from = nested ? $first.before($first.depth) : top(sequence[lo].pos);
  const last = top(sequence[hi].pos);
  const to = nested ? from + $first.parent.nodeSize : last + doc.nodeAt(last)!.nodeSize;
  const entries: Entry[] = [];
  const lists = new Map<number, ListInfo>();
  const read = (node: ProseNode, pos: number) => {
    if (!isList(node)) { entries.push({ node, pos, key: null, number: null, first: false, join: false }); return; }
    lists.set(pos, { type: node.type, attrs: node.attrs, pos, end: pos + node.nodeSize });
    const order = Number(node.attrs.order ?? 1);
    node.forEach((item, offset, index) => entries.push({ node: item, pos: pos + 1 + offset, key: pos, number: order + index, first: index === 0, join: false }));
  };
  if (nested) read($first.parent, from);
  else doc.nodesBetween(from, to, (node, pos) => { read(node, pos); return false; });
  const base = sequence.findIndex((block) => block.pos === entries[0].pos);
  return { from, to, entries, lists, base, whole: !nested && from === 0 && to === doc.content.size };
}

/**
 * Joins neighbouring items of one list type that sit in different lists. A block moved, copied or turned there joins
 * its neighbour; for a copy or a turn only an item of the same kind (a task beside a task). For a move the kind does
 * not matter (an item rejoins a list of task and plain items alike), and two lists neither moved join only where the
 * move left them side by side, never where they already stood so. The joined list keeps the key of a list that was
 * there before, so its attributes (start, looseness) stay; between two such, the earlier one's.
 */
function join(entries: Entry[], lists: Map<number, ListInfo>, move: boolean) {
  for (let index = 1; index < entries.length; index++) {
    const previous = entries[index - 1];
    const current = entries[index];
    if (previous.key === null || current.key === null || previous.key === current.key) continue;
    const before = lists.get(previous.key)!;
    const after = lists.get(current.key)!;
    if (before.type !== after.type) continue;
    if (!move && blockKind(previous.node) !== blockKind(current.node)) continue;
    if (!previous.join && !current.join && (!move || before.end === after.pos)) continue;
    const target = previous.key >= 0 || current.key < 0 ? previous.key : current.key;
    const [left, right] = [previous.key, current.key];
    for (let at = index - 1; at >= 0 && entries[at].key === left; at--) entries[at].key = target;
    for (let at = index; at < entries.length && entries[at].key === right; at++) entries[at].key = target;
  }
}

/**
 * Entries back into nodes: consecutive items with one key become one list with that list's attributes. An ordered
 * list's numbers: the part holding its first item keeps the list's start; the rest of a split keeps its numbers
 * (2026-11-17) through `order`; items that left their list start at 1. Gives each entry's offset from the start.
 */
function regroup(entries: Entry[], lists: Map<number, ListInfo>) {
  const nodes: ProseNode[] = [];
  const offsets = new Map<Entry, number>();
  let size = 0;
  for (let index = 0; index < entries.length;) {
    const entry = entries[index];
    if (entry.key === null) {
      offsets.set(entry, size);
      nodes.push(entry.node);
      size += entry.node.nodeSize;
      index++;
      continue;
    }
    const key = entry.key;
    const run: Entry[] = [];
    while (index < entries.length && entries[index].key === key) run.push(entries[index++]);
    const { type, attrs } = lists.get(key)!;
    const order = type.name !== "ordered_list" || run.some((item) => item.first) ? null : run[0].join || run[0].number === null ? 1 : run[0].number;
    let inner = size + 1;
    for (const item of run) { offsets.set(item, inner); inner += item.node.nodeSize; }
    const list = type.create(order === null ? attrs : { ...attrs, order }, run.map((item) => item.node));
    nodes.push(list);
    size += list.nodeSize;
  }
  return { nodes, offsets };
}

/** The sequence and the first and last indices of `blocks`, a run of it in document order. */
function locate(state: EditorState, blocks: EditorBlock[]) {
  const sequence = sequenceOf(state.doc, blocks[0].pos);
  const first = sequence.findIndex((member) => member.pos === blocks[0].pos);
  if (first < 0 || sequence[first + blocks.length - 1]?.pos !== blocks[blocks.length - 1].pos) throw new RangeError("The blocks are not a run of one sequence");
  return { sequence, first, last: first + blocks.length - 1 };
}

/** The region replaced by the regrouped entries; `chosen` are the entries whose new places the caller is given. */
function replace(state: EditorState, region: Region, entries: Entry[], chosen: Entry[]) {
  const { nodes, offsets } = regroup(entries, region.lists);
  const tr = state.tr.replaceWith(region.from, region.to, nodes);
  const placed = chosen.map((entry): EditorBlock => ({ pos: region.from + offsets.get(entry)!, node: entry.node }));
  tr.setSelection(NodeSelection.create(tr.doc, placed[0].pos));
  return { tr, placed };
}

/**
 * Removes every block. A list left with no items goes; a container left empty (the document, or a quote) keeps one
 * empty paragraph. Two lists of one type that the delete leaves side by side join, as a move joins them; two that
 * already stood so stay two.
 */
export function deleteBlocks(state: EditorState, blocks: EditorBlock[]): Transaction {
  const { sequence, first, last } = locate(state, blocks);
  // One block either side as well: the neighbours the delete may leave side by side.
  const region = readRegion(state.doc, sequence, Math.max(0, first - 1), Math.min(sequence.length - 1, last + 1));
  const gone = new Set(blocks.map((block) => block.pos));
  const kept = region.entries.filter((entry) => !gone.has(entry.pos));
  // A list whose first item went starts where its first item now is: a deletion renumbers, it does not split.
  for (const key of region.lists.keys()) {
    const remaining = kept.find((entry) => entry.key === key);
    if (remaining && !kept.some((entry) => entry.key === key && entry.first)) remaining.first = true;
  }
  join(kept, region.lists, true);
  const { nodes, offsets } = regroup(kept, region.lists);
  if (!nodes.length && (region.whole || state.doc.resolve(region.from).parent.childCount === 1)) nodes.push(state.schema.nodes.paragraph.create());
  const tr = state.tr.replaceWith(region.from, region.to, nodes);
  // The caret goes to the end of the block before the first one removed.
  const firstGone = region.entries.findIndex((entry) => gone.has(entry.pos));
  const before = kept.filter((entry) => region.entries.indexOf(entry) < firstGone).pop();
  const caret = before ? region.from + offsets.get(before)! + before.node.nodeSize : region.from;
  tr.setSelection(Selection.near(tr.doc.resolve(Math.min(caret, tr.doc.content.size)), -1));
  return tr;
}

/** Copies of the blocks after the last one; copies of items that follow an item join its list. */
export function duplicateBlocks(state: EditorState, blocks: EditorBlock[]): { tr: Transaction; copies: EditorBlock[] } {
  const { sequence, first, last } = locate(state, blocks);
  const region = readRegion(state.doc, sequence, first, last);
  const start = first - region.base;
  const end = start + blocks.length;
  const copies = region.entries.slice(start, end).map((entry): Entry => ({ ...entry, node: entry.node.copy(entry.node.content), first: false, join: true }));
  const entries = [...region.entries.slice(0, end), ...copies, ...region.entries.slice(end)];
  join(entries, region.lists, false);
  const { tr, placed } = replace(state, region, entries, copies);
  return { tr, copies: placed };
}

/**
 * Moves the blocks to `toIndex` of the sequence with them taken out. An item keeps its kind: it joins a list of its
 * kind beside it where it lands, else it forms a list of its own. Two lists of one kind the move leaves side by side join.
 */
export function moveBlocks(state: EditorState, blocks: EditorBlock[], toIndex: number): { tr: Transaction; moved: EditorBlock[] } {
  const { sequence, first, last } = locate(state, blocks);
  const count = blocks.length;
  if (toIndex < 0 || toIndex > sequence.length - count) throw new RangeError(`No place ${toIndex} to move to`);
  // Both places are in the region: where the blocks were (their neighbours may join) and where they land.
  const original = (index: number) => index < first ? index : index + count;
  const touched = [first - 1, first, last, last + 1, original(toIndex - 1), original(toIndex)].filter((index) => index >= 0 && index < sequence.length);
  const region = readRegion(state.doc, sequence, Math.min(...touched), Math.max(...touched));
  const start = first - region.base;
  // A fresh key for each list the moved items came from; `join` gives them a neighbouring list's key.
  const fresh = new Map<number, number>();
  const moving = region.entries.slice(start, start + count).map((entry): Entry => {
    if (entry.key === null) return { ...entry, join: true };
    if (!fresh.has(entry.key)) {
      const key = -1 - fresh.size;
      fresh.set(entry.key, key);
      region.lists.set(key, region.lists.get(entry.key)!);
    }
    return { ...entry, key: fresh.get(entry.key)!, join: true };
  });
  const rest = [...region.entries.slice(0, start), ...region.entries.slice(start + count)];
  const at = toIndex - region.base;
  const entries = [...rest.slice(0, at), ...moving, ...rest.slice(at)];
  join(entries, region.lists, true);
  const { tr, placed } = replace(state, region, entries, moving);
  return { tr, moved: placed };
}

/**
 * Turns every block, one undo step. Paragraphs, headings and items turned into one list kind become one list (an
 * item already of that kind stays as it is); any other turn is each block's own, bottom first on one transaction.
 * Null when no block could be turned.
 */
export function turnBlocks(state: EditorState, blocks: EditorBlock[], into: BlockKind): Transaction | null {
  // All or nothing: a block that cannot take the turn (and is not that kind already) refuses it for the range.
  if (!blocks.length || !blocks.every((block) => blockKind(block.node) === into || canTurnInto(block.node, into))) return null;
  const { nodes } = state.schema;
  const lines = blocks.every((block) => block.node.type === nodes.paragraph || block.node.type === nodes.heading || block.node.type === nodes.list_item);
  if (LIST_TARGETS.has(into) && lines) {
    const { sequence, first, last } = locate(state, blocks);
    const region = readRegion(state.doc, sequence, first, last);
    const ordered = into === "ordered";
    const key = -1;
    region.lists.set(key, { type: ordered ? nodes.ordered_list : nodes.bullet_list, attrs: ordered ? { order: 1 } : {}, pos: -1, end: -1 });
    const itemAttrs = (attrs: Record<string, unknown>) => ({ ...attrs, listType: ordered ? "ordered" : "bullet", label: ordered ? "1." : "-", checked: into === "task" ? false : null });
    const chosen = new Set(blocks.map((block) => block.pos));
    const entries = region.entries.map((entry): Entry => {
      if (!chosen.has(entry.pos) || blockKind(entry.node) === into) return entry;
      const item = entry.key === null
        ? nodes.list_item.create(itemAttrs({}), nodes.paragraph.create(null, entry.node.content))
        : entry.node.type.create(itemAttrs(entry.node.attrs), entry.node.content);
      return { ...entry, node: item, key, number: null, first: false, join: true };
    });
    join(entries, region.lists, false);
    const { nodes: replaced, offsets } = regroup(entries, region.lists);
    const tr = state.tr.replaceWith(region.from, region.to, replaced);
    tr.setSelection(Selection.near(tr.doc.resolve(region.from + offsets.get(entries[first - region.base])! + 1)));
    return tr;
  }
  const tr = state.tr;
  let caret: number | null = null;
  for (const block of [...blocks].reverse()) caret = turnInto(tr, block.pos, into) ?? caret;
  if (caret === null) return null;
  tr.setSelection(Selection.near(tr.doc.resolve(caret)));
  return tr;
}

/**
 * The blocks of one sequence that the text selection's `from`…`to` touches (2026-11-21 list-commands spec, decision 6).
 * Each end is in a chain of blocks, outermost first: its top-level block, then each list item around it. The sequence
 * is the deepest one both ends are in, so a selection inside one item is that item, not its list, and one that runs from
 * a nested item out to its parent's sibling is the two top-level items. An end at the very start of a later textblock
 * touches none of its text, and does not take that block.
 */
export function blocksTouched(state: EditorState): EditorBlock[] {
  const { doc, selection } = state;
  // Select all holds no position inside a block: every top-level block of the document is touched.
  if (selection instanceof AllSelection) return sequenceOf(doc, 0);
  const { $from } = selection;
  let { $to } = selection;
  if (!selection.empty && $to.parentOffset === 0 && $to.pos > $from.end()) $to = doc.resolve(Math.max($from.pos, Selection.near(doc.resolve($to.pos - 1), -1).from));
  // Each level is the block at that level and the list (or, for the top level, -1) whose sequence it belongs to.
  const chain = ($pos: typeof $from) => {
    const levels: { pos: number; sequence: number }[] = [];
    for (let depth = 1; depth <= $pos.depth; depth++) {
      const node = $pos.node(depth);
      if (depth === 1 && !isList(node)) levels.push({ pos: $pos.before(1), sequence: -1 });
      else if (node.type.name === "list_item") levels.push({ pos: $pos.before(depth), sequence: depth === 2 ? -1 : $pos.before(depth - 1) });
    }
    return levels;
  };
  const start = chain($from);
  const end = chain($to);
  let level = -1;
  while (level + 1 < Math.min(start.length, end.length) && start[level + 1].sequence === end[level + 1].sequence) {
    level++;
    if (start[level].pos !== end[level].pos) break;
  }
  if (level < 0) return [];
  const from = start[level].pos;
  const to = end[level].pos;
  return sequenceOf(doc, from).filter((block) => block.pos >= from && block.pos <= to);
}
