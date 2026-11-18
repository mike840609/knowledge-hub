// @vitest-environment jsdom
import { editorViewCtx } from "@milkdown/kit/core";
import { undo } from "@milkdown/kit/prose/history";
import type { EditorView } from "@milkdown/kit/prose/view";
import { TextSelection } from "@milkdown/kit/prose/state";
import { afterEach, expect, it } from "vitest";
import { createMarkdownEditor, type MarkdownEditor } from "@/components/knowledge/editor/editor-core";
import { tableActions } from "@/components/knowledge/editor/table-actions";
import { blockGutter } from "@/components/knowledge/editor/block-gutter";

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
async function open(extraPlugins = [tableActions()]) {
  const root = document.body.appendChild(document.createElement("div"));
  const editor = await createMarkdownEditor({
    root, markdown: "Before\n\n| A | B |\n| - | - |\n| one | two |\n| three | four |\n\nAfter",
    className: "kh-editor", ariaLabel: "Content", editable: true,
    onUserEdit() {}, onMarkdown() {}, allowImage: () => false, extraPlugins,
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
it("keeps the column grip inside the table's box", async () => {
  const { root, view } = await open();
  const th = root.querySelector("th")!;
  th.getBoundingClientRect = () => new DOMRect(100, 200, 80, 30);
  view.dispatch(view.state.tr.setSelection(view.state.selection));
  expect(button("Column 1 actions").style.top).toBe("200px");
  expect(button("Column 1 actions").style.left).toBe("128px");
});
it("Delete row on the header row leaves a valid table, one undo restores it", async () => {
  const { editor, view } = await open();
  const original = editor.getMarkdown();
  const types = () => { const t: string[] = []; view.state.doc.descendants(n => { if (/^table/.test(n.type.name)) t.push(n.type.name); }); return t; };
  const before = types();
  choose("Row 2 actions", "Delete row");
  undo(view.state, view.dispatch);
  let a = 0;
  view.state.doc.descendants((node, pos) => { if (node.isText && node.text === "A") a = pos; });
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, a)));
  choose("Row 1 actions", "Delete row");
  const after = editor.getMarkdown();
  expect(after).not.toMatch(/\|\s*A\s*\|/);
  expect(after).toContain("three");
  expect(types()).not.toEqual(before);
  expect(undo(view.state, view.dispatch)).toBe(true);
  expect(editor.getMarkdown()).toBe(original);
  expect(types()).toEqual(before);
});
it("opens a menu with ArrowDown on a grip and closes it with Escape", async () => {
  await open();
  const grip = button("Row 2 actions");
  grip.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  expect(document.querySelector("[role=menu]:not([hidden])")).not.toBeNull();
  expect(grip.getAttribute("aria-expanded")).toBe("true");
  document.querySelector("[role=menu]")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  expect(document.querySelector("[role=menu]:not([hidden])")).toBeNull();
  expect(grip.getAttribute("aria-expanded")).toBe("false");
});
it("deleting the last body row and then the only column leaves a sound document", async () => {
  const root = document.body.appendChild(document.createElement("div"));
  const editor = await createMarkdownEditor({
    root, markdown: "Before\n\n| A |\n| - |\n| x |\n\nAfter", className: "kh-editor", ariaLabel: "Content", editable: true,
    onUserEdit() {}, onMarkdown() {}, allowImage: () => false, extraPlugins: [tableActions()],
  });
  editors.push(editor);
  const view = editor.action(ctx => ctx.get(editorViewCtx));
  const caretIn = (text: string) => {
    let at = 0;
    view.state.doc.descendants((node, pos) => { if (node.isText && node.text === text) at = pos; });
    view.focus();
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at)));
  };
  caretIn("x");
  choose("Row 2 actions", "Delete row");
  expect(editor.getMarkdown()).not.toContain("x");
  expect(editor.getMarkdown()).toContain("After");
  // The editor keeps a body row, so deleting the last one leaves an empty row, not a headerless table.
  expect(root.querySelectorAll("tr")).toHaveLength(2);
  expect(root.querySelector("td")!.textContent).toBe("");
  caretIn("A");
  expect(button("Column 1 actions").hidden).toBe(false);
  const beforeColumn = view.state.doc.toString();
  // prosemirror-tables refuses to delete the only column: the table stays, unchanged and valid.
  choose("Column 1 actions", "Delete column");
  expect(view.state.doc.toString()).toBe(beforeColumn);
  expect(root.querySelector("table")).not.toBeNull();
  expect(editor.getMarkdown()).toContain("Before");
  expect(editor.getMarkdown()).toContain("After");
  expect(button("Column 1 actions").hidden).toBe(false);
  expect(button("Row 1 actions").hidden).toBe(false);
});

