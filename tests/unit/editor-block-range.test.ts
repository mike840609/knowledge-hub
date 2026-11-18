// @vitest-environment jsdom
import { editorViewCtx } from "@milkdown/kit/core";
import { closeHistory, redo, undo } from "@milkdown/kit/prose/history";
import { NodeSelection, TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { afterEach, expect, it } from "vitest";
import { moveBlocks, sequenceOf } from "@/components/knowledge/editor/block-sequence";
import { createMarkdownEditor, type MarkdownEditor } from "@/components/knowledge/editor/editor-core";
import { extractDocumentLinks } from "@/modules/knowledge/domain/document-links";
import { LINK_MARKDOWN_FIXTURES } from "../fixtures/link-markdown";

// docs/superpowers/specs/2026-11-20-multi-block-selection-design.md, through the rendered editor.
const rect = { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 } as DOMRect;
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => rect;
const opened: MarkdownEditor[] = [];
afterEach(async () => { for (const editor of opened.splice(0)) await editor.destroy(); document.body.innerHTML = ""; });

const DOC = "# Title\n\none\n\ntwo\n\n- a\n- b\n\nfour\n";
async function open(markdown = DOC) {
  const root = document.body.appendChild(document.createElement("div"));
  root.setAttribute("data-tab-stays", "");
  const editor = await createMarkdownEditor({ root, markdown, className: "kh-editor", ariaLabel: "Content", editable: true, onUserEdit: () => {}, onMarkdown: () => {}, allowImage: () => false });
  opened.push(editor);
  const view = editor.action(ctx => ctx.get(editorViewCtx));
  view.focus();
  return { editor, view };
}
const CODES: Record<string, number> = { Backspace: 8, Tab: 9, Enter: 13, Escape: 27, Delete: 46, ArrowUp: 38, ArrowDown: 40 };
function press(view: EditorView, key: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  Object.defineProperty(event, "keyCode", { value: CODES[key] ?? key.toUpperCase().charCodeAt(0) });
  view.dom.dispatchEvent(event);
  return event;
}
const md = (editor: MarkdownEditor) => editor.getMarkdown();
const inRange = (view: EditorView) => [...view.dom.querySelectorAll(".kh-block-in-range")].map(node => node.textContent);
/** Block `index` chosen as a node, as its grip does (Escape in a list chooses the item; the range starts from top-level blocks). */
function choose(view: EditorView, index: number) {
  let pos = 0;
  for (let at = 0; at < index; at++) pos += view.state.doc.child(at).nodeSize;
  view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
  expect(view.state.selection).toBeInstanceOf(NodeSelection);
}
const shift = (view: EditorView, key: string) => press(view, key, { shiftKey: true });

it("Shift-ArrowDown and Shift-ArrowUp widen and narrow a block chosen with Escape", async () => {
  const { view } = await open();
  choose(view, 1);
  expect(inRange(view)).toEqual([]);
  shift(view, "ArrowDown");
  expect(inRange(view)).toEqual(["one", "two"]);
  // A list item is a block of the sequence: the range crosses into the list one item at a time.
  shift(view, "ArrowDown");
  expect(inRange(view)).toEqual(["one", "two", "a"]);
  shift(view, "ArrowUp");
  expect(inRange(view)).toEqual(["one", "two"]);
  shift(view, "ArrowUp");
  expect(inRange(view)).toEqual([]);
  // Upward from the same block, and stopping at the document's ends.
  shift(view, "ArrowUp");
  expect(inRange(view)).toEqual(["Title", "one"]);
  expect(shift(view, "ArrowUp").defaultPrevented).toBe(true);
  expect(inRange(view)).toEqual(["Title", "one"]);
});

it("Backspace and Delete remove every block of the range, and the caret lands beside them", async () => {
  const { editor, view } = await open();
  choose(view, 1);
  shift(view, "ArrowDown");
  expect(press(view, "Backspace").defaultPrevented).toBe(true);
  expect(md(editor)).toBe("# Title\n\n- a\n- b\n\nfour\n");
  expect(view.state.selection).toBeInstanceOf(TextSelection);
  expect(inRange(view)).toEqual([]);
  const second = await open();
  escapeOn(second.view, "a");
  shift(second.view, "ArrowDown");
  shift(second.view, "ArrowDown");
  press(second.view, "Delete");
  expect(md(second.editor)).toBe("# Title\n\none\n\ntwo\n");
});

it("deleting every block leaves one empty paragraph", async () => {
  const { editor, view } = await open("one\n\ntwo\n");
  choose(view, 0);
  shift(view, "ArrowDown");
  press(view, "Backspace");
  expect(view.state.doc.childCount).toBe(1);
  expect(view.state.doc.firstChild!.type.name).toBe("paragraph");
  expect(md(editor).trim()).toBe("");
});

it("Mod-d duplicates the range after itself and chooses the copies", async () => {
  const { editor, view } = await open();
  choose(view, 1);
  shift(view, "ArrowDown");
  press(view, "d", { ctrlKey: true });
  expect(md(editor)).toBe("# Title\n\none\n\ntwo\n\none\n\ntwo\n\n- a\n- b\n\nfour\n");
  expect(inRange(view)).toEqual(["one", "two"]);
  expect(view.state.selection.from).toBe(view.state.doc.child(0).nodeSize + view.state.doc.child(1).nodeSize + view.state.doc.child(2).nodeSize);
});

it("Mod-Shift-Arrow moves the whole range past its neighbour, and the range goes with it", async () => {
  const { editor, view } = await open();
  choose(view, 1);
  shift(view, "ArrowDown");
  press(view, "ArrowUp", { ctrlKey: true, shiftKey: true });
  expect(md(editor)).toBe("one\n\ntwo\n\n# Title\n\n- a\n- b\n\nfour\n");
  expect(inRange(view)).toEqual(["one", "two"]);
  press(view, "ArrowDown", { ctrlKey: true, shiftKey: true });
  press(view, "ArrowDown", { ctrlKey: true, shiftKey: true });
  // The neighbour below is now an item: the range passes `a` alone, and the list goes on after it.
  expect(md(editor)).toBe("# Title\n\n- a\n\none\n\ntwo\n\n- b\n\nfour\n");
  expect(inRange(view)).toEqual(["one", "two"]);
  press(view, "ArrowDown", { ctrlKey: true, shiftKey: true });
  expect(md(editor)).toBe("# Title\n\n- a\n- b\n\none\n\ntwo\n\nfour\n");
  expect(inRange(view)).toEqual(["one", "two"]);
  // At the end there is nothing to pass.
  press(view, "ArrowDown", { ctrlKey: true, shiftKey: true });
  press(view, "ArrowDown", { ctrlKey: true, shiftKey: true });
  expect(md(editor)).toBe("# Title\n\n- a\n- b\n\nfour\n\none\n\ntwo\n");
});

it("Mod-Alt-digit turns every block of the range, and the same kind again turns it back", async () => {
  const { editor, view } = await open();
  choose(view, 1);
  shift(view, "ArrowDown");
  press(view, "5", { ctrlKey: true, altKey: true });
  expect(md(editor)).toBe("# Title\n\n- one\n- two\n\n* a\n* b\n\nfour\n");
  // Every item of two bulleted lists chosen turns back, an item to a paragraph.
  escapeOn(view, "one");
  for (let step = 0; step < 3; step++) shift(view, "ArrowDown");
  expect(inRange(view)).toEqual(["one", "two", "a", "b"]);
  press(view, "5", { ctrlKey: true, altKey: true });
  expect(md(editor)).toBe("# Title\n\none\n\ntwo\n\na\n\nb\n\nfour\n");
  const second = await open();
  choose(second.view, 1);
  shift(second.view, "ArrowDown");
  press(second.view, "2", { ctrlKey: true, altKey: true });
  expect(md(second.editor)).toBe("# Title\n\n## one\n\n## two\n\n- a\n- b\n\nfour\n");
});

it("typing, and Enter, do nothing to a range, and Escape ends it", async () => {
  const { editor, view } = await open();
  choose(view, 1);
  shift(view, "ArrowDown");
  const before = md(editor);
  expect(press(view, "x").defaultPrevented).toBe(true);
  expect(press(view, "Enter").defaultPrevented).toBe(true);
  expect(md(editor)).toBe(before);
  expect(inRange(view).length).toBe(2);
  press(view, "Escape");
  expect(inRange(view)).toEqual([]);
  expect(view.state.selection).toBeInstanceOf(TextSelection);
});

it("a single chosen block, and any change to the document, leave no range", async () => {
  const { view } = await open();
  choose(view, 1);
  expect(press(view, "x").defaultPrevented).toBe(false);
  choose(view, 1);
  shift(view, "ArrowDown");
  view.dispatch(view.state.tr.insertText("!", 2));
  expect(inRange(view)).toEqual([]);
});

it("announces how many blocks are chosen", async () => {
  const { view } = await open();
  choose(view, 1);
  shift(view, "ArrowDown");
  shift(view, "ArrowDown");
  const live = view.dom.parentElement!.querySelector('[aria-live="polite"]');
  expect(live?.textContent).toBe("3 blocks selected");
});

it("a shifted letter, an Option character and typed text are ignored, and shortcuts go on", async () => {
  const { editor, view } = await open();
  choose(view, 1);
  shift(view, "ArrowDown");
  const before = md(editor);
  expect(press(view, "A", { shiftKey: true }).defaultPrevented).toBe(true);
  expect(press(view, "ø", { altKey: true }).defaultPrevented).toBe(true);
  expect(press(view, "?", { shiftKey: true }).defaultPrevented).toBe(true);
  // The backstop: text that reaches ProseMirror by another path is refused too.
  const { from, to } = view.state.selection;
  expect(view.someProp("handleTextInput", (handler) => handler(view, from, to, "A", () => view.state.tr.insertText("A", from, to)))).toBe(true);
  expect(md(editor)).toBe(before);
  // Copy and cut are shortcuts, not typing: they reach the clipboard handlers.
  for (const letter of ["c", "x"]) expect(press(view, letter, { ctrlKey: true }).defaultPrevented).toBe(false);
});

it("an input method's first key ends the range, and nothing is lost", async () => {
  const { editor, view } = await open();
  choose(view, 1);
  shift(view, "ArrowDown");
  const before = md(editor);
  const event = new KeyboardEvent("keydown", { key: "Process", bubbles: true, cancelable: true });
  Object.defineProperty(event, "keyCode", { value: 229 });
  view.dom.dispatchEvent(event);
  expect(inRange(view)).toEqual([]);
  expect(view.state.selection).toBeInstanceOf(TextSelection);
  expect(md(editor)).toBe(before);
});

/** A clipboard that records what is written to it. */
function clipboard() {
  const data = new Map<string, string>();
  return { data, clipboardData: { clearData: () => data.clear(), setData: (type: string, value: string) => data.set(type, value), getData: (type: string) => data.get(type) ?? "" } };
}
function clipEvent(view: EditorView, type: "copy" | "cut") {
  const { data, clipboardData } = clipboard();
  const event = new Event(type, { bubbles: true, cancelable: true }) as ClipboardEvent;
  Object.defineProperty(event, "clipboardData", { value: clipboardData });
  view.dom.dispatchEvent(event);
  return { data, event };
}

it("copy takes every block of the range, and cut takes them out as well", async () => {
  const { editor, view } = await open();
  choose(view, 1);
  shift(view, "ArrowDown");
  const copied = clipEvent(view, "copy");
  expect(copied.event.defaultPrevented).toBe(true);
  expect(copied.data.get("text/plain")).toContain("one");
  expect(copied.data.get("text/plain")).toContain("two");
  expect(md(editor)).toBe(DOC);
  const cut = clipEvent(view, "cut");
  expect(cut.data.get("text/plain")).toContain("two");
  expect(md(editor)).toBe("# Title\n\n- a\n- b\n\nfour\n");
});

it("duplicating a range that holds a heading keeps the copies chosen, and moving past a same-titled heading keeps the range", async () => {
  const { editor, view } = await open("# Title\n\none\n\ntwo\n");
  choose(view, 0);
  shift(view, "ArrowDown");
  press(view, "d", { ctrlKey: true });
  expect(md(editor)).toBe("# Title\n\none\n\n# Title\n\none\n\ntwo\n");
  expect(inRange(view)).toEqual(["Title", "one"]);
  expect(view.state.selection).toBeInstanceOf(NodeSelection);
  const moved = await open("# A\n\none\n\n# A\n\ntwo\n");
  choose(moved.view, 0);
  shift(moved.view, "ArrowDown");
  press(moved.view, "ArrowDown", { ctrlKey: true, shiftKey: true });
  expect(inRange(moved.view)).toEqual(["A", "one"]);
});

it("a range widened upward stays pointed upward after Mod-d", async () => {
  const { view } = await open();
  choose(view, 2);
  shift(view, "ArrowUp");
  expect(inRange(view)).toEqual(["one", "two"]);
  press(view, "d", { ctrlKey: true });
  expect(inRange(view)).toEqual(["one", "two"]);
  shift(view, "ArrowUp");
  expect(inRange(view).length).toBe(3);
});

it("undoing or redoing a range move leaves no stale range, and nothing is deleted from another block", async () => {
  const { editor, view } = await open("# H\n\none\n\ntwo\n\nlonger block here\n\nfour\n");
  const original = md(editor);
  choose(view, 1);
  shift(view, "ArrowDown");
  press(view, "ArrowDown", { ctrlKey: true, shiftKey: true });
  const moved = md(editor);
  expect(moved).not.toBe(original);
  // The history commands dispatch straight through the view: a stale range would throw here.
  expect(() => undo(view.state, view.dispatch)).not.toThrow();
  expect(md(editor)).toBe(original);
  expect(inRange(view)).toEqual([]);
  expect(() => redo(view.state, view.dispatch)).not.toThrow();
  expect(md(editor)).toBe(moved);
  expect(inRange(view)).toEqual([]);
  // Whatever is selected now, Backspace never takes part of another block.
  press(view, "Backspace");
  expect(md(editor)).not.toContain("longer b\n");
});

it("Backspace and Delete with a modifier take the whole range, never the anchor block alone", async () => {
  for (const init of [{ shiftKey: true }, { ctrlKey: true }, { altKey: true }]) {
    const { editor, view } = await open();
    choose(view, 1);
    shift(view, "ArrowDown");
    press(view, "Backspace", init);
    expect(md(editor)).toBe("# Title\n\n- a\n- b\n\nfour\n");
  }
  const { editor, view } = await open();
  choose(view, 1);
  shift(view, "ArrowDown");
  // Ctrl-H is a Mac's Backspace; elsewhere it is the browser's history and is left alone.
  press(view, "h", { ctrlKey: true });
  expect(md(editor)).toBe(DOC);
  const platform = Object.getOwnPropertyDescriptor(Navigator.prototype, "platform");
  Object.defineProperty(navigator, "platform", { value: "MacIntel", configurable: true });
  try {
    press(view, "h", { ctrlKey: true });
    expect(md(editor)).toBe("# Title\n\n- a\n- b\n\nfour\n");
  } finally {
    delete (navigator as unknown as Record<string, unknown>).platform;
    if (platform) Object.defineProperty(Navigator.prototype, "platform", platform);
  }
});

it("a heading nested in a quote or a list keeps the range when Mod-d renumbers it", async () => {
  for (const markdown of ["> # Q\n\none\n\nfour\n", "- # L\n\none\n\nfour\n"]) {
    const { view } = await open(markdown);
    // Escape in the list's heading chooses its item; in the quote, the quote.
    escapeOn(view, markdown.startsWith(">") ? "Q" : "L");
    shift(view, "ArrowDown");
    press(view, "d", { ctrlKey: true });
    expect(inRange(view).length).toBe(2);
    expect(view.state.selection).toBeInstanceOf(NodeSelection);
  }
});

it("paste with a range is refused, and a single chosen block is pasted over as before", async () => {
  const { editor, view } = await open();
  choose(view, 1);
  shift(view, "ArrowDown");
  const event = new Event("paste", { bubbles: true, cancelable: true }) as ClipboardEvent;
  Object.defineProperty(event, "clipboardData", { value: { getData: (type: string) => (type === "text/plain" ? "PASTED" : ""), files: [], types: ["text/plain"] } });
  view.dom.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  expect(md(editor)).toBe(DOC);
});

it("AltGr and a dead key are text, not turn keys or a way to replace a block", async () => {
  const { editor, view } = await open();
  choose(view, 1);
  shift(view, "ArrowDown");
  // German AltGr+7 is `{`: Windows reports Ctrl+Alt, and the physical key is Digit7.
  const brace = press(view, "{", { ctrlKey: true, altKey: true, code: "Digit7" });
  expect(brace.defaultPrevented).toBe(true);
  expect(md(editor)).toBe(DOC);
  // On a US keyboard Ctrl+Alt+5 is the turn key, and still works.
  press(view, "5", { ctrlKey: true, altKey: true, code: "Digit5" });
  expect(md(editor)).toContain("- one\n- two");
  const second = await open();
  choose(second.view, 1);
  shift(second.view, "ArrowDown");
  press(second.view, "Dead");
  expect(inRange(second.view)).toEqual([]);
  expect(md(second.editor)).toBe(DOC);
});

// docs/superpowers/specs/2026-11-21-block-unit-design.md, decisions 3 and 4: a range is a run of blocks in one sequence,
// where a list item is a block, and every range operation is one undo step.
const LISTED = "Para\n\n- a\n- b\n- c\n\nAfter\n";
/** The caret in the first textblock that reads `text`, then Escape: the block (or the innermost item) it is in is chosen. */
function escapeOn(view: EditorView, text: string) {
  let at = -1;
  view.state.doc.descendants((node, pos) => {
    if (at < 0 && node.isTextblock && node.textContent === text) at = pos + 1;
    return at < 0;
  });
  expect(at).toBeGreaterThan(0);
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at)));
  expect(press(view, "Escape").defaultPrevented).toBe(true);
  expect(view.state.selection).toBeInstanceOf(NodeSelection);
}
const live = (view: EditorView) => view.dom.parentElement!.querySelector('[aria-live="polite"]')?.textContent;
const mod = (view: EditorView, key: string, init: KeyboardEventInit = {}) => press(view, key, { ctrlKey: true, ...init });

