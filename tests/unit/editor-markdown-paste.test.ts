// @vitest-environment jsdom
import { editorViewCtx } from "@milkdown/kit/core";
import { TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { afterEach, describe, expect, it } from "vitest";
import { createMarkdownEditor, type MarkdownEditor } from "@/components/knowledge/editor/editor-core";
import { selectionToolbar } from "@/components/knowledge/editor/selection-toolbar";
import { extractDocumentLinks } from "@/modules/knowledge/domain/document-links";

// 2026-11-19 paste-and-links spec: Markdown text pastes as Markdown, an address as a link, and typed links.
const rect = { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => rect;
const opened: MarkdownEditor[] = [];
afterEach(async () => { for (const editor of opened.splice(0)) await editor.destroy(); document.body.innerHTML = ""; });

async function open(markdown: string) {
  const root = document.body.appendChild(document.createElement("div"));
  const toolbar = selectionToolbar(undefined, () => undefined);
  const editor = await createMarkdownEditor({
    root, markdown, className: "kh-editor", ariaLabel: "Content", editable: true, onUserEdit: () => {}, onMarkdown: () => {}, allowImage: () => false,
    extraPlugins: toolbar.plugins, configure: toolbar.configure,
  });
  opened.push(editor);
  const view = editor.action(ctx => ctx.get(editorViewCtx));
  view.dom.focus();
  view.dispatch(view.state.tr);
  return { editor, view };
}
const caretAt = (view: EditorView, pos: number) => view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)));
const caretAtEnd = (view: EditorView) => caretAt(view, TextSelection.atEnd(view.state.doc).from);
function paste(view: EditorView, data: Record<string, string>) {
  const event = new Event("paste", { bubbles: true, cancelable: true }) as ClipboardEvent;
  Object.defineProperty(event, "clipboardData", { value: { getData: (type: string) => data[type] ?? "", files: [], types: Object.keys(data) } });
  view.dom.dispatchEvent(event);
  return event;
}
function type(view: EditorView, text: string) {
  for (const character of text) {
    const { from, to } = view.state.selection;
    if (!view.someProp("handleTextInput", handler => handler(view, from, to, character, () => view.state.tr.insertText(character, from, to)))) {
      view.dispatch(view.state.tr.insertText(character, from, to));
    }
  }
}
/** What the document holds after a save and a reopen: the same Markdown, so nothing was lost on the way. */
async function roundTrip(editor: MarkdownEditor) {
  const markdown = editor.getMarkdown();
  const again = await open(markdown);
  expect(again.editor.getMarkdown()).toBe(markdown);
  return markdown;
}

