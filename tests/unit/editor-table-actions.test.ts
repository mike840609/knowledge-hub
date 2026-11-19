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
// jsdom has no layout. Give the grips a visible table unless a case supplies its own bounds.
function showTables(root: HTMLElement) {
  root.querySelectorAll(".kh-markdown-table").forEach(table => {
    table.getBoundingClientRect = () => new DOMRect(0, 0, 300, 120);
  });
}
async function open(extraPlugins = [tableActions()]) {
  const root = document.body.appendChild(document.createElement("div"));
  const editor = await createMarkdownEditor({
    root, markdown: "Before\n\n| A | B |\n| - | - |\n| one | two |\n| three | four |\n\nAfter",
    className: "kh-editor", ariaLabel: "Content", editable: true,
    onUserEdit() {}, onMarkdown() {}, allowImage: () => false, extraPlugins,
  });
  editors.push(editor);
  showTables(root);
  const view = editor.action(ctx => ctx.get(editorViewCtx));
  let pos = 0;
  view.state.doc.descendants((node, position) => {
    if (node.isText && node.text === "one") pos = position;
  });
  view.focus();
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)));
  return { root, editor, view };
}

/** The same editor over a caller's Markdown, for shapes the shared fixture cannot express. */
async function openMarkdown(markdown: string) {
  const root = document.body.appendChild(document.createElement("div"));
  const editor = await createMarkdownEditor({
    root, markdown, className: "kh-editor", ariaLabel: "Content", editable: true,
    onUserEdit() {}, onMarkdown() {}, allowImage: () => false, extraPlugins: [tableActions()],
  });
  editors.push(editor);
  showTables(root);
  const view = editor.action(ctx => ctx.get(editorViewCtx));
  view.focus();
  return { root, editor, view };
}