it("Shift-ArrowDown crosses into a list", async () => {
  const { view } = await open(LISTED);
  escapeOn(view, "Para");
  shift(view, "ArrowDown");
  shift(view, "ArrowDown");
  expect(inRange(view)).toEqual(["Para", "a", "b"]);
  expect(live(view)).toBe("3 blocks selected");
});

it("delete covers a whole list", async () => {
  const { editor, view } = await open(LISTED);
  escapeOn(view, "a");
  for (let step = 0; step < 3; step++) shift(view, "ArrowDown");
  expect(inRange(view)).toEqual(["a", "b", "c", "After"]);
  press(view, "Backspace");
  expect(md(editor)).toBe("Para\n");
  expect(view.state.doc.childCount).toBe(1);
  undo(view.state, view.dispatch);
  expect(md(editor)).toBe(LISTED);
});

it("duplicate after an item joins its list", async () => {
  const { editor, view } = await open(LISTED);
  escapeOn(view, "a");
  shift(view, "ArrowDown");
  mod(view, "d");
  expect(md(editor)).toBe("Para\n\n- a\n- b\n- a\n- b\n- c\n\nAfter\n");
  expect(inRange(view)).toEqual(["a", "b"]);
  const list = view.state.doc.child(1);
  // The copies are the third and fourth items.
  const third = 1 + view.state.doc.child(0).nodeSize + list.child(0).nodeSize + list.child(1).nodeSize;
  expect(view.state.selection.from).toBe(third);
  expect((view.state.selection as NodeSelection).node.type.name).toBe("list_item");
  undo(view.state, view.dispatch);
  expect(md(editor)).toBe(LISTED);
});

