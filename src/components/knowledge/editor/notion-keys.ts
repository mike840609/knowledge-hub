import { commandsCtx } from "@milkdown/kit/core";
import type { MilkdownPlugin } from "@milkdown/kit/ctx";
import { setBlockType } from "@milkdown/kit/prose/commands";
import { closeHistory } from "@milkdown/kit/prose/history";
import { InputRule, undoInputRule } from "@milkdown/kit/prose/inputrules";
import { liftListItem, wrapInList } from "@milkdown/kit/prose/schema-list";
import { AllSelection, NodeSelection, Plugin, PluginKey, Selection, TextSelection, type EditorState, type Transaction } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { toggleStrikethroughCommand } from "@milkdown/kit/preset/gfm";
import { addRowAfter, goToNextCell, isInTable } from "@milkdown/kit/prose/tables";
import { customInputRulesKey } from "@milkdown/kit/prose";
import type { Mark, Node as ProseNode } from "@milkdown/kit/prose/model";
import { ReplaceStep } from "@milkdown/kit/prose/transform";
import { $inputRule, $prose, $useKeymap } from "@milkdown/kit/utils";
import { blockKind, canTurnInto, deleteBlock, duplicateBlock, isBlockItem, moveBlock, selectedBlockPos, siblingBlocks, turnBlockInto, turnInto, type BlockKind } from "./block-actions";
import { blockRange, rangeBlocks } from "./block-range";
import { blocksTouched, moveBlocks, sequenceOf, turnBlocks } from "./block-sequence";
import { flipNearestDetails } from "./details-toggle";
import { findWikiLinkTrigger } from "./link-suggestions";

/**
 * The typing rules and keys a Notion writer reaches for
 * (`docs/superpowers/specs/2026-11-15-editor-notion-parity-design.md`, decisions 1–8). All of them
 * go through the rendered editor, so a document's `[[wikilinks]]` are written back as they were read.
 */

const composing = (event: KeyboardEvent) => event.isComposing || event.keyCode === 229;

// ---- Input rules (2, 3) ---------------------------------------------------------------------

/** The mark the caret would type with: stored marks first, as ProseMirror does. */
function hasCodeAt(state: EditorState, pos: number): boolean {
  const marks = state.storedMarks ?? state.doc.resolve(pos).marks();
  return marks.some((mark) => mark.type.name === "inlineCode" || mark.type.name === "code_inline");
}

/** `[] `, `[ ] ` and `[x] ` at the start of a paragraph: a to-do item (inside a list item, as Milkdown's own rule). */
const todoInputRule = $inputRule(
  () =>
    new InputRule(/^\[(?<checked>[ x]?)\]\s$/, (state, match, start, end) => {
      const $start = state.doc.resolve(start);
      if ($start.parent.type.name !== "paragraph" || $start.parentOffset !== 0) return null;
      const checked = match.groups?.checked === "x";
      const { nodes } = state.schema;
      const tr = state.tr.delete(start, end);
      const itemDepth = $start.depth - 1;
      if (itemDepth >= 1 && $start.node(itemDepth).type.name === "list_item") {
        const item = $start.node(itemDepth);
        if (item.attrs.checked != null) return null;
        // Only the item's first line makes it a to-do; in a later paragraph it is just text.
        if ($start.index(itemDepth) !== 0) return null;
        return tr.setNodeMarkup($start.before(itemDepth), undefined, { ...item.attrs, checked });
      }
      if ($start.depth !== 1) return null;
      const paragraph = tr.doc.resolve(start).parent;
      const item = nodes.list_item.create({ listType: "bullet", label: "-", checked }, paragraph);
      const list = nodes.bullet_list.create(null, item);
      const before = $start.before(1);
      tr.replaceWith(before, before + paragraph.nodeSize, list);
      return tr.setSelection(TextSelection.create(tr.doc, before + 3));
    }),
);

/**
 * Inside a `[[target` still being typed, by the rule the `[[` list itself uses (`findWikiLinkTrigger`):
 * the target is a title or path and must stay as written. A stray `[[` far back in a paragraph is
 * not one, so it does not turn replacements off for the rest of it.
 */
function inWikiTarget(state: EditorState, pos: number): boolean {
  const $pos = state.doc.resolve(pos);
  return findWikiLinkTrigger($pos.parent.textBetween(0, $pos.parentOffset, undefined, "\n")) !== null;
}

function replacement(regexp: RegExp, symbol: string) {
  return $inputRule(
    () =>
      new InputRule(regexp, (state, _match, start, end) => {
        if (hasCodeAt(state, start) || inWikiTarget(state, start)) return null;
        return state.tr.insertText(symbol, start, end);
      }),
  );
}