describe("Markdown text pastes as Markdown (1)", () => {
  it("makes headings, lists, marks and code of it", async () => {
    const { editor, view } = await open("Start.\n\n\n");
    caretAtEnd(view);
    expect(paste(view, { "text/plain": "## Pasted\n\n- a\n- b\n\n**bold** and `code`\n\n```js\nlet a\n```" }).defaultPrevented).toBe(true);
    expect(await roundTrip(editor)).toBe("Start.\n\n## Pasted\n\n- a\n- b\n\n**bold** and `code`\n\n```js\nlet a\n```\n");
  });

  it("keeps a pasted wikilink and a Markdown link as links the extractor reads", async () => {
    const { editor, view } = await open("\n");
    paste(view, { "text/plain": "- see [[Some Page]]\n- and [site](https://example.com)" });
    const markdown = await roundTrip(editor);
    expect(extractDocumentLinks(markdown).map(link => link.target)).toEqual(["Some Page"]);
    expect(markdown).toContain("[site](https://example.com)");
    expect(markdown).not.toContain("\\[");
  });

  it("joins an inline-only paste into the line it lands in", async () => {
    const { editor, view } = await open("before after\n");
    caretAt(view, 8);
    paste(view, { "text/plain": "**bold**" });
    expect(editor.getMarkdown()).toBe("before **bold**after\n");
  });

  it("reads VS Code's Markdown, whose HTML is only the source in colour", async () => {
    const { editor, view } = await open("\n");
    paste(view, { "text/plain": "# Title\n\n- one", "text/html": "<div><span># Title</span></div>", "vscode-editor-data": '{"version":1,"mode":"markdown"}' });
    expect(editor.getMarkdown()).toBe("# Title\n\n- one\n");
  });

  it.each([
    ["plain lines", "line one\nline two", "line one\n\nline two\n"],
    ["a sentence with a dash in it", "a - b", "a - b\n"],
  ])("leaves %s to the text paste", async (_name, text, expected) => {
    const { editor, view } = await open("\n");
    paste(view, { "text/plain": text });
    expect(editor.getMarkdown()).toBe(expected);
  });

  // The 2026-11-20 spec, decision 4: an address inside pasted text is linked, in either path.
  it.each([
    ["a sentence", "see https://example.com now", "see <https://example.com> now\n"],
    ["lines", "one https://a.example\ntwo https://b.example/x.", "one <https://a.example>\n\ntwo <https://b.example/x>.\n"],
    ["parentheses", "(see https://example.com/a_(b)) and https://c.example)", "(see <https://example.com/a_(b)>) and <https://c.example>)\n"],
    ["Markdown", "**bold** at https://example.com/path.", "**bold** at <https://example.com/path>.\n"],
  ])("links the addresses in pasted %s", async (_name, text, expected) => {
    const { editor, view } = await open("\n");
    expect(paste(view, { "text/plain": text }).defaultPrevented).toBe(true);
    expect(await roundTrip(editor)).toBe(expected);
  });

  it("keeps a pasted [[wikilink]] a link when the text also holds an address, and the marks at the caret", async () => {
    const { editor, view } = await open("\n");
    paste(view, { "text/plain": "see [[Foo]] at https://example.com now" });
    const markdown = await roundTrip(editor);
    expect(markdown).toBe("see [[Foo]] at <https://example.com> now\n");
    expect(extractDocumentLinks(markdown).map((link) => [link.kind, link.target])).toEqual([["WIKI", "Foo"]]);
    const bold = await open("**ab**\n");
    bold.view.dispatch(bold.view.state.tr.setSelection(TextSelection.create(bold.view.state.doc, 2)));
    paste(bold.view, { "text/plain": "x https://e.com y" });
    expect(bold.editor.getMarkdown()).toBe("**ax <https://e.com> yb**\n");
  });

  it("leaves an address inside code, and an address that is not one, as text", async () => {
    const { editor, view } = await open("\n");
    paste(view, { "text/plain": "run `curl https://example.com` and see http:// or httpx://example.com" });
    expect(editor.getMarkdown()).toBe("run `curl https://example.com` and see http\\:// or httpx://example.com\n");
  });

  it("pastes a lone address as the link paste does, and a sentence in a table cell as text", async () => {
    const { editor, view } = await open("\n");
    paste(view, { "text/plain": "https://example.com" });
    expect(editor.getMarkdown()).toBe("<https://example.com>\n");
    const cell = await open("| a | b |\n| - | - |\n| x | y |\n");
    cell.view.dispatch(cell.view.state.tr.setSelection(TextSelection.create(cell.view.state.doc, 5)));
    paste(cell.view, { "text/plain": "see https://example.com" });
    expect(cell.editor.getMarkdown()).not.toContain("<https://example.com>");
  });

  it("puts a pasted heading on its own line, not into the one it lands in", async () => {
    const { editor, view } = await open("Start.\n");
    caretAtEnd(view);
    paste(view, { "text/plain": "## Pasted" });
    expect(editor.getMarkdown()).toBe("Start.\n\n## Pasted\n");
  });

  it("leaves HTML from other apps to the HTML paste", async () => {
    const { editor, view } = await open("\n");
    paste(view, { "text/plain": "# Not a heading", "text/html": "<p># Not a heading</p>" });
    expect(editor.getMarkdown()).not.toMatch(/^# /);
  });

  it("pastes into a code block as text", async () => {
    const { editor, view } = await open("```\nx\n```\n");
    caretAt(view, 2);
    paste(view, { "text/plain": "## kept\n- as typed" });
    expect(editor.getMarkdown()).toBe("```\nx## kept\n- as typed\n```\n");
  });
});

describe("an address pasted at a caret is a link (2)", () => {
  it("links the address to itself", async () => {
    const { editor, view } = await open("see .\n");
    caretAt(view, 5);
    expect(paste(view, { "text/plain": "https://example.com/a?b=1" }).defaultPrevented).toBe(true);
    type(view, " next");
    expect(await roundTrip(editor)).toBe("see <https://example.com/a?b=1> next.\n");
  });

  it("stays text inside inline code", async () => {
    const { editor, view } = await open("`code`\n");
    caretAt(view, 3);
    paste(view, { "text/plain": "https://example.com" });
    expect(editor.getMarkdown()).not.toContain("<https");
  });
});

describe("typed links (3, 4)", () => {
  it("links an address when a space follows it, punctuation left out", async () => {
    const { editor, view } = await open("\n");
    type(view, "go to https://example.com/x. then");
    expect(await roundTrip(editor)).toBe("go to <https://example.com/x>. then\n");
    const fresh = await open("\n");
    type(fresh.view, "go to https://example.com/x then");
    expect(await roundTrip(fresh.editor)).toBe("go to <https://example.com/x> then\n");
  });

  it("keeps a ) that closes a ( inside the address, and leaves out one that closes the sentence's", async () => {
    const { editor, view } = await open("\n");
    type(view, "https://en.wikipedia.org/wiki/Foo_(bar) x");
    expect(await roundTrip(editor)).toBe("<https://en.wikipedia.org/wiki/Foo_(bar)> x\n");
    const fresh = await open("\n");
    type(fresh.view, "(see https://example.com/a) x");
    expect(await roundTrip(fresh.editor)).toBe("(see <https://example.com/a>) x\n");
  });

  it("does nothing to a space typed over a selection but replace the selection", async () => {
    const { editor, view } = await open("\n");
    type(view, "go https://example.com/path");
    const end = view.state.selection.from;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, end - 4, end)));
    type(view, " ");
    expect(editor.getMarkdown()).toBe("go https://example.com/ \n");
    expect(view.state.doc.rangeHasMark(0, view.state.doc.content.size, view.state.schema.marks.link)).toBe(false);
  });

  it("does not link an address typed in inline code or a code block", async () => {
    const { editor, view } = await open("```\n\n```\n");
    caretAt(view, 1);
    type(view, "https://example.com ");
    expect(editor.getMarkdown()).toBe("```\nhttps://example.com \n```\n");
  });

  it("makes [text](url) a link on its closing parenthesis", async () => {
    const { editor, view } = await open("\n");
    type(view, "read [the guide](https://example.com/g) now");
    expect(await roundTrip(editor)).toBe("read [the guide](https://example.com/g) now\n");
    let linked = "";
    view.state.doc.descendants(node => { if (node.marks.some(mark => mark.type.name === "link")) linked += node.text; });
    expect(linked).toBe("the guide");
  });

  it("never swallows a wikilink typed inside the brackets or after an address", async () => {
    // An input rule reads an inline node as U+FFFC; taken into a link, the node was lost.
    const bracketed = await open("[see [[Page]] here\n");
    caretAtEnd(bracketed.view);
    type(bracketed.view, "](https://x.com)");
    const first = bracketed.editor.getMarkdown();
    expect(first).not.toContain("\ufffc");
    expect(extractDocumentLinks(first).map(link => link.target)).toEqual(["Page"]);

    const after = await open("[[Page]]\n");
    caretAt(after.view, 1);
    type(after.view, "see https://x.com/");
    caretAtEnd(after.view);
    type(after.view, "abc z");
    // The address stops at the wikilink, so no link is made across it (its href was "https://x.com/\ufffcabc").
    const second = after.editor.getMarkdown();
    expect(second).not.toContain("\ufffc");
    expect(second).toBe("see https\\://x.com/[[Page]]abc z\n");
  });

  it("links an address typed straight after a line break", async () => {
    const { editor, view } = await open("a  \nb\n");
    caretAtEnd(view);
    view.dispatch(view.state.tr.replaceSelectionWith(view.state.schema.nodes.hardbreak.create()));
    type(view, "https://x.com/abc z");
    const markdown = editor.getMarkdown();
    expect(markdown).toContain("<https://x.com/abc>");
    expect(markdown).not.toContain("\ufffc");
  });

  it("leaves ![alt](src) and [[wikilinks]] to their own rules", async () => {
    const { editor, view } = await open("\n");
    type(view, "![alt](x.png) and [[Page]]");
    const markdown = editor.getMarkdown();
    expect(markdown).not.toContain("[alt](x.png)](");
    expect(extractDocumentLinks(markdown).map(link => link.target)).toEqual(["Page"]);
  });
});

describe("a typed [text](url) keeps its formatting (2026-11-20, decision 3)", () => {
  it("makes a bold link of [**bold**](url) and keeps a mark around it", async () => {
    const { editor, view } = await open("\n");
    type(view, "[**bold** and *it*](https://example.com)");
    // The link is one mark over both pieces; the writer puts it around each differently-marked run.
    expect(await roundTrip(editor)).toBe("**[bold](https://example.com)** [and *it*](https://example.com)\n");
    const { editor: second, view: line } = await open("\n");
    type(line, "see ");
    line.dispatch(line.state.tr.addStoredMark(line.state.schema.marks.strong.create()));
    type(line, "[words](https://example.com)");
    expect(second.getMarkdown()).toBe("see **[words](https://example.com)**\n");
  });
});
