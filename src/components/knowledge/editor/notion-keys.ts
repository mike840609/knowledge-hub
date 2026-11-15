import { commandsCtx } from "@milkdown/kit/core";
import type { MilkdownPlugin } from "@milkdown/kit/ctx";
import { setBlockType } from "@milkdown/kit/prose/commands";
import { InputRule, undoInputRule } from "@milkdown/kit/prose/inputrules";
import { liftListItem } from "@milkdown/kit/prose/schema-list";
import { AllSelection, NodeSelection, Plugin, PluginKey, Selection, TextSelection, type EditorState } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { toggleStrikethroughCommand } from "@milkdown/kit/preset/gfm";
import { addRowAfter, goToNextCell, isInTable } from "@milkdown/kit/prose/tables";
import { customInputRulesKey } from "@milkdown/kit/prose";
import type { Mark } from "@milkdown/kit/prose/model";
import { ReplaceStep } from "@milkdown/kit/prose/transform";
import { $inputRule, $prose, $useKeymap } from "@milkdown/kit/utils";
import { duplicateBlock, moveBlock, topLevelBlocks, turnBlockInto, type BlockKind } from "./block-actions";

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

function replacement(regexp: RegExp, symbol: string) {
  return $inputRule(
    () =>
      new InputRule(regexp, (state, _match, start, end) => {
        if (hasCodeAt(state, start)) return null;
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

/** A list of the given kind, or the item lifted back to a paragraph when it already is one. */
function toggleList(target: "ordered" | "bullet" | "task") {
  return (state: EditorState, dispatch?: (tr: never) => void, view?: EditorView) => {
    if (!view?.editable || !(state.selection instanceof TextSelection || state.selection instanceof NodeSelection)) return false;
    if (listKindAt(state) === target) return liftListItem(state.schema.nodes.list_item)(state, dispatch as never);
    const pos = topBlockPos(state);
    if (pos === null) return false;
    return dispatch ? turnBlockInto(view, pos, target) : true;
  };
}

function moveCurrentBlock(direction: -1 | 1) {
  return (state: EditorState, dispatch?: unknown, view?: EditorView) => {
    const pos = topBlockPos(state);
    if (pos === null || !view?.editable) return false;
    const blocks = topLevelBlocks(state.doc);
    const index = blocks.findIndex((block) => block.pos === pos);
    const neighbour = blocks[index + direction];
    if (!neighbour) return true; // At the edge: nothing to do, and the browser has nothing for this key either.
    // `moveBlock` takes the boundary the block goes in front of.
    const before = direction < 0 ? neighbour.pos : neighbour.pos + neighbour.node.nodeSize;
    return dispatch ? moveBlock(view, pos, before) || true : true;
  };
}

const duplicateCurrentBlock = (state: EditorState, dispatch?: unknown, view?: EditorView) => {
  const pos = topBlockPos(state);
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
  const first = text.lastIndexOf("\n", $from.parentOffset - 1) + 1;
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

// Milkdown merges these into the editor's one keymap, ahead of ProseMirror's base keymap (priority 50).
const notionKeymap = $useKeymap("khNotionKeys", {
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
          } else if (selection instanceof NodeSelection && selection.$from.depth === 0) {
            tr = view.state.tr.setSelection(Selection.near(doc.resolve(Math.min(selection.from + 1, doc.content.size)), 1));
          } else {
            const pos = topBlockPos(view.state);
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

export const notionKeys: MilkdownPlugin[] = [todoInputRule, markEnd, ...typography, notionKeymap, escapeSelection].flat();