const typography = [
  replacement(/(?<!-)->$/, "→"),
  replacement(/<-$/, "←"),
  replacement(/\(c\)$/, "©"),
  replacement(/\(r\)$/, "®"),
  replacement(/\(tm\)$/, "™"),
];

// ---- A mark ends at its closing delimiter (1) ----------------------------------------------------

/**
 * Where the caret is just after an input rule closed a mark (`**x**`), until anything else happens.
 * Milkdown's rule asks for the next character to be unmarked, but a browser then re-reports the caret,
 * ProseMirror drops the stored marks when a selection is set, and the character lands inside the mark.
 */
type MarkEnd = { pos: number; marks: readonly Mark[] } | null;
const markEndKey = new PluginKey<MarkEnd>("khMarkEnd");
const markEnd = $prose(
  () =>
    new Plugin<MarkEnd>({
      key: markEndKey,
      state: {
        init: () => null,
        apply(tr, previous) {
          // Milkdown's `markRule` ends by asking for no stored marks (`setStoredMarks([])`); no other rule does.
          if (tr.getMeta(customInputRulesKey) && tr.storedMarks?.length === 0) {
            const marks = tr.doc.resolve(tr.selection.from).marks();
            return marks.length ? { pos: tr.selection.from, marks } : null;
          }
          if (tr.docChanged) return null;
          return previous && tr.selectionSet && tr.selection.from !== previous.pos ? null : previous;
        },
      },
      // After the fact, not in `handleTextInput`: that one runs before the input rules, and the character
      // typed next may itself close another rule (`~~x~` then `~`).
      appendTransaction(transactions, oldState, newState) {
        const ended = markEndKey.getState(oldState);
        if (!ended || oldState.storedMarks?.length) return null; // Marks the writer chose (Mod-b) are theirs.
        const changed = transactions.filter((tr) => tr.docChanged);
        if (changed.length !== 1 || changed[0].steps.length !== 1) return null;
        const step = changed[0].steps[0];
        if (!(step instanceof ReplaceStep) || step.from !== ended.pos || step.to !== ended.pos || step.slice.openStart || step.slice.openEnd) return null;
        let text = step.slice.size > 0;
        step.slice.content.forEach((node) => { text &&= node.isText; });
        if (!text) return null;
        const tr = newState.tr;
        for (const mark of ended.marks) tr.removeMark(step.from, step.from + step.slice.size, mark.type);
        return tr.docChanged ? tr : null;
      },
    }),
);

// ---- Commands ---------------------------------------------------------------------------------

/** Backspace at the start of a heading, any level: a paragraph. An input rule just applied is undone first. */
const headingToParagraph = (state: EditorState, dispatch?: (tr: ReturnType<EditorState["tr"]["setMeta"]>) => void, view?: EditorView) => {
  const { selection } = state;
  if (!(selection instanceof TextSelection) || !selection.$cursor) return false;
  const { $cursor } = selection;
  if ($cursor.parent.type.name !== "heading" || $cursor.parentOffset !== 0) return false;
  if (undoInputRule(state)) return false;
  return setBlockType(state.schema.nodes.paragraph)(state, dispatch as never, view);
};

/** The top-level block the selection is in, or is: a block selected with Escape counts as the current one. */
const topBlockPos = (state: EditorState): number | null => {
  const { selection } = state;
  if (selection instanceof NodeSelection && selection.$from.depth === 0) return selection.from;
  return selection.$from.depth >= 1 ? selection.$from.before(1) : null;
};

/** The block a writer's own action (duplicate, move) is about: a list item is its own block. */
const actionBlockPos = (state: EditorState): number | null => {
  const { selection } = state;
  const chosen = selectedBlockPos(state);
  if (chosen !== null) return chosen;
  const { $from } = selection;
  for (let depth = $from.depth; depth >= 1; depth--) {
    if ($from.node(depth).type.name === "list_item") return $from.before(depth);
  }
  return $from.depth >= 1 ? $from.before(1) : null;
};

function listKindAt(state: EditorState): BlockKind | null {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth >= 1; depth--) {
    if ($from.node(depth).type.name !== "list_item") continue;
    const list = $from.node(depth - 1);
    if (list.type.name === "ordered_list") return "ordered";
    return $from.node(depth).attrs.checked == null ? "bullet" : "task";
  }
  return null;
}

/** The depth of the list item the selection is in, or null. */
function listItemDepth(state: EditorState): number | null {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth >= 1; depth--) if ($from.node(depth).type.name === "list_item") return depth;
  return null;
}

