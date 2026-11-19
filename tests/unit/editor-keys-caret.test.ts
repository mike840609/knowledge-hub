// @vitest-environment jsdom
import { editorViewCtx } from "@milkdown/kit/core";
import { redo, undo } from "@milkdown/kit/prose/history";
import { AllSelection, TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { afterEach, expect, it } from "vitest";
import { createMarkdownEditor, type MarkdownEditor } from "@/components/knowledge/editor/editor-core";
import { EXIT_TOP, LEAVE_EDITOR } from "@/components/knowledge/editor/notion-keys";
import { slashCommands } from "@/components/knowledge/editor/slash-commands";

// docs/superpowers/specs/2026-11-19-editor-keys-caret-design.md, through the rendered editor.
const rect = { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 } as DOMRect;
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => rect;
const opened: MarkdownEditor[] = [];
afterEach(async () => { for (const editor of opened.splice(0)) await editor.destroy(); document.body.innerHTML = ""; });

async function open(markdown = "") {
  const root = document.body.appendChild(document.createElement("div"));
  root.setAttribute("data-tab-stays", "");
  const slash = slashCommands();
  const editor = await createMarkdownEditor({
    root, markdown, className: "kh-editor", ariaLabel: "Content", editable: true, onUserEdit: () => {}, onMarkdown: () => {}, allowImage: () => false,
    extraPlugins: slash.plugins, configure: slash.configure,
  });
  opened.push(editor);
  const view = editor.action(ctx => ctx.get(editorViewCtx));
  view.focus();
  return { editor, view };
}
function type(view: EditorView, text: string) {
  for (const character of text) {
    const { from, to } = view.state.selection;
    if (!view.someProp("handleTextInput", handler => handler(view, from, to, character, () => view.state.tr.insertText(character, from, to)))) {
      view.dispatch(view.state.tr.insertText(character, from, to));
    }
  }
}
const CODES: Record<string, number> = { Backspace: 8, Tab: 9, Enter: 13, ArrowUp: 38 };
function press(view: EditorView, key: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  Object.defineProperty(event, "keyCode", { value: CODES[key] ?? key.toUpperCase().charCodeAt(0) });
  view.dom.dispatchEvent(event);
  return event;
}
const caretAt = (view: EditorView, pos: number) => view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)));
const md = (editor: MarkdownEditor) => editor.getMarkdown().trim();

it.each([
  ["4", "- [ ] one"],
  ["5", "- one"],
  ["6", "1. one"],
  ["8", "```\none\n```"],
])("Mod-Alt-%s turns the line into Notion's block", async (digit, expected) => {
  const { editor, view } = await open("one");
  caretAt(view, 2);
  expect(press(view, digit, { ctrlKey: true, altKey: true }).defaultPrevented).toBe(true);
  expect(md(editor)).toBe(expected);
});

it.each([
  ["alpha", "4", "- [ ] alpha!"],
  ["- alpha", "5", "alpha!"],
  ["- alpha", "4", "- [ ] alpha!"],
])("separates typing from the list shortcut on %s through undo and redo", async (source, digit, turned) => {
  const { editor, view } = await open(source);
  caretAfter(view, "alpha");
  type(view, "!");
  press(view, digit, { ctrlKey: true, altKey: true });
  expect(md(editor)).toBe(turned);
  type(view, "?");
  for (const expected of [turned, source + "!", source]) {
    expect(undo(view.state, view.dispatch)).toBe(true);
    expect(md(editor)).toBe(expected);
  }
  for (const expected of [source + "!", turned, turned + "?"]) {
    expect(redo(view.state, view.dispatch)).toBe(true);
    expect(md(editor)).toBe(expected);
  }
});

it("keeps the active end of a backward text selection when turning a bullet into a task", async () => {
  const { view } = await open("- alpha\n- beta\n- gamma");
  caretAfter(view, "beta");
  const end = view.state.selection.head;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, end, end - 3)));
  press(view, "4", { ctrlKey: true, altKey: true });
  const { selection, doc } = view.state;
  expect(doc.textBetween(selection.from, selection.to)).toBe("eta");
  expect(selection.head).toBe(selection.from);
});

it.each([
  ["- alpha", "## alpha"],
  ["- alpha\n- beta\n- gamma", "## alpha\n\n## beta\n\n## gamma"],
])("turns the entire list after selecting all in %s", async (source, turned) => {
  const { editor, view } = await open(source);
  caretAfter(view, "alpha");
  press(view, "a", { ctrlKey: true });
  press(view, "a", { ctrlKey: true });
  expect(view.state.selection).toBeInstanceOf(AllSelection);
  press(view, "2", { ctrlKey: true, altKey: true });
  expect(md(editor)).toBe(turned);
  expect(view.state.selection).toBeInstanceOf(AllSelection);
});