it("move down out of a list", async () => {
  const { editor, view } = await open(LISTED);
  escapeOn(view, "c");
  shift(view, "ArrowUp");
  expect(inRange(view)).toEqual(["b", "c"]);
  mod(view, "ArrowDown", { shiftKey: true });
  expect(md(editor)).toBe("Para\n\n- a\n\nAfter\n\n- b\n- c\n");
  expect(inRange(view)).toEqual(["b", "c"]);
  mod(view, "ArrowUp", { shiftKey: true });
  expect(md(editor)).toBe(LISTED);
  expect(inRange(view)).toEqual(["b", "c"]);
  // The range kept its direction: the anchor is still `c`, so Shift-ArrowUp widens upward.
  shift(view, "ArrowUp");
  expect(inRange(view)).toEqual(["a", "b", "c"]);
});

it("ordered numbers after a move", async () => {
  const markdown = "1. a\n2. b\n3. c\n\nP\n";
  const { editor, view } = await open(markdown);
  // One block up in the sequence `a, b, c, P` puts `P` between `b` and `c`: the list splits, and the part after it
  // keeps its numbers (2026-11-17), through `order` on the second list.
  const sequence = sequenceOf(view.state.doc, 0);
  expect(sequence.map(block => block.node.textContent)).toEqual(["a", "b", "c", "P"]);
  const { tr, moved } = moveBlocks(view.state, [sequence[3]], 2);
  view.dispatch(closeHistory(tr));
  expect(md(editor)).toBe("1. a\n2. b\n\nP\n\n3. c\n");
  expect(view.state.doc.child(2).type.name).toBe("ordered_list");
  expect(view.state.doc.child(2).attrs.order).toBe(3);
  expect(moved.map(block => view.state.doc.nodeAt(block.pos)?.textContent)).toEqual(["P"]);
  undo(view.state, view.dispatch);
  expect(md(editor)).toBe(markdown);
  expect(view.state.doc.childCount).toBe(2);
});

