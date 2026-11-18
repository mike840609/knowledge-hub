// @vitest-environment jsdom
import { editorViewCtx } from "@milkdown/kit/core";
import { undo } from "@milkdown/kit/prose/history";
import { NodeSelection, TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMarkdownEditor, type MarkdownEditor } from "@/components/knowledge/editor/editor-core";
import { slashCommands } from "@/components/knowledge/editor/slash-commands";
import { wikiLinkSuggest } from "@/components/knowledge/editor/wikilink-suggest";
import { extractDocumentLinks } from "@/modules/knowledge/domain/document-links";
import { LINK_MARKDOWN_FIXTURES } from "../fixtures/link-markdown";

const rect = { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 } as DOMRect;
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => rect;
const opened: MarkdownEditor[] = [];
afterEach(async () => { for (const editor of opened.splice(0)) await editor.destroy(); document.body.innerHTML = ""; });

async function open(markdown = "", withSlash = false) {
  const root = document.body.appendChild(document.createElement("div"));
  const slash = slashCommands();
  const editor = await createMarkdownEditor({
    root, markdown, className: "kh-editor", ariaLabel: "Content", editable: true, onUserEdit: () => {}, onMarkdown: () => {}, allowImage: () => false,
    ...(withSlash ? { extraPlugins: slash.plugins, configure: slash.configure } : {}),
  });
  opened.push(editor);
  const view = editor.action(ctx => ctx.get(editorViewCtx));
  view.focus();
  return { editor, view };
}

/** Typing one character at a time, the way the browser reports it: input rules see each one before it lands. */
function type(view: EditorView, text: string) {
  for (const character of text) {
    const { from, to } = view.state.selection;
    if (!view.someProp("handleTextInput", handler => handler(view, from, to, character, () => view.state.tr.insertText(character, from, to)))) {
      view.dispatch(view.state.tr.insertText(character, from, to));
    }
  }
}

const CODES: Record<string, number> = { Tab: 9, Backspace: 8, Escape: 27, ArrowUp: 38, ArrowDown: 40, "7": 55, "8": 56, "9": 57, s: 83, a: 65, d: 68, "&": 55, "*": 56, "(": 57 };
/** A keydown with the keyCode a browser reports; `ctrl` stands for Mod (jsdom is not a Mac). */
function press(view: EditorView, key: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  Object.defineProperty(event, "keyCode", { value: CODES[key] ?? key.toUpperCase().charCodeAt(0) });
  view.dom.dispatchEvent(event);
  return event;
}
const mod = (view: EditorView, key: string, extra: KeyboardEventInit = {}) => press(view, key, { ctrlKey: true, ...extra });
const chooseList = (view: EditorView, pos = 0) => view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
const caretAt = (view: EditorView, pos: number) => view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)));
function findText(view: EditorView, text: string) {
  let at = -1;
  view.state.doc.descendants((node, pos) => { if (at < 0 && node.isText && node.text!.includes(text)) at = pos + node.text!.indexOf(text); });
  return at;
}
const names = (view: EditorView) => { const found: string[] = []; view.state.doc.forEach(node => found.push(node.type.name)); return found; };

it.each(["**bold** x", "*it* x", "_it_ x", "`co` x", "~~st~~ x", "~st~ x"])("ends a mark made by an input rule at its closing delimiter: %s", async (typed) => {
  const { editor, view } = await open("");
  type(view, typed);
  const paragraph = view.state.doc.firstChild!;
  expect(paragraph.childCount).toBe(2);
  expect(paragraph.firstChild!.marks).toHaveLength(1);
  expect(paragraph.lastChild!.text).toBe(" x");
  expect(paragraph.lastChild!.marks).toHaveLength(0);
  expect(editor.getMarkdown().trim()).toMatch(/^(\*\*bold\*\*|\*it\*|_it_|`co`|~~st~~) x$/);
});

// A browser re-reports the caret after the rule runs, and ProseMirror drops the stored marks when a
// selection is set: the next character then inherits the mark. This is that, without the browser.
it.each(["**bold** x", "`co` x", "~~st~~ x"])("ends a mark even when the selection is set again before the next character: %s", async (typed) => {
  const { view } = await open("");
  const [marked, ...rest] = typed.split(" ");
  type(view, marked);
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, view.state.selection.from)));
  type(view, ` ${rest.join(" ")}`);
  const paragraph = view.state.doc.firstChild!;
  expect(paragraph.lastChild!.text).toBe(" x");
  expect(paragraph.lastChild!.marks).toHaveLength(0);
});