/**
 * A list of the given kind, or the item lifted back to a paragraph when it already is one. Only the
 * caret's item changes and the caret stays where it was, in one transaction (one undo step). An item
 * in a list of the other kind is cut out of it: the items before and after stay in their list, and the
 * item, with whatever is nested under it, becomes a list of its own.
 */
function toggleList(target: "ordered" | "bullet" | "task") {
  return (state: EditorState, dispatch?: (tr: Transaction) => void, view?: EditorView) => {
    if (!view?.editable || !(state.selection instanceof TextSelection || state.selection instanceof NodeSelection)) return false;
    // A whole block chosen with Escape (a heading, a list, a quote, a list item) is turned into the list
    // as the block menu turns it: there is no caret to keep. A list of that kind already toggles off, into
    // its paragraphs.
    const chosen = selectedBlockPos(state);
    if (state.selection instanceof NodeSelection && chosen !== null) {
      const into = blockKind(state.selection.node) === target ? "paragraph" : target;
      if (!canTurnInto(state.selection.node, into)) return false;
      return dispatch ? turnBlockInto(view, chosen, into) : true;
    }
    const { nodes } = state.schema;
    const kind = listKindAt(state);
    if (kind === target) return liftListItem(nodes.list_item)(state, dispatch);
    const depth = listItemDepth(state);
    if (depth === null) return wrapParagraph(state, target, dispatch);
    const { $from, $to } = state.selection;
    if ($to.pos > $from.end(depth)) return false;
    if (!dispatch) return true;
    const itemPos = $from.before(depth);
    const tr = state.tr;
    const turnedItemPos = turnInto(tr, itemPos, target);
    if (turnedItemPos === null) return false;
    const shift = turnedItemPos - itemPos;
    tr.setSelection(state.selection instanceof NodeSelection
      ? NodeSelection.create(tr.doc, $from.pos + shift)
      : TextSelection.create(tr.doc, $from.pos + shift, $to.pos + shift));
    dispatch(tr.scrollIntoView());
    return true;
  };
}

/**
 * A paragraph or heading that is not in a list becomes the first item of a new one, caret kept. A list
 * item starts with a paragraph, so every heading the selection reaches becomes one (`# H` and `## I`
 * selected together make `- H` / `- I`), as Notion's list keys do.
 */
function wrapParagraph(state: EditorState, target: "ordered" | "bullet" | "task", dispatch?: (tr: Transaction) => void): boolean {
  const { nodes } = state.schema;
  const { $from, $to } = state.selection;
  let tr = state.tr;
  if ($from.parent.type === nodes.heading) tr = tr.setBlockType($from.pos, $to.pos, nodes.paragraph);
  const wrapped = wrapInList(target === "ordered" ? nodes.ordered_list : nodes.bullet_list)(state.apply(tr), (next) => {
    for (const step of next.steps) tr.step(step);
    tr.setSelection(next.selection.getBookmark().resolve(tr.doc));
  });
  if (!wrapped) return false;
  if (!dispatch) return true;
  if (target === "task") {
    const now = tr.selection.$from;
    for (let depth = now.depth; depth >= 1; depth--) {
      if (now.node(depth).type !== nodes.list_item) continue;
      tr.setNodeMarkup(now.before(depth), undefined, { ...now.node(depth).attrs, checked: false });
      break;
    }
  }
  dispatch(tr.scrollIntoView());
  return true;
}

function moveCurrentBlock(direction: -1 | 1) {
  return (state: EditorState, dispatch?: unknown, view?: EditorView) => {
    const pos = actionBlockPos(state);
    if (pos === null || !view?.editable) return false;
    // The block moves past its neighbour in its sequence (2026-11-21 block-unit spec, R2), chosen with Escape or
    // holding the caret alike: a paragraph passes one item, not the whole list, and an item at its list's end leaves
    // the list. A chosen block stays chosen; the caret stays where it was in the block's words.
    const sequence = sequenceOf(state.doc, pos);
    const at = sequence.findIndex((block) => block.pos === pos);
    if (at >= 0) {
      const toIndex = at + direction;
      if (toIndex < 0 || toIndex >= sequence.length) return true;
      if (!dispatch) return true;
      const { tr, moved } = moveBlocks(state, [sequence[at]], toIndex);
      if (selectedBlockPos(state) === null) {
        // The region is replaced, so mapping would not carry the caret: the block's content is the same node, so the
        // caret's offsets from the block's start still hold.
        const shift = moved[0].pos - pos;
        const { selection } = state;
        const inside = selection.from >= pos && selection.to <= pos + sequence[at].node.nodeSize;
        // A selection reaching past the block (into the next ones) cannot go with it: the caret goes to the start of
        // the moved block's words, as a move did before. Any other selection (cells of a table) gives way likewise.
        if (inside && selection instanceof NodeSelection) tr.setSelection(NodeSelection.create(tr.doc, selection.from + shift));
        else if (inside && selection instanceof TextSelection) tr.setSelection(TextSelection.create(tr.doc, selection.anchor + shift, selection.head + shift));
        else tr.setSelection(Selection.near(tr.doc.resolve(moved[0].pos + 1)));
      }
      view.dispatch(closeHistory(tr).scrollIntoView());
      view.dispatch(closeHistory(view.state.tr));
      return true;
    }
    const blocks = siblingBlocks(state.doc, pos);
    const index = blocks.findIndex((block) => block.pos === pos);
    const neighbour = blocks[index + direction];
    if (!neighbour) return true; // At the edge: nothing to do, and the browser has nothing for this key either.
    // `moveBlock` takes the boundary the block goes in front of.
    const before = direction < 0 ? neighbour.pos : neighbour.pos + neighbour.node.nodeSize;
    return dispatch ? moveBlock(view, pos, before) || true : true;
  };
}