it("turn a mixed range to H2 is one undo step", async () => {
  const { editor, view } = await open(LISTED);
  escapeOn(view, "Para");
  shift(view, "ArrowDown");
  shift(view, "ArrowDown");
  press(view, "2", { ctrlKey: true, altKey: true });
  expect(md(editor)).toBe("## Para\n\n## a\n\n## b\n\n- c\n\nAfter\n");
  undo(view.state, view.dispatch);
  expect(md(editor)).toBe(LISTED);
});

it("a mixed range turned into a list becomes one list", async () => {
  const { editor, view } = await open(LISTED);
  escapeOn(view, "Para");
  shift(view, "ArrowDown");
  press(view, "5", { ctrlKey: true, altKey: true });
  expect(md(editor)).toBe("- Para\n- a\n- b\n- c\n\nAfter\n");
  undo(view.state, view.dispatch);
  expect(md(editor)).toBe(LISTED);
});

it("nested sequence stops at its list's ends", async () => {
  const markdown = "- a\n  - n1\n  - n2\n- c\n";
  const { editor, view } = await open(markdown);
  escapeOn(view, "n2");
  expect(shift(view, "ArrowDown").defaultPrevented).toBe(true);
  expect(inRange(view)).toEqual([]);
  expect((view.state.selection as NodeSelection).node.textContent).toBe("n2");
  shift(view, "ArrowUp");
  expect(inRange(view)).toEqual(["n1", "n2"]);
  expect(shift(view, "ArrowUp").defaultPrevented).toBe(true);
  expect(inRange(view)).toEqual(["n1", "n2"]);
  // Deleting the whole nested run leaves its parent item, with its words, and no empty list.
  press(view, "Backspace");
  expect(md(editor)).toBe("- a\n- c\n");
});