it("lets a mark carry on when the caret moved away and back", async () => {
  const { view } = await open("");
  type(view, "**bold**");
  caretAt(view, 2);
  caretAt(view, 5);
  type(view, "y");
  expect(view.state.doc.firstChild!.firstChild!.text).toBe("boldy");
});

it("keeps a mark the writer turned on with Mod-b right after a rule", async () => {
  const { view } = await open("");
  type(view, "**bold**");
  mod(view, "b");
  type(view, "z");
  // Still one bold run: the writer asked for the mark again, and gets it.
  expect(view.state.doc.firstChild!.childCount).toBe(1);
  expect(view.state.doc.firstChild!.firstChild!.text).toBe("boldz");
});

it.each([["[] ", false], ["[ ] ", false], ["[x] ", true]])("turns %j at the start of a paragraph into a to-do item", async (typed, checked) => {
  const { editor, view } = await open("");
  type(view, typed + "Task");
  expect(view.state.doc.firstChild?.type.name).toBe("bullet_list");
  expect(view.state.doc.firstChild?.firstChild?.attrs.checked).toBe(checked);
  expect(editor.getMarkdown().trim()).toBe(`- [${checked ? "x" : " "}] Task`);
});

it("does not make a to-do item of [] typed after other text", async () => {
  const { view } = await open("");
  type(view, "a [] ");
  expect(names(view)).toEqual(["paragraph"]);
});

it.each([["->", "→"], ["<-", "←"], ["(c)", "©"], ["(r)", "®"], ["(tm)", "™"]])("replaces %s with %s and one Backspace restores it", async (typed, symbol) => {
  const { view } = await open("");
  type(view, `a ${typed}`);
  expect(view.state.doc.textContent).toBe(`a ${symbol}`);
  press(view, "Backspace");
  expect(view.state.doc.textContent).toBe(`a ${typed}`);
});

it("leaves a [[target]] being typed as written", async () => {
  const { view } = await open("");
  type(view, "see [[A->B (c)");
  expect(view.state.doc.textContent).toBe("see [[A->B (c)");
});

it("still replaces after a stray [[ further back than the [[ list looks (MAX_QUERY_LENGTH)", async () => {
  const { view } = await open("");
  const prose = `type [[ to link, ${"and so on ".repeat(11)}then a `;
  type(view, `${prose}-> b`);
  expect(view.state.doc.textContent).toBe(`${prose}→ b`);
});

it.each([["# Head", "bullet_list", "- Head"], ["- a\n- b", "ordered_list", "1. a\n2. b"]])("Mod-Shift-%s chosen with Escape is turned into a list", async (markdown, type_, expected) => {
  const { editor, view } = await open(markdown);
  view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, 0)));
  mod(view, type_ === "ordered_list" ? "&" : "*", { shiftKey: true });
  expect(view.state.doc.firstChild?.type.name).toBe(type_);
  expect(editor.getMarkdown().trim()).toBe(expected);
});

it("leaves -- alone so that --- still makes a divider, and does not replace in code", async () => {
  const { view } = await open("");
  type(view, "a -- b");
  expect(view.state.doc.textContent).toBe("a -- b");
  const code = await open("```\n\n```");
  caretAt(code.view, 1);
  type(code.view, "-> (c)");
  expect(code.view.state.doc.textContent).toBe("-> (c)");
});

it("does not replace -> typed inside inline code", async () => {
  const { view } = await open("`ab`");
  caretAt(view, 2);
  type(view, "->");
  expect(view.state.doc.textContent).toBe("a->b");
});

it.each(["h1", "h3", "h6"])("Backspace at the start of a %s makes a paragraph in one press", async (kind) => {
  const level = Number(kind.slice(1));
  const { editor, view } = await open(`${"#".repeat(level)} Title\n\nBody`);
  caretAt(view, 1);
  press(view, "Backspace");
  expect(names(view)).toEqual(["paragraph", "paragraph"]);
  expect(view.state.doc.firstChild?.textContent).toBe("Title");
  expect(editor.getMarkdown().trim()).toBe("Title\n\nBody");
});