const duplicateCurrentBlock = (state: EditorState, dispatch?: unknown, view?: EditorView) => {
  const pos = actionBlockPos(state);
  if (pos === null || !view?.editable) return false;
  return dispatch ? duplicateBlock(view, pos) : true;
};

/** The innermost textblock's text first; the whole document on a second press, or at once when it is empty or already all selected. */
const selectAllInSteps = (state: EditorState, dispatch?: (tr: never) => void) => {
  const { selection } = state;
  if (selection instanceof AllSelection || !(selection instanceof TextSelection)) return false;
  const { $from, $to } = selection;
  const block = $from.parent;
  if (!block.isTextblock || $from.sameParent($to) === false || block.content.size === 0) return false;
  const start = $from.start();
  const end = $from.end();
  if (selection.from === start && selection.to === end) return false;
  dispatch?.(state.tr.setSelection(TextSelection.create(state.doc, start, end)) as never);
  return true;
};

// ---- Tab in a table and in code being edited (18, 19) ---------------------------------------------

/** Tab in the last cell: a row below with the same columns, and the caret in its first cell. Any other cell is left to Milkdown's own Tab. */
const tabInLastCell = (state: EditorState, dispatch?: (tr: never) => void, view?: EditorView) => {
  if (!view?.editable || !isInTable(state) || goToNextCell(1)(state)) return false;
  if (!dispatch) return addRowAfter(state);
  if (!addRowAfter(state, dispatch as never)) return false;
  goToNextCell(1)(view.state, dispatch as never);
  return true;
};

/** The start of every line the selection touches, in code_block text. Positions are in the document. */
function lineStarts(state: EditorState): number[] {
  const { $from, $to } = state.selection;
  const text = $from.parent.textContent;
  const start = $from.start();
  // At offset 0 there is no line before: lastIndexOf with -1 would search from 0 and find a leading "\n".
  const first = $from.parentOffset === 0 ? 0 : text.lastIndexOf("\n", $from.parentOffset - 1) + 1;
  const starts = [start + first];
  for (let at = text.indexOf("\n", first); at !== -1 && start + at < $to.pos; at = text.indexOf("\n", at + 1)) starts.push(start + at + 1);
  return starts;
}

/** Tab in a code block: two spaces at the caret, or at the start of every selected line. Nowhere else is Tab bound here. */
const indentCode = (state: EditorState, dispatch?: (tr: never) => void, view?: EditorView) => {
  const { selection } = state;
  if (!view?.editable || !(selection instanceof TextSelection) || selection.$from.parent.type.name !== "code_block" || !selection.$from.sameParent(selection.$to)) return false;
  if (dispatch) {
    const tr = state.tr;
    if (selection.empty) tr.insertText("  ");
    else for (const at of lineStarts(state).reverse()) tr.insertText("  ", at);
    dispatch(tr.scrollIntoView() as never);
  }
  return true;
};

/** Shift-Tab in a code block: up to two leading spaces off each line the caret or selection touches. */
const outdentCode = (state: EditorState, dispatch?: (tr: never) => void, view?: EditorView) => {
  const { selection } = state;
  if (!view?.editable || !(selection instanceof TextSelection) || selection.$from.parent.type.name !== "code_block" || !selection.$from.sameParent(selection.$to)) return false;
  if (dispatch) {
    const tr = state.tr;
    const text = selection.$from.parent.textContent;
    const offset = selection.$from.start();
    for (const at of lineStarts(state).reverse()) {
      const spaces = /^ {1,2}/.exec(text.slice(at - offset))?.[0].length ?? 0;
      if (spaces) tr.delete(at, at + spaces);
    }
    if (tr.docChanged) dispatch(tr.scrollIntoView() as never);
  }
  return true;
};