it("copy of a mixed range", async () => {
  const { editor, view } = await open(LISTED);
  escapeOn(view, "Para");
  shift(view, "ArrowDown");
  shift(view, "ArrowDown");
  const { data } = clipEvent(view, "copy");
  const text = data.get("text/plain") ?? "";
  expect([...text.matchAll(/Para|\ba\b|\bb\b/g)].map(match => match[0])).toEqual(["Para", "a", "b"]);
  expect(text).not.toContain("c");
  expect(md(editor)).toBe(LISTED);
  const cut = clipEvent(view, "cut");
  expect(cut.event.defaultPrevented).toBe(true);
  expect(md(editor)).toBe("- c\n\nAfter\n");
});

const links = (markdown: string) => extractDocumentLinks(markdown).map(({ kind, target, fragment, display }) => JSON.stringify({ kind, target, fragment, display })).sort();

it("a duplicated mixed range keeps its wikilinks as links", async () => {
  // The fixture's first wikilink sentence, a block before a list whose first item is a wikilink.
  const sentence = LINK_MARKDOWN_FIXTURES.find(fixture => fixture.name === "a wikilink in a sentence")!;
  const { editor, view } = await open(`${sentence.markdown}\n- [[Target]]\n- b\n`);
  const target = JSON.stringify({ kind: "WIKI", target: "Target", fragment: null, display: null });
  const before = [...sentence.links.map(link => JSON.stringify(link)), target].sort();
  expect(links(md(editor))).toEqual(before);
  escapeOn(view, "b");
  shift(view, "ArrowUp");
  shift(view, "ArrowUp");
  expect(inRange(view)).toHaveLength(3);
  mod(view, "d");
  // Every link twice: the copies wrote them again, and none became text.
  expect(links(md(editor))).toEqual([...before, ...before].sort());
  let wikiNodes = 0;
  view.state.doc.descendants(node => { if (node.type.name === "wiki_link") wikiNodes++; });
  expect(wikiNodes).toBe(4);
  expect(md(editor)).toBe(`${sentence.markdown}\n- [[Target]]\n- b\n\n${sentence.markdown}\n- [[Target]]\n- b\n`);
});

