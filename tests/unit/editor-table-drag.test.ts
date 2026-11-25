// @vitest-environment jsdom
import { editorViewCtx } from "@milkdown/kit/core";
import { undo, undoDepth } from "@milkdown/kit/prose/history";
import type { EditorView } from "@milkdown/kit/prose/view";
import { TextSelection } from "@milkdown/kit/prose/state";
import { afterEach, expect, it } from "vitest";
import { createMarkdownEditor, type MarkdownEditor } from "@/components/knowledge/editor/editor-core";
import { tableActions } from "@/components/knowledge/editor/table-actions";
import { extractDocumentLinks } from "@/modules/knowledge/domain/document-links";

/**
 * Dragging a table's rows and columns by their grips (docs/superpowers/specs/2026-11-25-table-drag-reorder-design.md),
 * through the rendered editor. jsdom has no layout, so the table is given one: 300px wide, rows 30px tall
 * (header 0-30, then 30-60, 60-90), columns 100px wide.
 */

Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();
const editors: MarkdownEditor[] = [];
afterEach(async () => {
  for (const editor of editors.splice(0)) await editor.destroy();
  document.body.innerHTML = "";
});

const GRID = "| A | B | C |\n| :- | :-: | -: |\n| one | two | three |\n| four | five | six |";
async function open(markdown = GRID) {
  const root = document.body.appendChild(document.createElement("div"));
  const editor = await createMarkdownEditor({
    root, markdown, className: "kh-editor", ariaLabel: "Content", editable: true,
    onUserEdit() {}, onMarkdown() {}, allowImage: () => false, extraPlugins: [tableActions()],
  });
  editors.push(editor);
  const view = editor.action(ctx => ctx.get(editorViewCtx));
  view.focus();
  layout(root);
  return { root, editor, view };
}
function layout(root: HTMLElement) {
  root.querySelectorAll(".kh-markdown-table").forEach(table => { table.getBoundingClientRect = () => new DOMRect(0, 0, 300, 90); });
  root.querySelectorAll("tr").forEach((tr, row) => {
    tr.getBoundingClientRect = () => new DOMRect(0, row * 30, 300, 30);
    tr.querySelectorAll("th, td").forEach((cell, column) => { cell.getBoundingClientRect = () => new DOMRect(column * 100, row * 30, 100, 30); });
  });
}
const caretIn = (view: EditorView, text: string) => {
  let at = 0;
  view.state.doc.descendants((node, pos) => { if (node.isText && node.text === text) at = pos; });
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at)));
};
const grip = (name: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!;
const line = () => document.querySelector<HTMLElement>(".kh-table-drop-line")!;
const pointer = (type: string, target: EventTarget, x: number, y: number) =>
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }));
/** Press `from`, move through `path`, and release at its end (unless `release` is false). */
function drag(from: HTMLElement, path: Array<[number, number]>, release = true) {
  layout(document.body); // a table rebuilt by an earlier drop has new DOM
  pointer("pointerdown", from, 0, 0);
  for (const [x, y] of path) pointer("pointermove", document, x, y);
  if (release) { const [x, y] = path[path.length - 1]; pointer("pointerup", document, x, y); }
}
const table = (editor: MarkdownEditor) => editor.getMarkdown().split("\n").filter(l => l.trim().startsWith("|") && !/^\|[\s:|-]+$/.test(l.trim()))
  .map(l => l.split("|").slice(1, -1).map(c => c.trim()));
const delimiter = (editor: MarkdownEditor) => editor.getMarkdown().split("\n").find(l => /^\|[\s:|-]+$/.test(l.trim()))!.split("|").slice(1, -1).map(c => c.trim());