it("Mod-Alt-7 makes the line a toggle", async () => {
  const { view } = await open("one");
  caretAt(view, 2);
  press(view, "7", { ctrlKey: true, altKey: true });
  expect(view.state.doc.firstChild!.type.name).toBe("details");
});

it.each([
  ["a quote", "> xx", 3],
  ["a callout", "> [!NOTE]\n> xx", 3],
])("Mod-Alt-7 in %s changes nothing, never falling through to Milkdown's numbered list", async (_name, markdown, at) => {
  const { editor, view } = await open(markdown);
  const before = md(editor);
  caretAt(view, at);
  expect(press(view, "7", { ctrlKey: true, altKey: true }).defaultPrevented).toBe(true);
  expect(md(editor)).toBe(before);
  // Mod-Alt-8 turns the whole quote into code, as the block menu does; never into a bulleted list.
  press(view, "8", { ctrlKey: true, altKey: true });
  expect(md(editor)).toMatch(/^```/);
});

// 2026-11-21 list commands spec, decision 7: in a list item, Mod-Alt-0…3 turn the item as the grip does. Milkdown's
// own keys would set the item's line to a heading, which an item cannot start with, and did nothing.
it.each([
  ["0", "- a\n\nb\n\n- c"],
  ["1", "- a\n\n# b\n\n- c"],
  ["2", "- a\n\n## b\n\n- c"],
  ["3", "- a\n\n### b\n\n- c"],
])("Mod-Alt-%s in a list item turns the item, splitting its list", async (digit, expected) => {
  const { editor, view } = await open("- a\n- b\n- c");
  caretAt(view, 9);
  expect(view.state.selection.$from.parent.type.name).toBe("paragraph");
  expect(view.state.selection.$from.parent.textContent).toBe("b");
  expect(press(view, digit, { ctrlKey: true, altKey: true }).defaultPrevented).toBe(true);
  expect(md(editor)).toBe(expected);
  press(view, "z", { ctrlKey: true });
  expect(md(editor)).toBe("- a\n- b\n- c");
});

it("Mod-Alt-2 across two list items turns both, as the toolbar does", async () => {
  const { editor, view } = await open("- one\n- two\n- three");
  let first = -1;
  let second = -1;
  view.state.doc.descendants((node, pos) => {
    if (node.isText && node.text === "one") first = pos;
    if (node.isText && node.text === "two") second = pos;
  });
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, first, second + 3)));
  expect(press(view, "2", { ctrlKey: true, altKey: true }).defaultPrevented).toBe(true);
  expect(md(editor)).toBe("## one\n\n## two\n\n- three");
  press(view, "z", { ctrlKey: true });
  expect(md(editor)).toBe("- one\n- two\n- three");
});

it("one undo after a cross-item turn keeps typing made before it", async () => {
  const { editor, view } = await open("- one\n- two");
  caretAfter(view, "two");
  type(view, "!");
  let first = -1;
  let second = -1;
  view.state.doc.descendants((node, pos) => {
    if (node.isText && node.text === "one") first = pos;
    if (node.isText && node.text === "two!") second = pos;
  });
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, first, second + 4)));
  press(view, "2", { ctrlKey: true, altKey: true });
  expect(md(editor)).toBe("## one\n\n## two!");
  press(view, "z", { ctrlKey: true });
  expect(md(editor)).toBe("- one\n- two!");
});

it("one undo after typing right after a cross-item turn keeps the turn", async () => {
  const { editor, view } = await open("- one\n- two\n- three");
  let first = -1;
  let second = -1;
  view.state.doc.descendants((node, pos) => {
    if (node.isText && node.text === "one") first = pos;
    if (node.isText && node.text === "two") second = pos;
  });
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, first, second + 3)));
  press(view, "2", { ctrlKey: true, altKey: true });
  type(view, "Z");
  press(view, "z", { ctrlKey: true });
  expect(md(editor)).toBe("## one\n\n## two\n\n- three");
});

it.each([
  ["a paragraph before the list", "P\n\n- one\n- two", "P", "one", "## P\n\n## one\n\n- two"],
  ["a paragraph after the list", "- one\n- two\n\nP", "two", "P", "- one\n\n## two\n\n## P"],
])("Mod-Alt-2 across %s turns both blocks from either side of the list", async (_name, source, firstText, lastText, expected) => {
  const { editor, view } = await open(source);
  let first = -1;
  let last = -1;
  view.state.doc.descendants((node, pos) => {
    if (node.isText && node.text === firstText) first = pos;
    if (node.isText && node.text === lastText) last = pos + lastText.length;
  });
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, first, last)));
  expect(press(view, "2", { ctrlKey: true, altKey: true }).defaultPrevented).toBe(true);
  expect(md(editor)).toBe(expected);
});

/** The caret after the first occurrence of `text`. */
function caretAfter(view: EditorView, text: string) {
  let at = -1;
  view.state.doc.descendants((node, pos) => {
    if (at < 0 && node.isText && node.text!.includes(text)) at = pos + node.text!.indexOf(text) + text.length;
    return at < 0;
  });
  expect(at, `"${text}" is in the document`).toBeGreaterThanOrEqual(0);
  caretAt(view, at);
}

// Only an item's first line is the item's: the turn keys claim it there, and one Mod-z takes the turn back.
it.each([
  ["a to-do item", "- [ ] a\n- [ ] b\n- [ ] c", "b", "1", "- [ ] a\n\n# b\n\n- [ ] c"],
  ["a numbered item", "1. a\n2. b\n3. c", "b", "3", "1. a\n\n### b\n\n3. c"],
  ["an item in a quote, which turns inside the quote", "> - a\n> - b", "b", "2", "> - a\n>\n> ## b"],
])("Mod-Alt-n on the first line of %s turns the item, in one undo step", async (_name, source, text, digit, expected) => {
  const { editor, view } = await open(source);
  caretAfter(view, text);
  expect(press(view, digit, { ctrlKey: true, altKey: true }).defaultPrevented).toBe(true);
  expect(md(editor)).toBe(expected);
  press(view, "z", { ctrlKey: true });
  expect(md(editor)).toBe(source);
});

it("Mod-Alt-2 on an item with a nested list is claimed and changes nothing, as the grip refuses it", async () => {
  const { editor, view } = await open("- a\n  - b\n- c");
  caretAfter(view, "a");
  expect(press(view, "2", { ctrlKey: true, altKey: true }).defaultPrevented).toBe(true);
  expect(md(editor)).toBe("- a\n  - b\n- c");
});

// Past the item's first line the keys stay Milkdown's, as before the list commands spec.
it.each([
  ["a loose item's second paragraph", "- a\n\n  second", "second", "2", "- a\n\n  ## second"],
  ["a code block in an item, to text", "- a\n\n  ```\n  x\n  ```", "x", "0", "- a\n\n  x"],
  ["a code block in an item, to a heading", "- a\n\n  ```\n  x\n  ```", "x", "2", "- a\n\n  ## x"],
])("Mod-Alt-n in %s stays Milkdown's, in one undo step", async (_name, source, text, digit, expected) => {
  const { editor, view } = await open(source);
  caretAfter(view, text);
  press(view, digit, { ctrlKey: true, altKey: true });
  expect(md(editor)).toBe(expected);
  press(view, "z", { ctrlKey: true });
  expect(md(editor)).toBe(source);
});

it("Mod-Alt-2 outside a list item stays Milkdown's: a paragraph in a quote becomes a heading in the quote", async () => {
  const { editor, view } = await open("one\n\n> two");
  caretAt(view, 2);
  press(view, "2", { ctrlKey: true, altKey: true });
  expect(md(editor)).toBe("## one\n\n> two");
  caretAt(view, view.state.doc.content.size - 2);
  press(view, "2", { ctrlKey: true, altKey: true });
  expect(md(editor)).toBe("## one\n\n> ## two");
});

it("Mod-Enter in a to-do outside the document page (the composer) leaves it to save, unticked", async () => {
  const { editor, view } = await open("* [ ] task");
  view.dom.closest("[data-tab-stays]")!.removeAttribute("data-tab-stays");
  caretAt(view, 4);
  press(view, "Enter", { ctrlKey: true });
  expect(md(editor)).toBe("- [ ] task");
});

it("says how to leave the editor where Tab stays in it, and only there", async () => {
  const { editor, view } = await open("one");
  // Said once, even after whole-document replaces (leaving source view) make the plugin views again.
  editor.replaceMarkdown("two");
  editor.replaceMarkdown("three");
  expect(view.dom.getAttribute("aria-description")!.split(LEAVE_EDITOR).length - 1).toBe(1);
  const elsewhere = document.body.appendChild(document.createElement("div"));
  const plain = await createMarkdownEditor({
    root: elsewhere, markdown: "one", className: "kh-editor", ariaLabel: "Content", editable: true, onUserEdit: () => {}, onMarkdown: () => {}, allowImage: () => false,
  });
  opened.push(plain);
  expect(plain.action(ctx => ctx.get(editorViewCtx)).dom.getAttribute("aria-description") ?? "").not.toContain(LEAVE_EDITOR);
});

it("Mod-Enter ticks a to-do and unticks it", async () => {
  const { editor, view } = await open("* [ ] task");
  caretAt(view, 4);
  press(view, "Enter", { ctrlKey: true });
  expect(md(editor)).toBe("- [x] task");
  press(view, "Enter", { ctrlKey: true });
  expect(md(editor)).toBe("- [ ] task");
});

it("Tab in a paragraph stays in the editor and writes nothing; in a list it still indents", async () => {
  const { editor, view } = await open("one\n\n- a\n- b");
  caretAt(view, 2);
  expect(press(view, "Tab").defaultPrevented).toBe(true);
  expect(press(view, "Tab", { shiftKey: true }).defaultPrevented).toBe(true);
  expect(md(editor)).toBe("one\n\n- a\n- b");
  // Selected text keeps Tab for the formatting toolbar.
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 3)));
  expect(press(view, "Tab").defaultPrevented).toBe(false);
  caretAt(view, 2);
  // Escape chooses the block; Tab then goes on to the page, which is how a keyboard user leaves.
  press(view, "Escape");
  expect(press(view, "Tab").defaultPrevented).toBe(false);
  let second = -1;
  view.state.doc.descendants((node, pos) => { if (node.isText && node.text === "b") second = pos; });
  caretAt(view, second);
  press(view, "Tab");
  expect(md(editor)).toBe("one\n\n- a\n  - b");
});

it("Backspace in an empty first paragraph leads to the title when claimed, and the paragraph goes", async () => {
  const { editor, view } = await open("\n\nsecond");
  view.dispatch(view.state.tr.insert(0, view.state.schema.nodes.paragraph.create()));
  caretAt(view, 1);
  let fired = 0;
  view.dom.addEventListener(EXIT_TOP, event => { fired++; event.preventDefault(); });
  caretAt(view, 1);
  expect(press(view, "Backspace").defaultPrevented).toBe(true);
  expect(fired).toBe(1);
  expect(md(editor)).toBe("second");
});

it("Backspace at the start of a top-level list's first item makes it a paragraph before the list", async () => {
  const { editor, view } = await open("intro\n\n* a\n* b");
  let at = -1;
  view.state.doc.descendants((node, pos) => { if (node.isText && node.text === "a") at = pos; });
  caretAt(view, at);
  press(view, "Backspace");
  expect(md(editor)).toBe("intro\n\na\n\n- b");
  const { editor: lone, view: loneView } = await open("* only");
  caretAt(loneView, 3);
  press(loneView, "Backspace");
  expect(md(lone)).toBe("only");
});

it("continues a handed-over Markdown body in its last paragraph", async () => {
  const { editor, view } = await open();
  editor.replaceMarkdown("Visit [[Plan]]\n\nWrite ", true);
  editor.focusEnd(false);
  type(view, "more");
  expect(view.state.doc.childCount).toBe(2);
  expect(view.state.doc.lastChild?.textContent).toBe("Write more");
  expect(editor.getMarkdown()).toContain("[[Plan]]");
});

it("continues in a new paragraph after a handed-over return", async () => {
  const { editor, view } = await open();
  editor.replaceMarkdown("First line\n", true);
  editor.focusEnd(false);
  type(view, "Next line");
  expect(editor.getMarkdown()).toBe("First line\n\nNext line\n");
});

it("focusEnd adds an empty paragraph after the last block, once", async () => {
  const { editor, view } = await open("# Title\n\n* a");
  editor.focusEnd();
  expect(view.state.doc.lastChild!.type.name).toBe("paragraph");
  expect(view.state.doc.lastChild!.content.size).toBe(0);
  const count = view.state.doc.childCount;
  editor.focusEnd();
  expect(view.state.doc.childCount).toBe(count);
  expect(view.state.selection.from).toBe(view.state.doc.content.size - 1);
});

it("a / after a space mid-line opens the list; choosing takes /query out and adds the block below", async () => {
  const { editor, view } = await open("");
  type(view, "some text /h2");
  expect(document.querySelector(".kh-slash-menu")?.hasAttribute("hidden")).toBe(false);
  press(view, "Enter");
  expect(md(editor)).toBe("some text \n\n##");
  expect(view.state.selection.$from.parent.type.name).toBe("heading");
});

it("a mid-line / without a space before it, or a query nothing matches, opens nothing", async () => {
  const { view } = await open("");
  type(view, "and/or");
  expect(document.querySelector(".kh-slash-menu")?.hasAttribute("hidden")).toBe(true);
  type(view, " /usr");
  expect(document.querySelector(".kh-slash-menu")?.hasAttribute("hidden")).toBe(true);
});

it("a mid-line / Page link writes [[ in place", async () => {
  const { editor, view } = await open("");
  type(view, "see /page");
  press(view, "Enter");
  expect(view.state.doc.firstChild!.textContent).toBe("see [[");
  expect(md(editor)).toBe("see \\[\\[");
});

it("Tab is the page's to claim: outside data-tab-stays it goes on to the next control", async () => {
  const { view } = await open("one");
  view.dom.closest("[data-tab-stays]")!.removeAttribute("data-tab-stays");
  caretAt(view, 2);
  expect(press(view, "Tab").defaultPrevented).toBe(false);
});