it("deleting every item of the only list leaves one empty paragraph, not an empty list", async () => {
  const { editor, view } = await open("- a\n- b\n");
  escapeOn(view, "a");
  shift(view, "ArrowDown");
  press(view, "Backspace");
  expect(view.state.doc.childCount).toBe(1);
  expect(view.state.doc.firstChild!.type.name).toBe("paragraph");
  expect(md(editor).trim()).toBe("");
});

// Fix round 1: numbering, mixed lists, single chosen blocks, joins and refusals.
const listNodes = (view: EditorView) => { const names: string[] = []; view.state.doc.forEach(node => { if (node.type.name.endsWith("_list")) names.push(node.type.name); }); return names; };

it("a range turned out of an ordered list leaves the rest its numbers", async () => {
  const { editor, view } = await open("1. a\n2. b\n3. c\n4. d\n");
  escapeOn(view, "a");
  shift(view, "ArrowDown");
  press(view, "5", { ctrlKey: true, altKey: true });
  expect(md(editor)).toBe("- a\n- b\n\n3. c\n4. d\n");
  undo(view.state, view.dispatch);
  expect(md(editor)).toBe("1. a\n2. b\n3. c\n4. d\n");
  const second = await open("P\n\n1. a\n2. b\n3. c\n");
  escapeOn(second.view, "P");
  shift(second.view, "ArrowDown");
  press(second.view, "5", { ctrlKey: true, altKey: true });
  expect(md(second.editor)).toBe("- P\n- a\n\n2. b\n3. c\n");
});

