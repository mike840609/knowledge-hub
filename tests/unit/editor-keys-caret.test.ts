// @vitest-environment jsdom
import { editorViewCtx } from "@milkdown/kit/core";
import { TextSelection } from "@milkdown/kit/prose/state";
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
