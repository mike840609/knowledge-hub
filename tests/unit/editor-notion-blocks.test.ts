// @vitest-environment jsdom
import { editorViewCtx } from "@milkdown/kit/core";
import { undo } from "@milkdown/kit/prose/history";
import { TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { createMarkdownEditor, type MarkdownEditor } from "@/components/knowledge/editor/editor-core";
import { CodeLanguageField } from "@/components/knowledge/editor/inline-code-preview";
import { RenderedEditor } from "@/components/knowledge/editor/rendered-editor";
import { tableActions } from "@/components/knowledge/editor/table-actions";
import { extractDocumentLinks } from "@/modules/knowledge/domain/document-links";
import { calloutKind } from "@/shared/markdown/remark-callouts";

// Editor Notion-parity spec, decisions 17-20, through the rendered editor.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const rect = { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => rect;
const opened: MarkdownEditor[] = [];
const mounted: Root[] = [];
afterEach(async () => {
  for (const root of mounted.splice(0)) act(() => root.unmount());
  while (opened.length) await opened.pop()!.destroy();
  document.body.innerHTML = "";
});

async function open(markdown: string) {
  const root = document.body.appendChild(document.createElement("div"));
  const editor = await createMarkdownEditor({ root, markdown, className: "kh-editor", ariaLabel: "Content", editable: true, onUserEdit() {}, onMarkdown() {}, allowImage: () => false, extraPlugins: [tableActions()] });
  opened.push(editor);
  const view = editor.action(ctx => ctx.get(editorViewCtx));
  view.focus();
  return { root, editor, view };
}
const CODES: Record<string, number> = { Tab: 9, Enter: 13, Escape: 27, ArrowDown: 40, ArrowUp: 38 };
function press(view: EditorView, key: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  Object.defineProperty(event, "keyCode", { value: CODES[key] ?? 0 });
  view.dom.dispatchEvent(event);
  return event;
}
const caretAfter = (view: EditorView, text: string, nth = 0) => {
  let found = -1;
  let seen = 0;
  view.state.doc.descendants((node, pos) => {
    if (node.isText && node.text!.includes(text) && seen++ === nth) found = pos + node.text!.indexOf(text) + text.length;
  });
  expect(found).toBeGreaterThanOrEqual(0);
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, found)));
};
const links = (markdown: string) => extractDocumentLinks(markdown).map(({ kind, target, fragment, display }) => ({ kind, target, fragment, display }));

describe("toggle (17)", () => {
  const closed = "<details>\n<summary>Title</summary>\n\nBody [[Target]]\n\n</details>\n";
  it("Enter at the end of the summary opens a collapsed toggle and lands in the body's first line", async () => {
    const { editor, view } = await open(closed);
    caretAfter(view, "Title");
    expect(press(view, "Enter").defaultPrevented).toBe(true);
    expect(view.state.selection.$from.parent.type.name).toBe("paragraph");
    expect(view.state.selection.$from.parent.textContent).toContain("Body");
    expect(view.state.selection.$from.parentOffset).toBe(0);
    expect(editor.getMarkdown().startsWith("<details open>")).toBe(true);
    expect(links(editor.getMarkdown())).toEqual(links(closed));
  });
  it("leaves an open toggle open and moves into the body", async () => {
    const { editor, view } = await open(closed.replace("<details>", "<details open>"));
    caretAfter(view, "Title");
    press(view, "Enter");
    expect(view.state.selection.$from.parent.type.name).toBe("paragraph");
    expect(editor.getMarkdown().startsWith("<details open>")).toBe(true);
  });
  it("an empty summary keeps its placeholder and an existing toggle's Markdown is untouched", async () => {
    const { root, editor } = await open("<details>\n<summary></summary>\n\nBody\n\n</details>\n");
    expect(root.querySelector("summary")?.getAttribute("data-placeholder")).toBe("Details");
    const markdown = editor.getMarkdown();
    expect((await open(markdown)).editor.getMarkdown()).toBe(markdown);
  });
});

describe("table Tab (18)", () => {
  const table = "| A | B |\n| - | - |\n| one | two |\n| three | four |\n\nAfter [[Target]]\n";
  it("Tab in the last cell adds a row of the same width and enters its first cell, in one undo step", async () => {
    const { root, editor, view } = await open(table);
    caretAfter(view, "four");
    expect(press(view, "Tab").defaultPrevented).toBe(true);
    expect(root.querySelectorAll("tr")).toHaveLength(4);
    expect(root.querySelectorAll("tr")[3].children).toHaveLength(2);
    expect(view.state.selection.$from.parent.textContent).toBe("");
    expect(view.state.selection.$from.node(view.state.selection.$from.depth - 1).type.name).toBe("table_cell");
    expect(view.state.selection.$from.index(view.state.selection.$from.depth - 2)).toBe(0);
    view.dispatch(view.state.tr.insertText("five"));
    expect(editor.getMarkdown()).toContain("| five");
    expect(links(editor.getMarkdown())).toEqual(links(table));
    undo(view.state, view.dispatch);
    undo(view.state, view.dispatch);
    expect(root.querySelectorAll("tr")).toHaveLength(3);
  });
  it("Tab elsewhere only moves; Shift-Tab is unchanged and adds nothing", async () => {
    const { root, view } = await open(table);
    caretAfter(view, "one");
    press(view, "Tab");
    expect(root.querySelectorAll("tr")).toHaveLength(3);
    expect(view.state.selection.$from.parent.textContent).toBe("two");
    caretAfter(view, "one");
    press(view, "Tab", { shiftKey: true });
    expect(root.querySelectorAll("tr")).toHaveLength(3);
  });
});