it("Backspace in the middle of a heading still deletes a character", async () => {
  const { view } = await open("## Title");
  caretAt(view, 3);
  press(view, "Backspace");
  expect(view.state.doc.firstChild?.type.name).toBe("heading");
});

it("Mod-Shift-s toggles strikethrough on the selection", async () => {
  const { editor, view } = await open("word");
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 5)));
  mod(view, "S", { shiftKey: true });
  expect(editor.getMarkdown().trim()).toBe("~~word~~");
  mod(view, "S", { shiftKey: true });
  expect(editor.getMarkdown().trim()).toBe("word");
});

it.each([["&", "ordered_list", "1. one"], ["*", "bullet_list", "- one"], ["(", "bullet_list", "- [ ] one"]])("Mod-Shift-%s makes a list and a second press lifts the item back", async (key, type_, markdown) => {
  const { editor, view } = await open("one");
  caretAt(view, 2);
  mod(view, key, { shiftKey: true });
  expect(view.state.doc.firstChild?.type.name).toBe(type_);
  expect(editor.getMarkdown().trim()).toBe(markdown);
  mod(view, key, { shiftKey: true });
  expect(names(view)).toEqual(["paragraph"]);
  expect(view.state.doc.textContent).toBe("one");
});

it("Mod-Shift-8 on a numbered item changes it to a bulleted list", async () => {
  const { view } = await open("1. one");
  caretAt(view, 3);
  mod(view, "*", { shiftKey: true });
  expect(view.state.doc.firstChild?.type.name).toBe("bullet_list");
});

/** The document as nested names, text in parentheses: `bullet_list[list_item[paragraph(a)]]`. */
function shape(node: import("@milkdown/kit/prose/model").Node): string {
  if (node.isText) return `(${node.text})`;
  const inner = [] as string[];
  node.forEach(child => inner.push(shape(child)));
  return `${node.type.name}[${inner.join(" ")}]`;
}
const docShape = (view: EditorView) => { const found: string[] = []; view.state.doc.forEach(node => found.push(shape(node))); return found.join(" "); };
function posIn(view: EditorView, text: string) {
  let at = -1;
  view.state.doc.descendants((node, pos) => { if (node.isText && node.text === text) at = pos; });
  return at;
}
const edges = (markdown: string) => extractDocumentLinks(markdown).map(({ kind, target }) => `${kind}:${target}`).sort();

describe("Mod-Shift-7/8/9 on an item with nested items or siblings", () => {
  it("keeps the item's own sub-list under it, and leaves the siblings in their list", async () => {
    const { view } = await open("- a\n  - b\n- c");
    caretAt(view, posIn(view, "a") + 1);
    mod(view, "&", { shiftKey: true });
    expect(docShape(view)).toBe("ordered_list[list_item[paragraph[(a)] bullet_list[list_item[paragraph[(b)]]]]] bullet_list[list_item[paragraph[(c)]]]");
  });
  it("in a nested list changes that item only, so its next sibling does not become its child", async () => {
    const { view } = await open("- a\n  - b\n  - c\n- d");
    caretAt(view, posIn(view, "b") + 1);
    mod(view, "&", { shiftKey: true });
    expect(docShape(view)).toBe("bullet_list[list_item[paragraph[(a)] ordered_list[list_item[paragraph[(b)]]] bullet_list[list_item[paragraph[(c)]]]] list_item[paragraph[(d)]]]");
  });
  it("splits around a middle item and keeps the caret in it", async () => {
    const { view } = await open("- a\n- b\n- c");
    caretAt(view, posIn(view, "b") + 1);
    mod(view, "&", { shiftKey: true });
    type(view, "X");
    expect(docShape(view)).toBe("bullet_list[list_item[paragraph[(a)]]] ordered_list[list_item[paragraph[(bX)]]] bullet_list[list_item[paragraph[(c)]]]");
  });
  it("goes on numbering a numbered list after the item that left it", async () => {
    const { editor, view } = await open("1. a\n2. b\n3. c");
    caretAt(view, posIn(view, "b") + 1);
    mod(view, "*", { shiftKey: true });
    expect(editor.getMarkdown()).toMatch(/1\. a\n\n- b\n\n3\. c/);
  });
  it("is one undo step", async () => {
    const { view } = await open("- a\n  - b\n- c");
    const before = docShape(view);
    caretAt(view, posIn(view, "a") + 1);
    mod(view, "&", { shiftKey: true });
    undo(view.state, view.dispatch);
    expect(docShape(view)).toBe(before);
  });
  it("reads its links back after the change", async () => {
    const { editor, view } = await open("- see [[Target]] and [x](notes/other.md)\n  - [[Child]]\n- two\n");
    const wanted = edges(editor.getMarkdown());
    expect(wanted.length).toBeGreaterThan(2);
    caretAt(view, 2);
    mod(view, "&", { shiftKey: true });
    expect(edges(editor.getMarkdown())).toEqual(wanted);
  });
});