/** `Mod-Alt-7` / `-8`: the current block as a toggle or a code block, as the block menu turns it (keys spec, decision 5). */
function turnCurrentInto(target: BlockKind) {
  return (state: EditorState, dispatch?: unknown, view?: EditorView) => {
    // Claimed even where the block cannot turn (a quote, a callout): Milkdown's own Mod-Alt-7/8 make a list there.
    if (!view?.editable) return false;
    const pos = actionBlockPos(state);
    if (pos !== null && dispatch) turnBlockInto(view, pos, target);
    return true;
  };
}

/**
 * `Mod-Alt-0`…`-3` on a block chosen with Escape: the turn the block menu offers for that block. A range of
 * several blocks is the range plugin's (it turns all of them); with one block chosen the key would otherwise
 * reach Milkdown, which cannot set a heading on a list item and does nothing.
 */
function turnChosenInto(target: BlockKind) {
  return (state: EditorState, dispatch?: (tr: Transaction) => void, view?: EditorView) => {
    if (!view?.editable || rangeBlocks(state) !== null) return false;
    const pos = selectedBlockPos(state);
    if (pos === null) return false;
    if (dispatch) turnBlockInto(view, pos, target);
    return true;
  };
}

/**
 * `Mod-Alt-0`…`-3` with the caret on a list item's first line: the item turns, as the grip and the toolbar turn it
 * (list commands spec, decision 7). Milkdown's own keys would set that line to a heading, which an item cannot start
 * with, and do nothing. The key is claimed there even when the turn is refused (an item with a nested list), where
 * Milkdown's did nothing either. Anywhere else, a later paragraph or a code block in an item included, they stay
 * Milkdown's.
 */
function turnItemInto(target: BlockKind) {
  return (state: EditorState, dispatch?: (tr: Transaction) => void, view?: EditorView) => {
    if (!view?.editable || !(state.selection instanceof TextSelection) || rangeBlocks(state) !== null) return false;
    // A selection that touches several blocks turns every block the toolbar would turn, whichever end is
    // the anchor and even when it starts on a later line. Only a single caret block keeps the first-line rule.
    const blocks = blocksTouched(state);
    if (blocks.length > 1 && blocks.some((block) => block.node.type.name === "list_item")) {
      if (dispatch) {
        const tr = turnBlocks(state, blocks, target);
        if (tr) {
          // One undo step, and typing after it is its own step, as every other turn entry point does.
          view.dispatch(closeHistory(tr).scrollIntoView());
          view.dispatch(closeHistory(view.state.tr));
          view.focus();
        }
      }
      return true;
    }
    const depth = listItemDepth(state);
    const { $from } = state.selection;
    if (depth === null || $from.parent.type.name !== "paragraph" || $from.parent !== $from.node(depth).firstChild) return false;
    if (dispatch) turnBlockInto(view, $from.before(depth), target);
    return true;
  };
}

/** Both digit inputs: a block chosen with Escape first, then the caret on a list item's first line. */
function turnDigitInto(target: BlockKind) {
  const chosen = turnChosenInto(target);
  const item = turnItemInto(target);
  return (state: EditorState, dispatch?: (tr: Transaction) => void, view?: EditorView) =>
    chosen(state, dispatch, view) || item(state, dispatch, view);
}

/**
 * `Mod-Enter` in a to-do: tick it, or untick it (keys spec, decision 4). Elsewhere the key is the page's
 * (save). Called from editor-core's direct `handleKeyDown`, which claims `Mod-Enter` before any keymap.
 */
export const tickTodo = (state: EditorState, dispatch?: (tr: Transaction) => void, view?: EditorView) => {
  if (!view?.editable || !(state.selection instanceof TextSelection)) return false;
  const { $from } = state.selection;
  for (let depth = $from.depth; depth >= 1; depth--) {
    const node = $from.node(depth);
    if (node.type.name !== "list_item") continue;
    if (node.attrs.checked == null) return false;
    dispatch?.(state.tr.setNodeMarkup($from.before(depth), undefined, { ...node.attrs, checked: !node.attrs.checked }));
    return true;
  }
  return false;
};

/**
 * `Mod-Enter` with the caret in a toggle's title: open or close it, as Notion's does. Only the title: in the
 * body the key stays the page's (save), and a to-do ticks first (`tickTodo`).
 */
