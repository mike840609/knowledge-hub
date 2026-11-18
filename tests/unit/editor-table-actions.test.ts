// @vitest-environment jsdom
import { editorViewCtx } from "@milkdown/kit/core";
import { undo } from "@milkdown/kit/prose/history";
import type { EditorView } from "@milkdown/kit/prose/view";
import { TextSelection } from "@milkdown/kit/prose/state";
import { afterEach, expect, it } from "vitest";
import { createMarkdownEditor, type MarkdownEditor } from "@/components/knowledge/editor/editor-core";
import { tableActions } from "@/components/knowledge/editor/table-actions";

Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();
const editors: MarkdownEditor[] = [];
afterEach(async () => {
  for (const editor of editors.splice(0)) await editor.destroy();
  document.body.innerHTML = "";
});
const button = (name: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!;
const item = (name: string) => [...document.querySelectorAll<HTMLElement>('[role=menu]:not([hidden]) [role^=menuitem]')].find(el => el.textContent === name)!;
const choose = (grip: string, name: string) => { button(grip).click(); item(name).click(); };
const rows = (view: EditorView) => { const out: number[] = []; view.state.doc.descendants(node => { if (/^table_(header_)?row$/.test(node.type.name)) out.push(node.childCount); }); return out; };
async function open() {
  const root = document.body.appendChild(document.createElement("div"));
  const editor = await createMarkdownEditor({
    root, markdown: "Before\n\n| A | B |\n| - | - |\n| one | two |\n| three | four |\n\nAfter",
    className: "kh-editor", ariaLabel: "Content", editable: true,
    onUserEdit() {}, onMarkdown() {}, allowImage: () => false, extraPlugins: [tableActions()],
  });
  editors.push(editor);
  const view = editor.action(ctx => ctx.get(editorViewCtx));
  let pos = 0;
  view.state.doc.descendants((node, position) => {
    if (node.isText && node.text === "one") pos = position;
  });
  view.focus();
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)));
  return { root, editor, view };
}
it("row menu inserts above and below", async () => {
  const { editor, view } = await open();
  const original = editor.getMarkdown();
  choose("Row 2 actions", "Insert row above");
  expect(rows(view)).toEqual([2, 2, 2, 2]);
  expect(editor.getMarkdown()).toMatch(/\|\s*-+\s*\|\s*-+\s*\|\n\|\s*\|\s*\|\n\|\s*one/);
  undo(view.state, view.dispatch);
  expect(editor.getMarkdown()).toBe(original);
  choose("Row 2 actions", "Insert row below");
  expect(rows(view)).toEqual([2, 2, 2, 2]);
  expect(editor.getMarkdown()).toMatch(/one[^\n]*\n\|\s*\|\s*\|\n\|\s*three/);
  undo(view.state, view.dispatch);
  expect(editor.getMarkdown()).toBe(original);
});
it("column menu inserts left and right", async () => {
  const { editor, view } = await open();
  const original = editor.getMarkdown();
  for (const name of ["Insert column left", "Insert column right"]) {
    choose("Column 1 actions", name);
    expect(rows(view)).toEqual([3, 3, 3]);
    undo(view.state, view.dispatch);
    expect(editor.getMarkdown()).toBe(original);
  }
});
it("header row offers no Insert row above", async () => {
  const { view } = await open();
  let a = 0;
  view.state.doc.descendants((node, pos) => { if (node.isText && node.text === "A") a = pos; });
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, a)));
  button("Row 1 actions").click();
  const labels = [...document.querySelectorAll('[role=menu]:not([hidden]) [role^=menuitem]')].map(el => el.textContent);
  expect(labels).toEqual(["Insert row below", "Delete row"]);
});
it("aligns from the column menu", async () => {
  const { root, editor, view } = await open();
  choose("Column 1 actions", "Center");
  const headers: string[] = [];
  view.state.doc.descendants(node => { if (node.type.name === "table_header") headers.push(String(node.attrs.alignment)); });
  expect(headers[0]).toBe("center");
  expect(editor.getMarkdown()).toMatch(/\|\s*:-+:\s*\|/);
  expect(root.querySelector("th")!.style.textAlign).toBe("center");
  button("Column 1 actions").click();
  expect(item("Center").getAttribute("aria-checked")).toBe("true");
  expect(item("Left").getAttribute("aria-checked")).toBe("false");
  item("Default").click();
  expect(editor.getMarkdown()).not.toMatch(/\|\s*:-+:/);
});
it("aligns only that column, and undoes as one step", async () => {
  const { editor, view } = await open();
  const aligns = () => { const v: Array<string | null> = []; view.state.doc.descendants(n => { if (n.type.name === "table_header") v.push(n.attrs.alignment ?? null); }); return v; };
  choose("Column 1 actions", "Center");
  expect(aligns()).toEqual(["center", null]);
  let two = 0;
  view.state.doc.descendants((node, pos) => { if (node.isText && node.text === "two") two = pos; });
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, two)));
  choose("Column 2 actions", "Right");
  expect(aligns()).toEqual(["center", "right"]);
  undo(view.state, view.dispatch);
  expect(aligns()).toEqual(["center", null]);
  expect(editor.getMarkdown()).toMatch(/\|\s*:-+:\s*\|\s*-+\s*\|/);
});
it.each(["Delete row", "Delete column"])("%s changes the table and can be undone", async (action) => {
  const { root, editor, view } = await open();
  const original = editor.getMarkdown();
  choose(action === "Delete row" ? "Row 2 actions" : "Column 1 actions", action);
  expect(editor.getMarkdown()).toContain("Before");
  expect(editor.getMarkdown()).toContain("After");
  expect(editor.getMarkdown()).not.toContain("one");
  if (action === "Delete row") {
    expect(root.querySelectorAll("tr")).toHaveLength(2);
    expect(editor.getMarkdown()).toContain("three");
  } else {
    expect(root.querySelectorAll("th")).toHaveLength(1);
    expect(editor.getMarkdown()).toContain("two");
  }
  expect(undo(view.state, view.dispatch)).toBe(true);
  expect(editor.getMarkdown()).toBe(original);
});
it("has no Delete table among the table controls", async () => {
  await open();
  button("Row 2 actions").click();
  expect(document.querySelector('[aria-label="Delete table"]')).toBeNull();
  expect(item("Delete table")).toBeUndefined();
});
it("acts on the hovered cell, not the caret's", async () => {
  const { root, editor } = await open();
  const cell = [...root.querySelectorAll("td")].find(td => td.textContent === "four")!;
  cell.dispatchEvent(new Event("pointermove", { bubbles: true }));
  choose("Row 3 actions", "Delete row");
  const markdown = editor.getMarkdown();
  expect(markdown).not.toContain("four");
  expect(markdown).not.toContain("three");
  expect(markdown).toContain("one");
});
it("read-only shows no controls and cleans up on destroy", async () => {
  const { editor } = await open();
  expect(button("Row 2 actions").hidden).toBe(false);
  button("Row 2 actions").click();
  editor.setEditable(false);
  expect(button("Row 2 actions").hidden).toBe(true);
  expect(button("Column 1 actions").hidden).toBe(true);
  await editor.destroy();
  editors.pop();
  expect(document.querySelector(".kh-table-grip, .kh-table-col-grip, [role=menu]")).toBeNull();
});
it("cleans up every control on destroy with a menu open", async () => {
  const { editor } = await open();
  button("Column 1 actions").click();
  await editor.destroy();
  editors.pop();
  expect(document.querySelector(".kh-table-grip, .kh-table-col-grip, [role=menu]")).toBeNull();
});
it("deleting the last body row and the only column does not throw", async () => {
  const root = document.body.appendChild(document.createElement("div"));
  const editor = await createMarkdownEditor({
    root, markdown: "| A |\n| - |\n| x |", className: "kh-editor", ariaLabel: "Content", editable: true,
    onUserEdit() {}, onMarkdown() {}, allowImage: () => false, extraPlugins: [tableActions()],
  });
  editors.push(editor);
  const view = editor.action(ctx => ctx.get(editorViewCtx));
  let x = 0;
  view.state.doc.descendants((node, pos) => { if (node.isText && node.text === "x") x = pos; });
  view.focus();
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, x)));
  expect(() => choose("Row 2 actions", "Delete row")).not.toThrow();
  expect(() => { if (button("Column 1 actions") && !button("Column 1 actions").hidden) choose("Column 1 actions", "Delete column"); }).not.toThrow();
});