const cellIn = (view: EditorView) => {
  const { $from } = view.state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    if (/^table_(cell|header)$/.test($from.node(depth).type.name)) return { row: $from.index(depth - 2), column: $from.index(depth - 1), rows: $from.node(depth - 2).childCount };
  }
  return null;
};
it("Add row appends a row and puts the caret in its first cell", async () => {
  const { editor, view } = await open();
  const original = editor.getMarkdown();
  button("Add row").click();
  expect(rows(view)).toEqual([2, 2, 2, 2]);
  expect(cellIn(view)).toEqual({ row: 3, column: 0, rows: 4 });
  undo(view.state, view.dispatch);
  expect(editor.getMarkdown()).toBe(original);
});
it("Add column appends a column and keeps the caret's row", async () => {
  const { editor, view } = await open();
  const original = editor.getMarkdown();
  button("Add column").click();
  expect(rows(view)).toEqual([3, 3, 3]);
  expect(cellIn(view)).toEqual({ row: 1, column: 2, rows: 3 });
  undo(view.state, view.dispatch);
  expect(editor.getMarkdown()).toBe(original);
});
it("the bars sit below and right of the table, and hide with the grips", async () => {
  const { editor, view } = await open();
  let tablePos = 0;
  view.state.doc.descendants((node, pos) => { if (node.type.name === "table") tablePos = pos; });
  (view.nodeDOM(tablePos) as HTMLElement).getBoundingClientRect = () => new DOMRect(100, 200, 300, 90);
  view.dispatch(view.state.tr.setSelection(view.state.selection));
  const down = button("Add row"), right = button("Add column");
  expect(down.style.top).toBe("290px");
  expect(down.style.left).toBe("100px");
  expect(down.style.width).toBe("300px");
  expect(right.style.left).toBe("400px");
  expect(right.style.top).toBe("200px");
  expect(right.style.height).toBe("90px");
  editor.setEditable(false);
  expect(down.hidden).toBe(true);
  expect(right.hidden).toBe(true);
});
it("Alt+F10 in a cell focuses the row grip, not the block gutter", async () => {
  const { view } = await open([blockGutter(), tableActions()]);
  const event = new KeyboardEvent("keydown", { key: "F10", altKey: true, bubbles: true, cancelable: true });
  view.dom.dispatchEvent(event);
  expect(document.activeElement).toBe(button("Row 2 actions"));
  expect(document.activeElement).not.toBe(button("Move block"));
});
it("Alt+F10 reaches the row grip whichever plugin is registered first", async () => {
  const { view } = await open([tableActions(), blockGutter()]);
  view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: "F10", altKey: true, bubbles: true, cancelable: true }));
  expect(document.activeElement).toBe(button("Row 2 actions"));
});
it("Alt+F10 outside a table still reaches the block gutter", async () => {
  const { view } = await open([blockGutter(), tableActions()]);
  let before = 0;
  view.state.doc.descendants((node, pos) => { if (node.isText && node.text === "Before") before = pos; });
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, before)));
  view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: "F10", altKey: true, bubbles: true, cancelable: true }));
  expect(document.activeElement).not.toBe(button("Row 2 actions"));
});
it("Tab order from the row grip is Column grip, Add row, Add column", async () => {
  await open();
  const order = [...document.body.querySelectorAll<HTMLButtonElement>("button[aria-label]")].map(b => b.getAttribute("aria-label"));
  const from = order.indexOf("Row 2 actions");
  expect(order.slice(from, from + 4)).toEqual(["Row 2 actions", "Column 1 actions", "Add row", "Add column"]);
});
it("Escape in a grip or bar returns to the cell with the selection unchanged", async () => {
  const { view } = await open();
  const selection = view.state.selection;
  for (const name of ["Row 2 actions", "Add row", "Add column"]) {
    button(name).focus();
    button(name).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(view.hasFocus()).toBe(true);
    expect(view.state.selection.eq(selection)).toBe(true);
  }
});