export function flipToggleAtTitle(view: EditorView): boolean {
  const { selection } = view.state;
  if (!view.editable || !(selection instanceof TextSelection) || selection.$from.parent.type.name !== "details_summary") return false;
  return flipNearestDetails(view, selection.from, true);
}

// Milkdown merges these into the editor's one keymap, ahead of ProseMirror's base keymap (priority 50).
const notionKeymap = $useKeymap("khNotionKeys", {
  // Notion's `Mod-Alt` digits (keys spec, decision 5): 0–3 stay Milkdown's (text, headings) except on a block
  // chosen with Escape or with the caret on a list item's first line, where they turn that block; 4–8 are Notion's.
  TextByDigitInItem: { shortcuts: "Mod-Alt-0", priority: 70, command: () => turnDigitInto("paragraph") as never },
  H1ByDigitInItem: { shortcuts: "Mod-Alt-1", priority: 70, command: () => turnDigitInto("h1") as never },
  H2ByDigitInItem: { shortcuts: "Mod-Alt-2", priority: 70, command: () => turnDigitInto("h2") as never },
  H3ByDigitInItem: { shortcuts: "Mod-Alt-3", priority: 70, command: () => turnDigitInto("h3") as never },
  TodoByDigit: { shortcuts: "Mod-Alt-4", priority: 70, command: () => toggleList("task") as never },
  BulletByDigit: { shortcuts: "Mod-Alt-5", priority: 70, command: () => toggleList("bullet") as never },
  NumberedByDigit: { shortcuts: "Mod-Alt-6", priority: 70, command: () => toggleList("ordered") as never },
  ToggleByDigit: { shortcuts: "Mod-Alt-7", priority: 70, command: () => turnCurrentInto("toggle") as never },
  CodeByDigit: { shortcuts: "Mod-Alt-8", priority: 70, command: () => turnCurrentInto("code") as never },
  HeadingBackspace: { shortcuts: "Backspace", priority: 70, command: () => headingToParagraph as never },
  Strikethrough: { shortcuts: "Mod-Shift-s", command: (ctx) => () => ctx.get(commandsCtx).call(toggleStrikethroughCommand.key) },
  NumberedList: { shortcuts: "Mod-Shift-7", command: () => toggleList("ordered") as never },
  BulletedList: { shortcuts: "Mod-Shift-8", command: () => toggleList("bullet") as never },
  TodoList: { shortcuts: "Mod-Shift-9", command: () => toggleList("task") as never },
  MoveBlockUp: { shortcuts: "Mod-Shift-ArrowUp", command: () => moveCurrentBlock(-1) as never },
  MoveBlockDown: { shortcuts: "Mod-Shift-ArrowDown", command: () => moveCurrentBlock(1) as never },
  DuplicateBlock: { shortcuts: "Mod-d", command: () => duplicateCurrentBlock as never },
  // One entry: two entries on one shortcut would leave Milkdown to pick between them.
  Indent: { shortcuts: "Tab", priority: 70, command: () => ((state: EditorState, dispatch: never, view: EditorView) => tabInLastCell(state, dispatch, view) || indentCode(state, dispatch, view)) as never },
  CodeShiftTab: { shortcuts: "Shift-Tab", priority: 70, command: () => outdentCode as never },
  SelectAllInSteps: { shortcuts: "Mod-a", priority: 70, command: () => selectAllInSteps as never },
});

// ---- Keys spec (2026-11-19): Tab stays, and the top of the document leads to the title -----------

/** Fired on the editor's DOM when the caret leaves the top of the document; whoever owns a title field claims it. */
export const EXIT_TOP = "kh:editor-exit-top";
function exitTop(view: EditorView): boolean {
  return !view.dom.dispatchEvent(new CustomEvent(EXIT_TOP, { bubbles: true, cancelable: true }));
}

/**
 * Tab in text that nothing indents (a paragraph, a heading, a quote) stays in the editor, as Notion's does:
 * it used to move focus to the next control on the page, taking the writer's next keys with it. A list, a
 * table and code keep their own Tab; a block chosen with Escape lets Tab go on, which is how a keyboard
 * user leaves the editor. Only inside an element marked `data-tab-stays` (the document page).
 */
export const LEAVE_EDITOR = "Press Escape, then Tab, to leave the editor.";

