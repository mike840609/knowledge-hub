// @vitest-environment jsdom
import { editorViewCtx } from "@milkdown/kit/core";
import { redo, undo } from "@milkdown/kit/prose/history";
import { NodeSelection, TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { afterEach, expect, it } from "vitest";
import { createMarkdownEditor, type MarkdownEditor } from "@/components/knowledge/editor/editor-core";

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
/** The text caret in block `index`, then Escape: the block chosen as a node. */
function choose(view: EditorView, index: number) {
  let pos = 0;
  for (let at = 0; at < index; at++) pos += view.state.doc.child(at).nodeSize;
  view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(pos + 1))));
  press(view, "Escape");
  expect(view.state.selection).toBeInstanceOf(NodeSelection);
}
const shift = (view: EditorView, key: string) => press(view, key, { shiftKey: true });

it("Shift-ArrowDown and Shift-ArrowUp widen and narrow a block chosen with Escape", async () => {
  const { view } = await open();
  choose(view, 1);
  expect(inRange(view)).toEqual([]);
  shift(view, "ArrowDown");
  expect(inRange(view)).toEqual(["one", "two"]);
  shift(view, "ArrowDown");
  expect(inRange(view)).toEqual(["one", "two", "a" + "b"]);
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
  choose(second.view, 3);
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
  // Two bulleted lists chosen turn back, an item to a paragraph.
  choose(view, 1);
  shift(view, "ArrowDown");
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
  press(view, "h", { ctrlKey: true });
  expect(md(editor)).toBe("# Title\n\n- a\n- b\n\nfour\n");
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
