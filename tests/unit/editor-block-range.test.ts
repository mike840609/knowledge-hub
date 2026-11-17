// @vitest-environment jsdom
import { editorViewCtx } from "@milkdown/kit/core";
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