const tabStaysInText = $prose(
  () =>
    new Plugin({
      key: new PluginKey("khTabStaysInText"),
      // Tab stays, so the way out is said (WCAG 2.1.2), after the gutter's own description.
      view(view) {
        // Once: a whole-document replace (`replaceMarkdown`) makes the plugin views again.
        const said = view.dom.getAttribute("aria-description") ?? "";
        if (view.dom.closest("[data-tab-stays]") && !said.includes(LEAVE_EDITOR)) {
          view.dom.setAttribute("aria-description", `${said ? `${said} ` : ""}${LEAVE_EDITOR}`);
        }
        return {};
      },
      props: {
        handleKeyDown(view, event) {
          if (event.key !== "Tab" || event.metaKey || event.ctrlKey || event.altKey || composing(event) || !view.editable) return false;
          // Only where the page asks for it (the document page); a form such as the composer keeps Tab to its next control.
          if (!view.dom.closest("[data-tab-stays]")) return false;
          const { selection } = view.state;
          // Selected text keeps Tab for the formatting toolbar, which a keyboard user reaches that way.
          if (!(selection instanceof TextSelection) || !selection.empty) return false;
          for (let depth = selection.$from.depth; depth >= 0; depth--) {
            const role = selection.$from.node(depth).type;
            if (role.name === "list_item" || role.spec.tableRole || role.spec.code) return false;
          }
          // Shift-Tab in the document's first line goes back to the title, the way Tab came from it.
          if (event.shiftKey && selection.$from.depth === 1 && selection.$from.parent === view.state.doc.firstChild) exitTop(view);
          return true;
        },
      },
    }),
);

/**
 * ArrowUp on the first line of the document, and Backspace in an empty first paragraph, go to the title
 * (keys spec, decision 3); the empty paragraph goes with the Backspace when something follows it.
 */
const topLeadsToTitle = $prose(
  () =>
    new Plugin({
      key: new PluginKey("khTopLeadsToTitle"),
      props: {
        handleKeyDown(view, event) {
          if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || composing(event) || !view.editable) return false;
          const { selection, doc } = view.state;
          // A divider or image first in the document is selected, not typed into: ArrowUp from it leads up too.
          if (event.key === "ArrowUp" && selection instanceof NodeSelection && selection.from === 0) return exitTop(view);
          if (!(selection instanceof TextSelection) || !selection.empty) return false;
          const { $from } = selection;
          if (event.key === "ArrowUp") {
            if ($from.start() !== Selection.atStart(doc).$from.start() || !view.endOfTextblock("up")) return false;
            return exitTop(view);
          }
          if (event.key !== "Backspace") return false;
          const first = doc.firstChild;
          if ($from.depth !== 1 || $from.parent !== first || first.type.name !== "paragraph" || first.content.size > 0) return false;
          if (!exitTop(view)) return false;
          if (doc.childCount > 1) view.dispatch(view.state.tr.delete(0, first.nodeSize));
          return true;
        },
      },
    }),
);

// ---- Escape (7) ---------------------------------------------------------------------------------

/**
 * Escape in the text selects the current top-level block; Escape on a selected block returns to its text.
 * A plain plugin `handleKeyDown`, at ordinary priority: the `[[` and `/` lists claim Escape through the
 * editor's direct prop before it gets here, and the block menu and the toolbar's link field hold focus
 * outside the editor, so none of them reach this. Anything a later plugin registers ahead of this one wins.
 * With the caret in a code block being edited, Escape ends the editing state and selects that code block (a second
 * Escape returns to its text): it is how a keyboard user steps out, since Tab and Shift-Tab indent there.
 * The event is not stopped: the composer's Esc still leaves a document nothing was typed into (`formKeyIntent`), and only that.
 */
const escapeSelection = $prose(
  () =>
    new Plugin({
      key: new PluginKey("khEscapeSelectsBlock"),
      props: {
        handleKeyDown(view, event) {
          if (event.key !== "Escape" || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || composing(event) || !view.editable) return false;
          // A field inside a node view (a language `<select>`, say) owns its own Escape.
          if (event.target instanceof Element && event.target.closest("input, select, textarea, [contenteditable='false']")) return false;
          const { selection, doc } = view.state;
          if (selection instanceof AllSelection) return false;
          let tr;
          if (selection instanceof TextSelection && selection.$from.parent.type.name === "code_block") {
            // The caret in code being edited: Escape leaves the editing state (the block view closes it when its
            // node is selected, as "Done editing code" does) and selects the code block, however deep it sits.
            tr = view.state.tr.setSelection(NodeSelection.create(doc, selection.$from.before()));
          } else if (selection instanceof NodeSelection && selection.node.type.name === "code_block") {
            tr = view.state.tr.setSelection(Selection.near(doc.resolve(selection.from + 1), 1));
          } else if (selection instanceof NodeSelection && (selection.$from.depth === 0 || selection.node.type.name === "list_item")) {
            tr = view.state.tr.setSelection(Selection.near(doc.resolve(Math.min(selection.from + 1, doc.content.size)), 1));
          } else {
            // The innermost list item the caret is in is the block; elsewhere the top-level block is.
            const pos = itemPos(view.state) ?? topBlockPos(view.state);
            if (pos === null || !doc.nodeAt(pos)) return false;
            tr = view.state.tr.setSelection(NodeSelection.create(doc, pos));
          }
          event.preventDefault();
          view.dispatch(tr.scrollIntoView());
          return true;
        },
      },
    }),
);