it("moving a range inside a list of task and plain items keeps one list", async () => {
  const { editor, view } = await open("- [ ] t\n- b\n- c\n");
  escapeOn(view, "c");
  shift(view, "ArrowUp");
  mod(view, "ArrowUp", { shiftKey: true });
  expect(md(editor)).toBe("- b\n- c\n- [ ] t\n");
  expect(listNodes(view)).toEqual(["bullet_list"]);
  const second = await open("- a\n- [x] t\n- [ ] u\n- z\n");
  escapeOn(second.view, "t");
  shift(second.view, "ArrowDown");
  mod(second.view, "ArrowUp", { shiftKey: true });
  expect(md(second.editor)).toBe("- [x] t\n- [ ] u\n- a\n- z\n");
  expect(listNodes(second.view)).toEqual(["bullet_list"]);
});

it("a paragraph chosen alone moves one block in its sequence, into a list and out", async () => {
  const markdown = "- a\n- b\n- c\n\nP\n";
  const { editor, view } = await open(markdown);
  escapeOn(view, "P");
  mod(view, "ArrowUp", { shiftKey: true });
  expect(md(editor)).toBe("- a\n- b\n\nP\n\n- c\n");
  expect((view.state.selection as NodeSelection).node.textContent).toBe("P");
  undo(view.state, view.dispatch);
  expect(md(editor)).toBe(markdown);
});