it("Mod-Shift-8 turns a heading into a bulleted list item, keeping the caret", async () => {
  const { view } = await open("# Title");
  caretAt(view, 4);
  mod(view, "*", { shiftKey: true });
  type(view, "X");
  expect(docShape(view)).toBe("bullet_list[list_item[paragraph[(TitXle)]]]");
});

it("the [] rule reads its links back", async () => {
  const { editor, view } = await open("see [[Target]] and [x](notes/other.md)\n");
  const wanted = edges(editor.getMarkdown());
  caretAt(view, 1);
  type(view, "[] ");
  expect(names(view)).toEqual(["bullet_list"]);
  expect(edges(editor.getMarkdown())).toEqual(wanted);
});

it("Mod-Shift-9 on a bulleted item makes it a to-do in the same list", async () => {
  const { editor, view } = await open("- one\n- two");
  caretAt(view, 4);
  mod(view, "(", { shiftKey: true });
  expect(names(view)).toEqual(["bullet_list"]);
  expect(editor.getMarkdown().trim()).toBe("- [ ] one\n- two");
});

it("Mod-Shift-8 keeps the caret where it was", async () => {
  const { view } = await open("hello world");
  caretAt(view, 6);
  mod(view, "*", { shiftKey: true });
  type(view, "X");
  expect(view.state.doc.textContent).toBe("helloX world");
});

it("Mod-Shift-8 in the middle of a numbered list changes that item only, and keeps the caret", async () => {
  const { view } = await open("1. one\n2. two\n3. three");
  let at = 0;
  view.state.doc.descendants((node, pos) => { if (node.isText && node.text === "two") at = pos; });
  caretAt(view, at + 1);
  mod(view, "*", { shiftKey: true });
  type(view, "X");
  expect(names(view)).toEqual(["ordered_list", "bullet_list", "ordered_list"]);
  expect(view.state.doc.textBetween(0, view.state.doc.content.size, "|")).toBe("one|tXwo|three");
});

it("Mod-Shift-ArrowUp/Down move the current block and Mod-d duplicates it", async () => {
  const { view } = await open("A\n\nB\n\nC");
  caretAt(view, 5);
  mod(view, "ArrowUp", { shiftKey: true });
  expect(view.state.doc.textBetween(0, view.state.doc.content.size, "|")).toBe("B|A|C");
  mod(view, "ArrowDown", { shiftKey: true });
  mod(view, "ArrowDown", { shiftKey: true });
  expect(view.state.doc.textBetween(0, view.state.doc.content.size, "|")).toBe("A|C|B");
  mod(view, "d");
  expect(view.state.doc.textBetween(0, view.state.doc.content.size, "|")).toBe("A|C|B|B");
});

it.each(LINK_MARKDOWN_FIXTURES)("keeps the links of a document when its blocks are moved and duplicated by key: $name", async ({ markdown, links: expected }) => {
  const { editor, view } = await open(`${markdown}\n\nAfter.\n`);
  const norm = (text: string) => extractDocumentLinks(text).map(({ kind, target, fragment, display }) => JSON.stringify({ kind, target, fragment, display })).sort();
  const wanted = expected.map(link => JSON.stringify(link)).sort();
  caretAt(view, 1);
  mod(view, "ArrowDown", { shiftKey: true });
  expect(norm(editor.getMarkdown())).toEqual(wanted);
  mod(view, "d");
  // The copy adds the first block's links again; none is lost.
  expect([...new Set(norm(editor.getMarkdown()))]).toEqual([...new Set(wanted)]);
  expect(norm(editor.getMarkdown()).length).toBeGreaterThanOrEqual(wanted.length);
});