describe("code block keys (19)", () => {
  const code = "```js\nconst a = 1;\nconst b = 2;\n```\n\nSee [[Target]]\n";
  it("Tab inserts two spaces at the caret; Shift-Tab removes them", async () => {
    const { editor, view } = await open(code);
    caretAfter(view, "const a");
    expect(press(view, "Tab").defaultPrevented).toBe(true);
    expect(editor.getMarkdown()).toContain("const a   = 1;");
    // Shift-Tab takes leading spaces only: the caret is mid-line, and the line has none.
    expect(press(view, "Tab", { shiftKey: true }).defaultPrevented).toBe(true);
    expect(editor.getMarkdown()).toContain("const a   = 1;");
    expect(editor.getMarkdown()).toContain("const b = 2;");
    expect(links(editor.getMarkdown())).toEqual(links(code));
  });
  it("Shift-Tab at the very start, before a leading empty line, leaves the next line alone", async () => {
    const { editor, view } = await open("```\n\n  two\n```\n");
    let at = 0;
    view.state.doc.descendants((node, pos) => { if (node.type.name === "code_block") at = pos + 1; });
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at)));
    press(view, "Tab", { shiftKey: true });
    expect(editor.getMarkdown()).toContain("\n  two\n");
  });
  it("indents every selected line and outdents up to two spaces of each", async () => {
    const { editor, view } = await open("```\none\n   two\nthree\n```\n");
    let from = 0;
    let to = 0;
    view.state.doc.descendants((node, pos) => { if (node.type.name === "code_block") { from = pos + 2; to = pos + node.nodeSize - 2; } });
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)));
    press(view, "Tab");
    expect(editor.getMarkdown()).toContain("```\n  one\n     two\n  three\n```");
    press(view, "Tab", { shiftKey: true });
    expect(editor.getMarkdown()).toContain("```\none\n   two\nthree\n```");
    press(view, "Tab", { shiftKey: true });
    expect(editor.getMarkdown()).toContain("```\none\n two\nthree\n```");
  });
  it("does not bind Tab outside a code block", async () => {
    const { view } = await open("plain\n");
    caretAfter(view, "plain");
    expect(press(view, "Tab").defaultPrevented).toBe(false);
    expect(view.state.doc.textContent).toBe("plain");
  });
  it("ignores Tab while the field it goes to is not editable", async () => {
    const { editor, view } = await open(code);
    editor.action(ctx => ctx.get(editorViewCtx).setProps({ editable: () => false }));
    caretAfter(view, "const a");
    expect(press(view, "Tab").defaultPrevented).toBe(false);
  });
});

describe("code language field (19)", () => {
  function mount(markdown: string) {
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);
    mounted.push(root);
    let ready!: (editor: MarkdownEditor) => void;
    const built = new Promise<MarkdownEditor>(resolve => { ready = resolve; });
    act(() => root.render(createElement(RenderedEditor, {
      workspaceId: "00000000-0000-4000-8000-000000000001", markdown, editable: true, renderCode: code => createElement("div", { "data-fake-preview": "" }, code),
      renderLanguage: (language, onChange) => createElement(CodeLanguageField, { language, onChange }),
      onReady: editor => ready(editor), onFail() {}, onUserEdit() {}, onMarkdown() {},
    })));
    return { container, built };
  }
  const flush = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  it("a press on the rendered code edits it, as Notion's does", async () => {
    const markdown = "```js\nconst a = 1;\n```\n";
    const { container, built } = mount(markdown);
    await built;
    await flush();
    expect(container.querySelector("select")).toBeNull();
    const preview = container.querySelector<HTMLElement>("[data-fake-preview]")!;
    act(() => { preview.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true })); });
    await flush();
    expect(container.querySelector("select")).not.toBeNull();
  });
  it("shows only while the block is being edited, writes the fence's language, and writes none for Plain text", async () => {
    const markdown = "```js\nconst a = 1;\n```\n\nSee [[Target]]\n";
    const { container, built } = mount(markdown);
    const editor = await built;
    await flush();
    expect(container.querySelector("select")).toBeNull();
    act(() => { [...container.querySelectorAll("button")].find(b => b.textContent === "Edit code")!.click(); });
    await flush();
    const select = container.querySelector("select")!;
    expect(select).not.toBeNull();
    const options = [...select.options].map(option => option.value);
    expect(options[0]).toBe("");
    expect(select.options[0].textContent).toBe("Plain text");
    expect(options).toContain("python");
    expect(options).toContain("dockerfile");
    expect(select.value).toBe("js");
    const change = (value: string) => act(() => { select.value = value; select.dispatchEvent(new Event("change", { bubbles: true })); });
    change("python");
    expect(editor.getMarkdown()).toContain("```python\nconst a = 1;\n```");
    expect(links(editor.getMarkdown())).toEqual(links(markdown));
    change("");
    expect(editor.getMarkdown()).toContain("```\nconst a = 1;\n```");
    expect(links(editor.getMarkdown())).toEqual(links(markdown));
    // Done editing, with the caret out of the block, as a click on the button leaves it.
    const v = editor.action(ctx => ctx.get(editorViewCtx));
    act(() => { v.dispatch(v.state.tr.setSelection(TextSelection.atEnd(v.state.doc))); [...container.querySelectorAll("button")].find(b => b.textContent === "Done editing code")!.click(); });
    await flush();
    expect(container.querySelector("select")).toBeNull();
  });
});