it("the last item chosen alone moves down out of its list", async () => {
  const markdown = "- a\n- b\n- c\n\nP\n";
  const { editor, view } = await open(markdown);
  escapeOn(view, "c");
  mod(view, "ArrowDown", { shiftKey: true });
  expect(md(editor)).toBe("- a\n- b\n\nP\n\n- c\n");
  expect((view.state.selection as NodeSelection).node.type.name).toBe("list_item");
  undo(view.state, view.dispatch);
  expect(md(editor)).toBe(markdown);
});

it("two lists that were side by side before a move stay two", async () => {
  const markdown = "- a\n- b\n\n* c\n* d\n\nP\n";
  for (const key of ["ArrowUp", "ArrowDown"]) {
    const { editor, view } = await open(markdown);
    escapeOn(view, "b");
    shift(view, "ArrowDown");
    mod(view, key, { shiftKey: true });
    expect(listNodes(view)).toEqual(["bullet_list", "bullet_list"]);
    undo(view.state, view.dispatch);
    expect(md(editor)).toBe(markdown);
  }
});

it("a turn that joins a list takes that list's start and looseness", async () => {
  const { editor, view } = await open("P\n\n5. a\n6. b\n");
  escapeOn(view, "P");
  shift(view, "ArrowDown");
  press(view, "6", { ctrlKey: true, altKey: true });
  expect(md(editor)).toBe("5. P\n6. a\n7. b\n");
  const loose = await open("P\n\n- a\n\n- b\n");
  escapeOn(loose.view, "P");
  shift(loose.view, "ArrowDown");
  press(loose.view, "5", { ctrlKey: true, altKey: true });
  expect(md(loose.editor)).toBe("- P\n\n- a\n\n- b\n");
});

it("a turn some block of the range cannot take changes nothing", async () => {
  const { editor, view } = await open(LISTED);
  escapeOn(view, "Para");
  shift(view, "ArrowDown");
  shift(view, "ArrowDown");
  press(view, "7", { ctrlKey: true, altKey: true });
  expect(md(editor)).toBe(LISTED);
});

it("a range moved up into an ordered list leaves the part after it its numbers", async () => {
  const markdown = "1. a\n2. b\n3. c\n\nP\n\nQ\n";
  const { editor, view } = await open(markdown);
  escapeOn(view, "P");
  shift(view, "ArrowDown");
  mod(view, "ArrowUp", { shiftKey: true });
  expect(md(editor)).toBe("1. a\n2. b\n\nP\n\nQ\n\n3. c\n");
  expect(inRange(view)).toEqual(["P", "Q"]);
  undo(view.state, view.dispatch);
  expect(md(editor)).toBe(markdown);
});