it("drags a body row down past the next one", async () => {
  const { editor, view } = await open();
  caretIn(view, "one");
  drag(grip("Row 2 actions"), [[10, 40], [10, 100]]);
  expect(table(editor)).toEqual([["A", "B", "C"], ["four", "five", "six"], ["one", "two", "three"]]);
});
it("drags a body row up to just below the header, never above it", async () => {
  const { editor, view } = await open();
  caretIn(view, "four");
  drag(grip("Row 3 actions"), [[10, 50], [10, -40]]);
  expect(table(editor)).toEqual([["A", "B", "C"], ["four", "five", "six"], ["one", "two", "three"]]);
  expect(editor.getMarkdown()).toMatch(/\|\s*A\s*\|\s*B\s*\|\s*C\s*\|\n\|\s*:-+/);
});
it("the header row's grip does not drag", async () => {
  const { editor, view } = await open();
  const original = editor.getMarkdown();
  caretIn(view, "A");
  drag(grip("Row 1 actions"), [[10, 10], [10, 100]]);
  expect(editor.getMarkdown()).toBe(original);
  expect(line().hidden).toBe(true);
});
it("drags a column with every cell and its alignment", async () => {
  const { editor, view } = await open();
  caretIn(view, "two");
  drag(grip("Column 2 actions"), [[150, 10], [290, 10]]);
  expect(table(editor)).toEqual([["A", "C", "B"], ["one", "three", "two"], ["four", "six", "five"]]);
  expect(delimiter(editor).map(c => `${c.startsWith(":") ? "l" : "-"}${c.endsWith(":") ? "r" : "-"}`)).toEqual(["l-", "-r", "lr"]);
});
it("drags the first column to the end and back to the front as single steps", async () => {
  const { editor, view } = await open();
  const original = editor.getMarkdown();
  caretIn(view, "one");
  drag(grip("Column 1 actions"), [[50, 10], [280, 10]]);
  expect(table(editor)[0]).toEqual(["B", "C", "A"]);
  undo(view.state, view.dispatch);
  expect(editor.getMarkdown()).toBe(original);
  caretIn(view, "three");
  drag(grip("Column 3 actions"), [[250, 10], [5, 10]]);
  expect(table(editor)[0]).toEqual(["C", "A", "B"]);
  expect(delimiter(editor)[0]).toMatch(/^-+:$/);
});
it("one drag is one undo step", async () => {
  const { editor, view } = await open();
  const original = editor.getMarkdown();
  caretIn(view, "one");
  const before = undoDepth(view.state);
  drag(grip("Row 2 actions"), [[10, 40], [10, 70], [10, 100]]);
  expect(undoDepth(view.state)).toBe(before + 1);
  expect(undo(view.state, view.dispatch)).toBe(true);
  expect(editor.getMarkdown()).toBe(original);
});
it("shows the drop line while dragging, horizontal for a row and vertical for a column", async () => {
  const { view } = await open();
  caretIn(view, "one");
  drag(grip("Row 2 actions"), [[10, 40], [10, 100]], false);
  expect(line().hidden).toBe(false);
  expect(line().classList.contains("kh-table-drop-line-column")).toBe(false);
  expect(line().style.top).toBe("90px");
  expect(line().style.width).toBe("300px");
  pointer("pointerup", document, 10, 100);
  expect(line().hidden).toBe(true);
  caretIn(view, "two");
  drag(grip("Column 2 actions"), [[150, 10], [10, 10]], false);
  expect(line().hidden).toBe(false);
  expect(line().classList.contains("kh-table-drop-line-column")).toBe(true);
  expect(line().style.left).toBe("0px");
  expect(line().style.height).toBe("90px");
  pointer("pointerup", document, 10, 10);
});
it("dropping in place changes nothing and makes no history entry", async () => {
  const { editor, view } = await open();
  const original = editor.getMarkdown();
  caretIn(view, "one");
  const before = undoDepth(view.state);
  drag(grip("Row 2 actions"), [[10, 40], [10, 50]]);
  drag(grip("Row 2 actions"), [[10, 40], [10, 70]]);
  caretIn(view, "two");
  drag(grip("Column 2 actions"), [[150, 10], [180, 10]]);
  expect(editor.getMarkdown()).toBe(original);
  expect(undoDepth(view.state)).toBe(before);
});
it("Escape cancels the drag, and the release after it is not a click", async () => {
  const { editor, view } = await open();
  const original = editor.getMarkdown();
  caretIn(view, "one");
  drag(grip("Row 2 actions"), [[10, 40], [10, 100]], false);
  expect(document.querySelector(".kh-table-drag-source")).not.toBeNull();
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  expect(line().hidden).toBe(true);
  expect(document.querySelector(".kh-table-drag-source")).toBeNull();
  pointer("pointerup", document, 10, 100);
  grip("Row 2 actions").click();
  expect(document.querySelector('[role=menu]:not([hidden])')).toBeNull();
  expect(editor.getMarkdown()).toBe(original);
});
it("a press without movement is still a click that opens the menu", async () => {
  const { editor, view } = await open();
  const original = editor.getMarkdown();
  caretIn(view, "one");
  const row = grip("Row 2 actions");
  pointer("pointerdown", row, 0, 0);
  pointer("pointermove", document, 2, 1);
  pointer("pointerup", document, 2, 1);
  row.click();
  expect(document.querySelector('[role=menu]:not([hidden])')).not.toBeNull();
  expect(editor.getMarkdown()).toBe(original);
});
it("the click that ends a drag does not open the menu", async () => {
  const { view } = await open();
  caretIn(view, "one");
  const row = grip("Row 2 actions");
  drag(row, [[10, 40], [10, 100]]);
  document.querySelector<HTMLButtonElement>(".kh-table-grip")!.click();
  expect(document.querySelector('[role=menu]:not([hidden])')).toBeNull();
});
it("wikilinks in moved cells keep their link edges", async () => {
  const { editor, view } = await open("| Topic | Link |\n| --- | --- |\n| a | [[Alpha]] |\n| b | [[Beta]] |");
  const links = () => extractDocumentLinks(editor.getMarkdown()).map(({ target, display }) => `${target}|${display ?? ""}`).sort();
  const before = links();
  expect(before).toHaveLength(2);
  caretIn(view, "a");
  drag(grip("Row 2 actions"), [[10, 40], [10, 100]]);
  expect(table(editor).map(row => row[0])).toEqual(["Topic", "b", "a"]);
  expect(links()).toEqual(before);
  caretIn(view, "Topic");
  drag(grip("Column 1 actions"), [[50, 10], [290, 10]]);
  expect(table(editor)[0]).toEqual(["Link", "Topic"]);
  expect(links()).toEqual(before);
  let wikiNodes = 0;
  view.state.doc.descendants(node => { if (node.type.name === "wiki_link") wikiNodes++; });
  expect(wikiNodes).toBe(2);
});
it("removes its drop line when the editor is destroyed", async () => {
  const { editor } = await open();
  await editor.destroy();
  editors.pop();
  expect(document.querySelector(".kh-table-drop-line")).toBeNull();
});
it("in a table scrolled in its box, the line stays on the table and a drop lands only among the rows in view", async () => {
  // Box 0-90; header plus four body rows at 30px each, so rows 4 and 5 (90-150) are scrolled out of view.
  const { editor, view } = await open("| A |\n| - |\n| r1 |\n| r2 |\n| r3 |\n| r4 |");
  caretIn(view, "r1");
  drag(grip("Row 2 actions"), [[10, 40], [10, 140]], false);
  const top = Number.parseFloat(line().style.top);
  expect(line().hidden).toBe(false);
  expect(top).toBeGreaterThanOrEqual(0);
  expect(top).toBeLessThanOrEqual(90);
  pointer("pointerup", document, 10, 140);
  expect(table(editor).map(row => row[0])).toEqual(["A", "r2", "r1", "r3", "r4"]);
});
