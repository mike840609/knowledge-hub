// @vitest-environment jsdom
import { editorViewCtx } from "@milkdown/kit/core";
import { NodeSelection, TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { afterEach, expect, it, vi } from "vitest";
import { headingSlugAt } from "@/components/knowledge/editor/block-gutter";
import { extractOutline } from "@/shared/markdown/outline";
import { createMarkdownEditor, type MarkdownEditor } from "@/components/knowledge/editor/editor-core";
import { EXIT_TOP } from "@/components/knowledge/editor/notion-keys";
import { slashCommands } from "@/components/knowledge/editor/slash-commands";

// docs/superpowers/specs/2026-11-20-small-keys-design.md, through the rendered editor.
const rect = { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 } as DOMRect;
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => rect;
const opened: MarkdownEditor[] = [];
afterEach(async () => { for (const editor of opened.splice(0)) await editor.destroy(); document.body.innerHTML = ""; });

async function open(markdown = "", onUserEdit: () => void = () => {}) {
  const root = document.body.appendChild(document.createElement("div"));
  root.setAttribute("data-tab-stays", "");
  const slash = slashCommands();
  const editor = await createMarkdownEditor({
    root, markdown, className: "kh-editor", ariaLabel: "Content", editable: true, onUserEdit, onMarkdown: () => {}, allowImage: () => false,
    extraPlugins: slash.plugins, configure: slash.configure,
  });
  opened.push(editor);
  const view = editor.action(ctx => ctx.get(editorViewCtx));
  view.focus();
  return { editor, view, root };
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
// Any open editor in the test has a menu of its own.
const menuOpen = () => [...document.querySelectorAll(".kh-slash-menu")].some(menu => !menu.hasAttribute("hidden"));
/** Counts the times the editor fires its exit-to-title event, and claims each one as the page does. */
function watchExit(view: EditorView) {
  const seen = vi.fn((event: Event) => event.preventDefault());
  view.dom.addEventListener(EXIT_TOP, seen);
  return seen;
}

it("Mod-Enter in a toggle's title opens and closes it, and in its body does nothing to it", async () => {
  const { view } = await open("<details>\n<summary>Title</summary>\n\nBody\n\n</details>");
  const details = () => view.state.doc.firstChild!;
  expect(details().attrs.open).toBeFalsy();
  caretAt(view, 3);
  expect(view.state.selection.$from.parent.type.name).toBe("details_summary");
  expect(press(view, "Enter", { ctrlKey: true }).defaultPrevented).toBe(true);
  expect(details().attrs.open).toBe(true);
  press(view, "Enter", { ctrlKey: true });
  expect(details().attrs.open).toBeFalsy();
  press(view, "Enter", { ctrlKey: true });
  const body = details().lastChild!;
  caretAt(view, 1 + details().firstChild!.nodeSize + 2);
  expect(view.state.selection.$from.node(-1)).toBe(body);
  press(view, "Enter", { ctrlKey: true });
  expect(details().attrs.open).toBe(true);
});

it("Mod-Enter still ticks a to-do, and does nothing in plain text", async () => {
  const { editor, view } = await open("- [ ] one\n\ntext");
  caretAt(view, 4);
  press(view, "Enter", { ctrlKey: true });
  expect(md(editor)).toContain("- [x] one");
  press(view, "Enter", { ctrlKey: true });
  expect(md(editor)).toContain("- [ ] one");
});

it("Shift-Tab in the first line of the document goes to the title, and elsewhere only stays in the text", async () => {
  const { view } = await open("one\n\ntwo");
  const exit = watchExit(view);
  caretAt(view, 2);
  expect(press(view, "Tab", { shiftKey: true }).defaultPrevented).toBe(true);
  expect(exit).toHaveBeenCalledTimes(1);
  caretAt(view, 7);
  expect(press(view, "Tab", { shiftKey: true }).defaultPrevented).toBe(true);
  expect(exit).toHaveBeenCalledTimes(1);
  // Plain Tab never leaves.
  caretAt(view, 2);
  press(view, "Tab");
  expect(exit).toHaveBeenCalledTimes(1);
});

it("ArrowUp from a divider that opens the document goes to the title", async () => {
  const { view } = await open("---\n\ntext");
  const exit = watchExit(view);
  expect(view.state.doc.firstChild!.type.name).toBe("hr");
  view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, 0)));
  press(view, "ArrowUp");
  expect(exit).toHaveBeenCalledTimes(1);
  // A divider further down is an ordinary block.
  const { view: second } = await open("text\n\n---\n\nmore");
  const other = watchExit(second);
  second.dispatch(second.state.tr.setSelection(NodeSelection.create(second.state.doc, second.state.doc.firstChild!.nodeSize)));
  press(second, "ArrowUp");
  expect(other).not.toHaveBeenCalled();
});

it("a / after bold text or a wikilink opens the list", async () => {
  const { view } = await open("");
  type(view, "plain ");
  view.dispatch(view.state.tr.addStoredMark(view.state.schema.marks.strong.create()));
  type(view, "bold /h");
  expect(view.state.doc.firstChild!.lastChild!.marks.length).toBeGreaterThan(0);
  expect(menuOpen()).toBe(true);
  const { view: linked } = await open("see [[Page]] ");
  caretAt(linked, linked.state.doc.firstChild!.content.size + 1);
  type(linked, "/h");
  expect(menuOpen()).toBe(true);
});