it("Escape selects the current top-level block, again returns to the text, Backspace removes it, typing replaces it", async () => {
  const { view } = await open("- one\n  - two\n\nTail");
  caretAt(view, 12);
  // The caret in a list item: Escape chooses the item (the whole list is chosen by selecting it, as a click on its grip does).
  expect((press(view, "Escape").defaultPrevented)).toBe(true);
  expect((view.state.selection as NodeSelection).node.type.name).toBe("list_item");
  chooseList(view);
  expect(view.state.selection).toBeInstanceOf(NodeSelection);
  expect(view.state.selection.from).toBe(0);
  expect((view.state.selection as NodeSelection).node.type.name).toBe("bullet_list");
  press(view, "Escape");
  expect(view.state.selection).toBeInstanceOf(TextSelection);
  expect(view.state.selection.from).toBeGreaterThan(0);
  press(view, "Escape");
  press(view, "Backspace");
  expect(view.state.doc.textContent).toBe("Tail");
});

it("a block selected with Escape is the current block for move and duplicate", async () => {
  const { view } = await open("A\n\nB\n\nC");
  caretAt(view, 4);
  press(view, "Escape");
  mod(view, "ArrowUp", { shiftKey: true });
  expect(view.state.doc.textBetween(0, view.state.doc.content.size, "|")).toBe("B|A|C");
  press(view, "Escape");
  press(view, "Escape");
  mod(view, "d");
  expect(view.state.doc.textBetween(0, view.state.doc.content.size, "|")).toBe("B|B|A|C");
});

it("typing over a selected block replaces it", async () => {
  const { view } = await open("One\n\nTwo");
  caretAt(view, 2);
  press(view, "Escape");
  type(view, "x");
  expect(view.state.doc.textBetween(0, view.state.doc.content.size, "|")).toBe("x|Two");
});

it("Escape leaves a wikilink document's links untouched when selecting blocks", async () => {
  const { editor, view } = await open("See [[Note]] here\n\nTail");
  caretAt(view, 2);
  press(view, "Escape");
  expect(editor.getMarkdown()).toContain("[[Note]]");
});

it("Escape closes the / list first and selects nothing", async () => {
  const { view } = await open("", true);
  type(view, "/");
  press(view, "Escape");
  expect(view.state.selection).toBeInstanceOf(TextSelection);
  press(view, "Escape");
  expect(view.state.selection).toBeInstanceOf(NodeSelection);
});

it("Escape closes the [[ list first", async () => {
  const root = document.body.appendChild(document.createElement("div"));
  const suggest = wikiLinkSuggest({ loadTargets: async () => ({ targets: [{ documentId: "1", sourceId: "s", sourceName: "Notes", title: "Alpha", editedAt: "2026-09-01T00:00:00.000Z" }], truncated: false }) });
  const editor = await createMarkdownEditor({ root, markdown: "", className: "kh-editor", ariaLabel: "Content", editable: true, onUserEdit: () => {}, onMarkdown: () => {}, allowImage: () => false, extraPlugins: suggest.plugins, configure: suggest.configure });
  opened.push(editor);
  const view = editor.action(ctx => ctx.get(editorViewCtx));
  view.focus();
  type(view, "[[Al");
  for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
  const shown = () => document.querySelector<HTMLElement>(".kh-wikilink-suggest")?.dataset.show === "true";
  expect(shown()).toBe(true);
  press(view, "Escape");
  expect(shown()).toBe(false);
  expect(view.state.selection).toBeInstanceOf(TextSelection);
});

it("Escape in code being edited selects the code block; a second returns to its text", async () => {
  const { view } = await open("```js\nconst x = 1;\n```\n\nTail");
  caretAt(view, 3);
  press(view, "Escape");
  expect(view.state.selection).toBeInstanceOf(NodeSelection);
  expect((view.state.selection as NodeSelection).node.type.name).toBe("code_block");
  press(view, "Escape");
  expect(view.state.selection).toBeInstanceOf(TextSelection);
  expect(view.state.selection.$from.parent.type.name).toBe("code_block");
});

it("Escape is left alone while composing and when the target is a form field", async () => {
  const { view } = await open("One");
  caretAt(view, 2);
  press(view, "Escape", { isComposing: true });
  expect(view.state.selection).toBeInstanceOf(TextSelection);
  const field = view.dom.appendChild(document.createElement("select"));
  const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  field.dispatchEvent(event);
  expect(view.state.selection).toBeInstanceOf(TextSelection);
});