const caretInCell = (view: EditorView, text: string) => {
  let at = 0;
  view.state.doc.descendants((node, pos) => { if (node.isText && node.text === text) at = pos; });
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at)));
};
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
it("the column grip is a low handle straddling the table's top border", async () => {
  const { view } = await open();
  let tablePos = 0;
  view.state.doc.descendants((node, pos) => { if (node.type.name === "table") tablePos = pos; });
  (view.nodeDOM(tablePos) as HTMLElement).getBoundingClientRect = () => new DOMRect(100, 200, 300, 90);
  view.dom.querySelector("td")!.getBoundingClientRect = () => new DOMRect(100, 201, 80, 30);
  view.dispatch(view.state.tr.setSelection(view.state.selection));
  expect(button("Column 1 actions").style.top).toBe("194px");
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
it("Delete column stays available after the header row is deleted", async () => {
  const { editor, view } = await open();
  let a = 0;
  view.state.doc.descendants((node, pos) => { if (node.isText && node.text === "A") a = pos; });
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, a)));
  choose("Row 1 actions", "Delete row");
  // GFM always has a header row: deleting it promotes the first body row instead of leaving an empty one.
  expect(rows(view)).toEqual([2, 2]);
  button("Column 1 actions").click();
  const remove = item("Delete column") as HTMLButtonElement;
  expect(remove.disabled).toBe(false);
  remove.click();
  expect(rows(view)).toEqual([1, 1]);
  expect(editor.getMarkdown()).toContain("Before");
});
it("Deleting the header row of a header-plus-one-row table keeps the table valid", async () => {
  const { editor, view } = await openMarkdown("| A | B |\n| - | - |\n| one | two |\n");
  caretInCell(view, "A");
  choose("Row 1 actions", "Delete row");
  // The promoted row is the header; a table needs at least one body row, so an empty one remains.
  expect(rows(view)).toEqual([2, 2]);
  expect(() => view.state.doc.check()).not.toThrow();
  expect(editor.getMarkdown()).toMatch(/\|\s*one\s*\|\s*two\s*\|/);
  button("Add row").click();
  expect(rows(view)).toEqual([2, 2, 2]);
});
it("Deleting the only body row leaves the caret in the emptied row, not the header", async () => {
  const { view } = await openMarkdown("| A | B |\n| - | - |\n| one | two |\n");
  caretInCell(view, "one");
  choose("Row 2 actions", "Delete row");
  // The row survives empty; the caret stays in its cell so the next keystroke cannot edit the header.
  expect(cellIn(view)).toEqual({ row: 1, column: 0, rows: 2 });
  expect(view.state.selection.$from.parent.textContent).toBe("");
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
  showTables(root);
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
  // prosemirror-tables refuses to delete the only column; the menu says so rather than offering it.
  button("Column 1 actions").click();
  expect((item("Delete column") as HTMLButtonElement).disabled).toBe(true);
  item("Delete column").click();
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
it.each([
  ["four", "Row 3 actions", "Delete row", "two"],
  ["two", "Row 2 actions", "Delete row", "four"],
  ["two", "Column 2 actions", "Delete column", "one"],
  ["one", "Column 1 actions", "Delete column", "two"],
  ["B", "Row 1 actions", "Delete row", "two"],
])("deleting from %s with %s keeps the caret in the adjacent surviving cell", async (text, grip, action, remaining) => {
  const { root, editor, view } = await open();
  const original = editor.getMarkdown();
  const target = [...root.querySelectorAll("td, th")].find(cell => cell.textContent === text)!;
  target.dispatchEvent(new Event("pointermove", { bubbles: true }));
  choose(grip, action);
  expect(view.state.selection.$from.parent.textContent).toBe(remaining);
  expect(undo(view.state, view.dispatch)).toBe(true);
  expect(editor.getMarkdown()).toBe(original);
});

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
it("Add column keeps the caret's row when the pointer is over another row", async () => {
  const { view } = await open();
  const hovered = [...document.querySelectorAll("td")].find(td => td.textContent === "four")!;
  hovered.dispatchEvent(new Event("pointermove", { bubbles: true }));
  button("Add column").click();
  expect(cellIn(view)).toEqual({ row: 1, column: 2, rows: 3 });
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

/** Mocked layout for the editor's table, its rows and first column: jsdom has none. */
function layout(root: HTMLElement, view: EditorView, rects: { table: DOMRect; row0?: DOMRect; firstColumn?: DOMRect; pane?: DOMRect; editor?: DOMRect }) {
  let tablePos = 0;
  view.state.doc.descendants((node, pos) => { if (node.type.name === "table") tablePos = pos; });
  (view.nodeDOM(tablePos) as HTMLElement).getBoundingClientRect = () => rects.table;
  if (rects.row0) root.querySelectorAll("tr").forEach((tr, index) => { tr.getBoundingClientRect = () => new DOMRect(rects.row0!.x, rects.row0!.y + index * rects.row0!.height, rects.row0!.width, rects.row0!.height); });
  if (rects.firstColumn) root.querySelectorAll("tr > :first-child").forEach(cell => { cell.getBoundingClientRect = () => rects.firstColumn!; });
  if (rects.pane) { root.classList.add("kh-document-pane"); root.getBoundingClientRect = () => rects.pane!; }
  if (rects.editor) view.dom.getBoundingClientRect = () => rects.editor!;
  view.dispatch(view.state.tr.setSelection(view.state.selection));
}
const at = (name: string) => ({ left: parseFloat(button(name).style.left), top: parseFloat(button(name).style.top) });

it("the header-row grip stays below the block gutter's buttons", async () => {
  const { root, view } = await open([blockGutter(), tableActions()]);
  let a = 0;
  view.state.doc.descendants((node, pos) => { if (node.isText && node.text === "A") a = pos; });
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, a)));
  layout(root, view, { table: new DOMRect(100, 200, 300, 90), row0: new DOMRect(100, 200, 300, 36), editor: new DOMRect(44, 100, 600, 500) });
  const grip = button("Row 1 actions");
  expect(grip.hidden).toBe(false);
  // The block gutter is 24px tall at the table's top; the grip's box starts below it.
  expect(parseFloat(grip.style.top)).toBeGreaterThanOrEqual(200 + 24 + 4);
  // A body row's grip is level with its row.
  const body = root.querySelectorAll("tr")[1] as HTMLElement;
  body.getBoundingClientRect = () => new DOMRect(100, 240, 300, 40);
  let one = 0;
  view.state.doc.descendants((node, pos) => { if (node.isText && node.text === "one") one = pos; });
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, one)));
  expect(parseFloat(button("Row 2 actions").style.top)).toBe(240 + 20 - 12);
});
it("the pointer leaving into the block gutter keeps the hovered cell", async () => {
  const { root, view } = await open([blockGutter(), tableActions()]);
  const cell = [...root.querySelectorAll("td")].find(td => td.textContent === "four")!;
  cell.dispatchEvent(new Event("pointermove", { bubbles: true }));
  expect(button("Row 3 actions")).toBeTruthy();
  const gutterButton = document.querySelector(".kh-block-gutter button")!;
  view.dom.dispatchEvent(new MouseEvent("pointerleave", { relatedTarget: gutterButton }));
  expect(button("Row 3 actions").hidden).toBe(false);
  view.dom.dispatchEvent(new MouseEvent("pointerleave", { relatedTarget: document.body }));
  expect(button("Row 2 actions").hidden).toBe(false);
});
it("the controls are clamped to the document pane and the gutter width is read from the editor", async () => {
  const { root, view } = await open();
  view.dom.style.paddingLeft = "40px";
  layout(root, view, { table: new DOMRect(100, 200, 700, 90), firstColumn: new DOMRect(100, 201, 80, 30), pane: new DOMRect(50, 100, 600, 400), editor: new DOMRect(80, 100, 600, 400) });
  // (40 - 24) / 2 = 8 from the editor's left edge, 88; the pane's own edge plus 4 is 54.
  expect(at("Row 2 actions").left).toBe(88);
  view.dom.getBoundingClientRect = () => new DOMRect(20, 100, 600, 400);
  view.dispatch(view.state.tr.setSelection(view.state.selection));
  expect(at("Row 2 actions").left).toBe(54);
  expect(button("Add column").hidden).toBe(true);
  expect(button("Add row").hidden).toBe(false);
  expect(parseFloat(button("Add row").style.left) + parseFloat(button("Add row").style.width)).toBe(650);
});
it("hides the row grip when the visible table cannot fit it", async () => {
  const { root, view } = await open();
  const table = new DOMRect(100, 100, 300, 90);
  const row0 = new DOMRect(100, 100, 300, 45);
  layout(root, view, { table, row0, pane: new DOMRect(50, 170, 600, 400) });
  expect(button("Row 2 actions").hidden).toBe(true);
});
it("keeps the add bars outside the table as its edges scroll through the pane", async () => {
  const { root, view } = await open();
  const pane = new DOMRect(50, 100, 600, 400);
  layout(root, view, { table: new DOMRect(100, 420, 300, 90), pane });
  expect(button("Add row").hidden).toBe(true);
  expect(button("Add column").hidden).toBe(false);
  layout(root, view, { table: new DOMRect(345, 405, 300, 90), pane });
  expect(at("Add row").top).toBe(495);
  expect(button("Add row").style.maxHeight).toBe("5px");
  expect(at("Add column").left).toBe(645);
  expect(button("Add column").style.maxWidth).toBe("5px");
  layout(root, view, { table: new DOMRect(100, 200, 300, 90), pane });
  expect(button("Add row").hidden).toBe(false);
  expect(at("Add row").top).toBe(290);
  expect(button("Add column").hidden).toBe(false);
  expect(at("Add column").left).toBe(400);
});
it("hides every control, and an open menu, when the table leaves the pane", async () => {
  const { root, view } = await open();
  layout(root, view, { table: new DOMRect(100, 200, 300, 90), pane: new DOMRect(50, 100, 600, 400) });
  button("Row 2 actions").click();
  expect(document.querySelector("[role=menu]:not([hidden])")).not.toBeNull();
  layout(root, view, { table: new DOMRect(100, 10, 300, 60), pane: new DOMRect(50, 100, 600, 400) });
  for (const name of ["Row 2 actions", "Column 1 actions", "Add row", "Add column"]) expect(button(name).hidden).toBe(true);
  expect(document.querySelector("[role=menu]:not([hidden])")).toBeNull();
});
it("hides the column grip and its menu when its column leaves the table's visible box", async () => {
  const { root, view } = await open();
  layout(root, view, { table: new DOMRect(100, 200, 300, 90), row0: new DOMRect(100, 200, 300, 36), firstColumn: new DOMRect(100, 201, 80, 30) });
  button("Column 1 actions").click();
  expect(document.querySelector("[role=menu]:not([hidden])")).not.toBeNull();
  layout(root, view, { table: new DOMRect(100, 200, 300, 90), row0: new DOMRect(100, 200, 300, 36), firstColumn: new DOMRect(-300, 201, 80, 30) });
  expect(button("Column 1 actions").hidden).toBe(true);
  expect(button("Row 2 actions").hidden).toBe(false);
  expect(document.querySelector("[role=menu]:not([hidden])")).toBeNull();
});
it("a menu follows its grip and flips above it when there is no room below", async () => {
  const { view } = await open();
  const grip = button("Row 2 actions");
  grip.getBoundingClientRect = () => new DOMRect(100, 300, 24, 24);
  grip.click();
  const menu = document.querySelector<HTMLElement>("[role=menu]")!;
  Object.defineProperty(menu, "offsetHeight", { value: 200, configurable: true });
  Object.defineProperty(menu, "offsetWidth", { value: 160, configurable: true });
  view.dispatch(view.state.tr.setSelection(view.state.selection));
  expect(menu.style.top).toBe("328px");
  grip.getBoundingClientRect = () => new DOMRect(1000, 700, 24, 24);
  view.dispatch(view.state.tr.setSelection(view.state.selection));
  expect(menu.style.top).toBe(`${700 - 4 - 200}px`);
  expect(menu.style.left).toBe(`${window.innerWidth - 160 - 8}px`);
});
it("closes an open menu when the editor turns read-only", async () => {
  const { editor } = await open();
  button("Row 2 actions").click();
  expect(document.querySelector("[role=menu]:not([hidden])")).not.toBeNull();
  editor.setEditable(false);
  expect(document.querySelector("[role=menu]:not([hidden])")).toBeNull();
});
it("new columns are saved with the default alignment", async () => {
  const { editor, view } = await open();
  const delimiter = () => editor.getMarkdown().split("\n").find(line => /^\|\s*:?-+/.test(line))!;
  for (const name of ["Insert column left", "Insert column right"]) {
    choose("Column 1 actions", name);
    expect(delimiter()).toMatch(/^\|\s*-+\s*\|\s*-+\s*\|\s*-+\s*\|$/);
    undo(view.state, view.dispatch);
  }
  button("Add column").click();
  expect(delimiter()).toMatch(/^\|\s*-+\s*\|\s*-+\s*\|\s*-+\s*\|$/);
  expect(delimiter()).not.toContain(":");
});
it("keeps an existing column's alignment when a column is added beside it", async () => {
  const { editor } = await open();
  choose("Column 1 actions", "Center");
  choose("Column 1 actions", "Insert column right");
  expect(editor.getMarkdown()).toMatch(/\|\s*:-+:\s*\|\s*-+\s*\|\s*-+\s*\|/);
});
it("text typed right after an action is its own undo step", async () => {
  const { editor, view } = await open();
  choose("Row 2 actions", "Insert row below");
  const afterAction = editor.getMarkdown();
  view.dispatch(view.state.tr.insertText("zz"));
  expect(editor.getMarkdown()).toContain("zz");
  undo(view.state, view.dispatch);
  expect(editor.getMarkdown()).toBe(afterAction);
  button("Add row").click();
  const afterBar = editor.getMarkdown();
  view.dispatch(view.state.tr.insertText("yy"));
  undo(view.state, view.dispatch);
  expect(editor.getMarkdown()).toBe(afterBar);
});
it("Alt+F10 uses the caret's table, not the one last hovered", async () => {
  const root = document.body.appendChild(document.createElement("div"));
  const table = "| A | B |\n| - | - |\n| one | two |\n| three | four |";
  const editor = await createMarkdownEditor({
    root, markdown: `${table}\n\nMiddle\n\n${table.replace("one", "uno").replace("four", "vier")}`, className: "kh-editor", ariaLabel: "Content", editable: true,
    onUserEdit() {}, onMarkdown() {}, allowImage: () => false, extraPlugins: [tableActions()],
  });
  editors.push(editor);
  showTables(root);
  const view = editor.action(ctx => ctx.get(editorViewCtx));
  let one = 0;
  view.state.doc.descendants((node, pos) => { if (node.isText && node.text === "one") one = pos; });
  view.focus();
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, one)));
  [...root.querySelectorAll("td")].find(td => td.textContent === "vier")!.dispatchEvent(new Event("pointermove", { bubbles: true }));
  expect(button("Row 3 actions")).toBeTruthy();
  view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: "F10", altKey: true, bubbles: true, cancelable: true }));
  expect(document.activeElement).toBe(button("Row 2 actions"));
});
it("moving over another block clears the hovered cell", async () => {
  const { root, view } = await open();
  [...root.querySelectorAll("td")].find(td => td.textContent === "four")!.dispatchEvent(new Event("pointermove", { bubbles: true }));
  expect(button("Row 3 actions")).toBeTruthy();
  // The editor's own gutter, between a row and its grip, does not count as leaving.
  view.dom.dispatchEvent(new Event("pointermove", { bubbles: true }));
  expect(button("Row 3 actions")).toBeTruthy();
  [...root.querySelectorAll("p")].find(p => p.textContent === "After")!.dispatchEvent(new Event("pointermove", { bubbles: true }));
  expect(button("Row 2 actions")).toBeTruthy();
});