it("a / straight after a word, bold or not, opens nothing", async () => {
  const { view } = await open("");
  view.dispatch(view.state.tr.addStoredMark(view.state.schema.marks.strong.create()));
  type(view, "and/or");
  expect(menuOpen()).toBe(false);
});

it("choosing from a / after bold text takes /query out and adds the block below", async () => {
  const { editor, view } = await open("");
  view.dispatch(view.state.tr.addStoredMark(view.state.schema.marks.strong.create()));
  type(view, "bold /quo");
  press(view, "Enter");
  expect(view.state.doc.childCount).toBe(2);
  expect(view.state.doc.firstChild!.textContent).toBe("bold ");
  expect(view.state.doc.lastChild!.type.name).toBe("blockquote");
  expect(md(editor)).toContain("**bold**");
});

it("/diagram writes a mermaid block", async () => {
  const { editor, view } = await open("");
  type(view, "/diagram");
  press(view, "Enter");
  expect(md(editor)).toBe("```mermaid\nflowchart TD\n  A[Start] --> B[Done]\n```");
});

it("/date writes today's date in place, alone on a line or mid-line", async () => {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const { editor, view } = await open("");
  type(view, "/date");
  press(view, "Enter");
  expect(md(editor)).toBe(today);
  const { editor: second, view: line } = await open("");
  type(line, "met on /today");
  press(line, "Enter");
  expect(md(second)).toBe(`met on ${today}`);
});

it("a press below the text puts the caret at the end without counting as an edit", async () => {
  const onUserEdit = vi.fn();
  const { editor, view } = await open("- one\n- two", onUserEdit);
  editor.focusEnd();
  expect(view.state.doc.lastChild!.type.name).toBe("paragraph");
  expect(view.state.selection.from).toBe(view.state.doc.content.size - 1);
  expect(onUserEdit).not.toHaveBeenCalled();
  type(view, "x");
  expect(onUserEdit).toHaveBeenCalled();
});

it("headingSlugAt hands out the slugs the reader does, repeats included", async () => {
  const { view } = await open("# Setup\n\ntext\n\n## Setup\n\n> ### 請假 流程\n");
  const positions: number[] = [];
  view.state.doc.descendants((node, pos) => { if (node.type.name === "heading") positions.push(pos); return true; });
  expect(positions.map(pos => headingSlugAt(view, pos))).toEqual(["setup", "setup-1", "請假-流程"]);
  expect(headingSlugAt(view, 1)).toBeNull();
});

it("headingSlugAt agrees with the reader for headings holding a wikilink, an image or a line break", async () => {
  const markdown = "# Setup\n\n## See [[Page]]\n\n## Img ![alt text](x.png) end\n\n## Setup\n\n## Two\\\nlines\n";
  const { view } = await open(markdown);
  const positions: number[] = [];
  view.state.doc.descendants((node, pos) => { if (node.type.name === "heading") positions.push(pos); return true; });
  const reader = extractOutline(markdown).map(entry => entry.slug);
  expect(positions.map(pos => headingSlugAt(view, pos))).toEqual(reader);
  expect(reader).toContain("see-page");
  expect(reader).toContain("setup-1");
});

it("a / inside inline code or link text opens nothing, and one after them still does", async () => {
  const { view } = await open("`ls`");
  const end = view.state.doc.firstChild!.content.size + 1;
  caretAt(view, end - 1);
  type(view, " /t");
  expect(menuOpen()).toBe(false);
  const linked = await open("[the guide](https://example.com)");
  caretAt(linked.view, linked.view.state.doc.firstChild!.content.size);
  type(linked.view, " /t");
  expect(menuOpen()).toBe(false);
  // After the code, in plain text, the list opens as it did.
  const after = await open("`ls`");
  caretAt(after.view, after.view.state.doc.firstChild!.content.size + 1);
  after.view.dispatch(after.view.state.tr.setStoredMarks([]));
  type(after.view, " /t");
  expect(menuOpen()).toBe(true);
});

it("choosing from a / after a wikilink keeps the link in the saved Markdown, with and without a space", async () => {
  const { editor, view } = await open("see [[Page]]");
  caretAt(view, view.state.doc.firstChild!.content.size + 1);
  type(view, "/quo");
  press(view, "Enter");
  expect(md(editor)).toContain("see [[Page]]");
  const { editor: spaced, view: second } = await open("see [[Page]] ");
  caretAt(second, second.state.doc.firstChild!.content.size + 1);
  type(second, "/quo");
  press(second, "Enter");
  expect(md(spaced)).toContain("see [[Page]]");
});

it("Mod-Enter closing a toggle from its title keeps the caret where it was", async () => {
  const { view } = await open("<details open>\n<summary>Title here</summary>\n\nBody\n\n</details>");
  caretAt(view, 8);
  press(view, "Enter", { ctrlKey: true });
  expect(view.state.doc.firstChild!.attrs.open).toBeFalsy();
  expect(view.state.selection.from).toBe(8);
});

it("Shift-Tab does not leave the editor from a list, a table or code in the first block", async () => {
  for (const markdown of ["- one", "| a | b |\n| - | - |\n| x | y |", "```\ncode\n```"]) {
    const { view } = await open(markdown);
    const exit = watchExit(view);
    view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(3))));
    press(view, "Tab", { shiftKey: true });
    expect(exit).not.toHaveBeenCalled();
  }
});