it("Mod-a selects the textblock's text first, then the whole document", async () => {
  const { view } = await open("First\n\nSecond");
  caretAt(view, 9);
  mod(view, "a");
  expect(view.state.doc.textBetween(view.state.selection.from, view.state.selection.to)).toBe("Second");
  mod(view, "a");
  expect(view.state.selection.from).toBe(0);
  expect(view.state.selection.to).toBe(view.state.doc.content.size);
});

it("Mod-a selects everything at once in an empty block", async () => {
  const { view } = await open("First\n\nSecond");
  view.dispatch(view.state.tr.insert(view.state.doc.content.size, view.state.schema.nodes.paragraph.create()));
  caretAt(view, view.state.doc.content.size - 1);
  mod(view, "a");
  expect(view.state.selection.from).toBe(0);
  expect(view.state.selection.to).toBe(view.state.doc.content.size);
});

it("Mod-a uses the innermost textblock in a list item", async () => {
  const { view } = await open("- one\n- two");
  caretAt(view, 10);
  mod(view, "a");
  expect(view.state.doc.textBetween(view.state.selection.from, view.state.selection.to)).toBe("two");
});

it("undo still works after these keys", async () => {
  const { view } = await open("A\n\nB");
  const original = view.state.doc;
  caretAt(view, 4);
  mod(view, "d");
  undo(view.state, view.dispatch);
  expect(view.state.doc.eq(original)).toBe(true);
});

vi.fn();

describe("Mod-Shift-7/8/9 on a list chosen with Escape (5: the keys toggle off)", () => {
  it.each([
    ["- one\n- two\n", "8", { shiftKey: true }],
    ["1. one\n2. two\n", "7", { shiftKey: true }],
    ["- [ ] one\n- [ ] two\n", "9", { shiftKey: true }],
  ] as const)("turns %j back into paragraphs, and handles the key", async (markdown, key, extra) => {
    const { editor, view } = await open(markdown);
    chooseList(view);
    expect(view.state.selection).toBeInstanceOf(NodeSelection);
    const event = mod(view, key, extra);
    expect(event.defaultPrevented).toBe(true);
    expect(editor.getMarkdown()).toBe("one\n\ntwo\n");
  });
  it("leaves the key alone for a block that cannot become a list", async () => {
    const { view } = await open("| a |\n| - |\n| b |\n");
    caretAt(view, findText(view, "b") + 1);
    press(view, "Escape");
    expect(view.state.selection).toBeInstanceOf(NodeSelection);
    expect(mod(view, "8", { shiftKey: true }).defaultPrevented).toBe(false);
  });
});

it("[x] typed at the start of an item's later paragraph does not check the item", async () => {
  const { editor, view } = await open("- first\n\n  later\n");
  caretAt(view, findText(view, "later"));
  type(view, "[x] ");
  // Written as text (the serializer escapes it), and the item is not a to-do.
  expect(editor.getMarkdown()).toBe("- first\n\n  \\[x] later\n");
  expect(view.state.doc.firstChild!.firstChild!.attrs.checked).toBeNull();
});

it.each([
  ["- one\n- two\n", "two", "- one\n- [ ] two\n"],
  ["1. one\n2. two\n", "two", "1. one\n2. [ ] two\n"],
  ["- outer\n  - inner\n", "inner", "- outer\n  - [ ] inner\n"],
])("[ ] typed on an item's first line makes that item a to-do: %j", async (markdown, at, expected) => {
  const { editor, view } = await open(markdown);
  caretAt(view, findText(view, at));
  type(view, "[ ] ");
  expect(editor.getMarkdown()).toBe(expected);
});

it("Mod-Shift-8 on an Escape-chosen list keeps its links", async () => {
  const markdown = "- see [[Target]] and [[Other|alias]]\n- read [doc](notes/a.md#Part)\n";
  const { editor, view } = await open(markdown);
  chooseList(view);
  mod(view, "8", { shiftKey: true });
  const links = (text: string) => extractDocumentLinks(text).map(({ kind, target }) => ({ kind, target }));
  expect(editor.getMarkdown()).not.toBe(markdown);
  expect(links(editor.getMarkdown())).toEqual(links(markdown));
});