describe("callout type menu (20)", () => {
  const callout = "> [!NOTE]\n> See [[Target]] and [site](https://example.com)\n";
  const label = (root: HTMLElement) => root.querySelector<HTMLButtonElement>(".kh-callout-title button")!;
  const menu = () => document.querySelector<HTMLElement>(".kh-callout-menu")!;
  it("the label is a button that opens a menu of the five kinds, the current one checked", async () => {
    const { root } = await open(callout);
    expect(label(root).getAttribute("aria-haspopup")).toBe("menu");
    expect(document.querySelector(".kh-callout-menu")).toBeNull();
    label(root).click();
    expect(menu().hidden).toBe(false);
    expect(label(root).getAttribute("aria-expanded")).toBe("true");
    const rows = [...menu().querySelectorAll("button")];
    expect(rows.map(row => row.textContent)).toEqual(["Note", "Tip", "Important", "Warning", "Caution"]);
    expect(rows.map(row => row.getAttribute("aria-checked"))).toEqual(["true", "false", "false", "false", "false"]);
    expect(document.activeElement).toBe(rows[0]);
  });
  it.each(["Tip", "Important", "Warning", "Caution"])("choosing %s rewrites only the marker, and keeps the links", async (kind) => {
    const { root, editor } = await open(callout);
    label(root).click();
    [...menu().querySelectorAll("button")].find(row => row.textContent === kind)!.click();
    const markdown = editor.getMarkdown();
    expect(markdown).toContain(`[!${kind.toUpperCase()}]`);
    expect(markdown).not.toContain("NOTE");
    expect(markdown).toContain("See [[Target]] and [site](https://example.com)");
    expect(links(markdown)).toEqual(links(callout));
    expect(menu().hidden).toBe(true);
    expect(label(root).textContent).toBe(kind);
    const reopened = await open(markdown);
    expect(reopened.root.querySelector("blockquote")?.getAttribute("data-callout")).toBe(kind.toLowerCase());
    expect(calloutKind(`[!${kind.toUpperCase()}]`)).toBe(kind.toLowerCase());
  });
  it("is keyboard navigable: arrows move, Enter chooses, Escape closes it first and returns to the label", async () => {
    const { root, editor, view } = await open(callout);
    label(root).focus();
    label(root).dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
    expect(menu().hidden).toBe(false);
    const rows = [...menu().querySelectorAll("button")];
    const down = () => menu().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
    // The row in force is the target of the key, as in the browser.
    rows[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(rows[1]);
    rows[1].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true }));
    rows[0].dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(rows[4]);
    void down;
    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    rows[4].dispatchEvent(escape);
    expect(menu().hidden).toBe(true);
    expect(document.activeElement).toBe(label(root));
    // The block stays as it was: Escape closed the menu and nothing else.
    expect(view.state.selection.constructor.name).not.toBe("NodeSelection");
    expect(editor.getMarkdown()).toContain("NOTE");
  });
  it("one undo step puts the old kind back", async () => {
    const { root, editor, view } = await open(callout);
    label(root).click();
    [...menu().querySelectorAll("button")].find(row => row.textContent === "Warning")!.click();
    undo(view.state, view.dispatch);
    expect(editor.getMarkdown()).toContain("NOTE");
  });
});

// The 2026-11-17 code press must not swallow a control the rendered block itself draws (the source
// disclosure of a diagram, a link). Those are what the reader/editor code block already offers.
it("leaves a control inside the rendered code block alone", async () => {
  const markdown = "```mermaid\nflowchart LR\nA --> B\n```\n";
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  mounted.push(root);
  let ready!: (editor: MarkdownEditor) => void;
  const built = new Promise<MarkdownEditor>(resolve => { ready = resolve; });
  act(() => root.render(createElement(RenderedEditor, {
    workspaceId: "00000000-0000-4000-8000-000000000001", markdown, editable: true,
    renderCode: code => createElement("details", null, createElement("summary", null, "Source"), createElement("pre", null, code)),
    renderLanguage: (language, onChange) => createElement(CodeLanguageField, { language, onChange }),
    onReady: editor => ready(editor), onFail() {}, onUserEdit() {}, onMarkdown() {},
  })));
  await built;
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  const summary = container.querySelector("summary")!;
  act(() => { summary.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true })); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  expect(container.querySelector("select")).toBeNull();
});