/**
 * The innermost list item the selection is in, as a position, when it is a block of its own (`isBlockItem`); null
 * otherwise. In a quote, callout or toggle the container is the block, so Escape there falls back to it.
 */
function itemPos(state: EditorState): number | null {
  const depth = listItemDepth(state);
  if (depth === null) return null;
  const pos = state.selection.$from.before(depth);
  return isBlockItem(state.doc, pos) ? pos : null;
}

/** The end of the first textblock of the block at `pos` (the block itself, if it is one), or null when it has none. */
function firstTextblockEnd(doc: ProseNode, pos: number): number | null {
  const node = doc.nodeAt(pos);
  if (!node) return null;
  if (node.isTextblock) return pos + node.nodeSize - 1;
  let end: number | null = null;
  node.descendants((child, offset) => {
    if (end !== null) return false;
    if (!child.isTextblock) return true;
    end = pos + 1 + offset + child.nodeSize - 1;
    return false;
  });
  return end;
}

/** A list item chosen with Escape, as a position (not an item the caret merely sits in). */
const chosenItemPos = (state: EditorState): number | null =>
  state.selection instanceof NodeSelection && state.selection.node.type.name === "list_item" ? state.selection.from : null;

/**
 * A list item chosen with Escape is one block. Backspace and Delete take that item alone, whatever
 * is nested under it (a plain delete would leave an empty list behind), and a typed character
 * replaces the item's first paragraph, keeping the item's attributes (a to-do stays a to-do) and
 * its nested children. Composition is the editor's own: only the plain keys and text input are claimed.
 */
const chosenItemEdits = $prose(
  () =>
    new Plugin({
      key: new PluginKey("khChosenItemEdits"),
      props: {
        // Tab with an item chosen leaves the editor, as with any chosen block. The list's own Tab would sink
        // the item, so the event is claimed here, before any keymap, and left unprevented for the browser.
        handleDOMEvents: {
          keydown(view, event) {
            return event.key === "Tab" && !event.metaKey && !event.ctrlKey && !event.altKey && view.editable && chosenItemPos(view.state) !== null;
          },
        },
        handleKeyDown(view, event) {
          if (event.key === "Enter" && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey && !composing(event) && view.editable) {
            // Enter on a chosen block (an item, or a top-level block) goes back to its words, at the end of its first
            // textblock, and changes nothing: it used to split a list around the item. A range claims Enter first.
            const pos = selectedBlockPos(view.state);
            const end = pos === null ? null : firstTextblockEnd(view.state.doc, pos);
            if (end === null) return false; // No words to go back to (a divider, an image): Enter is the editor's own.
            event.preventDefault();
            view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, end)).scrollIntoView());
            return true;
          }
          if ((event.key !== "Backspace" && event.key !== "Delete") || composing(event) || !view.editable) return false;
          const pos = chosenItemPos(view.state);
          if (pos === null) return false;
          event.preventDefault();
          return deleteBlock(view, pos);
        },
        handleTextInput(view, from, to, text) {
          if (!view.editable) return false;
          const pos = chosenItemPos(view.state);
          if (pos === null || from !== view.state.selection.from || to !== view.state.selection.to) return false;
          const item = view.state.doc.nodeAt(pos);
          const first = item?.firstChild;
          // Never taken: the schema gives a list item `paragraph block*` content, so its first child is a paragraph.
          // The check only keeps the replace below from writing into anything else should that schema ever change.
          if (!item || !first || first.type.name !== "paragraph") return false;
          const start = pos + 2;
          const tr = view.state.tr.replaceWith(start, start + first.content.size, view.state.schema.text(text));
          tr.setSelection(TextSelection.create(tr.doc, start + text.length));
          view.dispatch(tr.scrollIntoView());
          return true;
        },
      },
    }),
);

export const notionKeys: MilkdownPlugin[] = [todoInputRule, markEnd, ...typography, notionKeymap, blockRange, escapeSelection, chosenItemEdits, tabStaysInText, topLeadsToTitle].flat();