it("Mod-d duplicates the list item under the caret", async () => {
  const { view } = await open("- one\n- two\n- three");
  caretAt(view, findText(view, "two") + 1);
  mod(view, "d");
  expect(view.state.doc.textBetween(0, view.state.doc.content.size, "|")).toBe("one|two|two|three");
});

describe("Escape selects the list item, not the list", () => {
  const itemText = (view: EditorView) => (view.state.selection as NodeSelection).node.textContent;
  const lines = (markdown: string) => markdown.trim().split("\n").map((line) => line.trimEnd());

  it("Escape selects the item", async () => {
    const { view } = await open("- a\n- b\n- c");
    caretAt(view, findText(view, "b") + 1);
    press(view, "Escape");
    expect(view.state.selection).toBeInstanceOf(NodeSelection);
    expect((view.state.selection as NodeSelection).node.type.name).toBe("list_item");
    expect(itemText(view)).toBe("b");
  });

  it("Escape then Backspace keeps the other items", async () => {
    const { editor, view } = await open("- a\n- b\n- c");
    caretAt(view, findText(view, "b") + 1);
    press(view, "Escape");
    press(view, "Backspace");
    expect(lines(editor.getMarkdown())).toEqual(["- a", "- c"]);
  });

  it("Escape twice returns to the item's text", async () => {
    const { view } = await open("- a\n- b\n- c");
    caretAt(view, findText(view, "b") + 1);
    press(view, "Escape");
    press(view, "Escape");
    expect(view.state.selection).toBeInstanceOf(TextSelection);
    expect(view.state.selection.$from.parent.textContent).toBe("b");
  });

  it("nested item: Backspace takes only that item", async () => {
    const { editor, view } = await open("- a\n  - n\n- c");
    caretAt(view, findText(view, "n") + 1);
    press(view, "Escape");
    expect(itemText(view)).toBe("n");
    press(view, "Backspace");
    expect(lines(editor.getMarkdown())).toEqual(["- a", "- c"]);
  });

  it("typing over a task item keeps it a task item", async () => {
    const { editor, view } = await open("- [ ] a\n- [ ] b");
    caretAt(view, findText(view, "b") + 1);
    press(view, "Escape");
    type(view, "x");
    expect(lines(editor.getMarkdown())).toEqual(["- [ ] a", "- [ ] x"]);
    expect(view.state.selection).toBeInstanceOf(TextSelection);
  });

  it("typing over an item keeps its nested children", async () => {
    const { editor, view } = await open("- a\n  - n\n- c");
    caretAt(view, findText(view, "a") + 1);
    press(view, "Escape");
    type(view, "x");
    expect(lines(editor.getMarkdown())).toEqual(["- x", "  - n", "- c"]);
  });

  it("the turn key on an item splits the list around it", async () => {
    const { editor, view } = await open("- a\n- b\n- c");
    caretAt(view, findText(view, "b") + 1);
    press(view, "Escape");
    mod(view, "6", { altKey: true });
    const md = lines(editor.getMarkdown()).filter(Boolean);
    expect(md).toEqual(["- a", "1. b", "- c"]);
  });

  it("Mod-d on an item duplicates the item", async () => {
    const { editor, view } = await open("- a\n- b\n- c");
    caretAt(view, findText(view, "b") + 1);
    press(view, "Escape");
    mod(view, "d");
    expect(lines(editor.getMarkdown())).toEqual(["- a", "- b", "- b", "- c"]);
  });

  it("Tab with an item selected does not indent or throw", async () => {
    const { editor, view } = await open("- a\n- b\n- c");
    caretAt(view, findText(view, "b") + 1);
    press(view, "Escape");
    press(view, "Tab");
    expect(lines(editor.getMarkdown())).toEqual(["- a", "- b", "- c"]);
  });

  it("Shift-ArrowDown from an item does not throw", async () => {
    const { view } = await open("- a\n- b\n- c");
    caretAt(view, findText(view, "b") + 1);
    press(view, "Escape");
    expect(() => press(view, "ArrowDown", { shiftKey: true })).not.toThrow();
  });

  it("Escape in a paragraph still selects the paragraph", async () => {
    const { view } = await open("One\n\nTwo");
    caretAt(view, 2);
    press(view, "Escape");
    expect((view.state.selection as NodeSelection).node.type.name).toBe("paragraph");
  });
});
