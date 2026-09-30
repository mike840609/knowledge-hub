// @vitest-environment jsdom
import { editorViewCtx } from "@milkdown/kit/core";
import { DOMParser as ProseDOMParser, DOMSerializer } from "@milkdown/kit/prose/model";
import { Selection, TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createMarkdownEditor, type MarkdownEditor } from "@/components/knowledge/editor/editor-core";
import { configureWikiLinkStringify, splitWikiLinkText, wikiLinkPlugins } from "@/components/knowledge/editor/wiki-link";

// jsdom has no ClipboardEvent, which ProseMirror's `pasteText` makes.
beforeAll(() => {
  vi.stubGlobal("ClipboardEvent", class extends Event { clipboardData = null; });
});

const opened: MarkdownEditor[] = [];
afterEach(async () => {
  while (opened.length) await opened.pop()!.destroy();
  document.body.innerHTML = "";
});

async function open(markdown: string) {
  const root = document.createElement("div");
  document.body.appendChild(root);
  const editor = await createMarkdownEditor({
    root,
    markdown,
    className: "kh-editor",
    ariaLabel: "Content",
    editable: true,
    onUserEdit: () => {},
    onMarkdown: () => {},
    allowImage: () => true,
    extraPlugins: wikiLinkPlugins,
    configure: configureWikiLinkStringify,
  });
  opened.push(editor);
  return { root, editor };
}

const view = (editor: MarkdownEditor): EditorView => editor.action((ctx) => ctx.get(editorViewCtx));

/** The `raw` of every wiki_link node, in order. */
function wikiLinks(editor: MarkdownEditor): string[] {
  const found: string[] = [];
  view(editor).state.doc.descendants((node) => {
    if (node.type.name === "wiki_link") found.push(node.attrs.raw as string);
  });
  return found;
}

/** Typing, one character at a time, the way the browser reports it: input rules see each one before it lands. */
function typeText(editor: MarkdownEditor, text: string) {
  const v = view(editor);
  for (const character of text) {
    const { from, to } = v.state.selection;
    if (!v.someProp("handleTextInput", (handler) => handler(v, from, to, character, () => v.state.tr.insertText(character, from, to)))) {
      v.dispatch(v.state.tr.insertText(character, from, to));
    }
  }
}

/** The caret at the end of the document's first textblock. */
function caretAtEndOfFirstBlock(editor: MarkdownEditor) {
  const v = view(editor);
  const end = v.state.doc.firstChild!.nodeSize - 1;
  v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, end)));
}

describe("splitWikiLinkText", () => {
  it("cuts links out of plain text and keeps what is around them", () => {
    expect(splitWikiLinkText("see [[Note]] and [[B|b]] now")).toEqual(["see ", { raw: "[[Note]]" }, " and ", { raw: "[[B|b]]" }, " now"]);
    expect(splitWikiLinkText("[[A]][[B]]")).toEqual([{ raw: "[[A]]" }, { raw: "[[B]]" }]);
    expect(splitWikiLinkText("no links here")).toEqual(["no links here"]);
    expect(splitWikiLinkText("")).toEqual([]);
  });

  it("does not take an embed, an empty link, a link split across lines, or one a backslash escapes", () => {
    expect(splitWikiLinkText("![[Image.png]]")).toEqual(["![[Image.png]]"]);
    expect(splitWikiLinkText("[[]] [[#]]")).toEqual(["[[]] [[#]]"]);
    expect(splitWikiLinkText("[[broken\nlink]]")).toEqual(["[[broken\nlink]]"]);
    expect(splitWikiLinkText("\\[[x]] and [[y]]")).toEqual(["\\[[x]] and ", { raw: "[[y]]" }]);
  });
});

describe("the wiki_link node", () => {
  it("holds each wikilink of a document as one node, with the link as written", async () => {
    const { editor } = await open("See [[Alpha]], [[Beta|the beta]], [[Gamma#Setup]] and [[  Spaced  |  a  ]].\n");
    expect(wikiLinks(editor)).toEqual(["[[Alpha]]", "[[Beta|the beta]]", "[[Gamma#Setup]]", "[[  Spaced  |  a  ]]"]);
  });

  it("is an inline atom: a caret is never inside it", async () => {
    const { editor } = await open("a [[Note]] b\n");
    let checked = false;
    view(editor).state.doc.descendants((node) => {
      if (node.type.name !== "wiki_link") return;
      expect([node.isInline, node.isAtom, node.isLeaf]).toEqual([true, true, true]);
      checked = true;
    });
    expect(checked).toBe(true);
  });

  it("is shown as the reader shows it, with the link as written in its title", async () => {
    const { root } = await open("[[Note]] [[Note|alias]] [[Note#Setup]] [[Note#Setup|alias]] [[#Heading]]\n");
    const shown = [...root.querySelectorAll("span.kh-wikilink")].map((element) => [element.textContent, element.getAttribute("title")]);
    expect(shown).toEqual([
      ["Note", "[[Note]]"],
      ["alias", "[[Note|alias]]"],
      ["Note › Setup", "[[Note#Setup]]"],
      ["alias", "[[Note#Setup|alias]]"],
      ["Heading", "[[#Heading]]"],
    ]);
  });

  it("keeps the link as written through copy and paste inside the editor", async () => {
    const { editor } = await open("[[Note#Setup|shown]] and text\n");
    const v = view(editor);
    const holder = document.createElement("div");
    holder.appendChild(DOMSerializer.fromSchema(v.state.schema).serializeFragment(v.state.doc.content));
    const pasted: string[] = [];
    ProseDOMParser.fromSchema(v.state.schema)
      .parse(holder)
      .descendants((node) => {
        if (node.type.name === "wiki_link") pasted.push(node.attrs.raw as string);
      });
    expect(pasted).toEqual(["[[Note#Setup|shown]]"]);
  });
});

describe("typing a wikilink", () => {
  it("makes a node when the closing brackets are typed", async () => {
    const { editor } = await open("\n");
    typeText(editor, "see [[Note#H|a]]");
    expect(wikiLinks(editor)).toEqual(["[[Note#H|a]]"]);
    expect(view(editor).state.doc.textContent).toBe("see ");
  });

  it("is still text until the second closing bracket is typed", async () => {
    const { editor } = await open("\n");
    typeText(editor, "[[Note]");
    expect(wikiLinks(editor)).toEqual([]);
    expect(view(editor).state.doc.textContent).toBe("[[Note]");
  });

  it("keeps typing after the link where it was", async () => {
    const { editor } = await open("\n");
    typeText(editor, "[[A]] and [[B]]!");
    expect(wikiLinks(editor)).toEqual(["[[A]]", "[[B]]"]);
    expect(view(editor).state.doc.textContent).toBe(" and !");
  });

  it.each([
    ["a backslash before it escapes it", "\\[[x]]"],
    ["an embed is not a link", "![[x]]"],
    ["an empty link is not a link", "[[]]"],
    ["a heading-only link with nothing after # has no target or fragment", "[[#]]"],
  ])("makes no node when %s", async (_why, typed) => {
    const { editor } = await open("\n");
    typeText(editor, typed);
    expect(wikiLinks(editor)).toEqual([]);
    expect(view(editor).state.doc.textContent).toBe(typed);
  });

  it("makes no node inside a code block", async () => {
    const { editor } = await open("```\ncode\n```\n");
    const v = view(editor);
    v.dispatch(v.state.tr.setSelection(Selection.atEnd(v.state.doc)));
    typeText(editor, "[[x]]");
    expect(wikiLinks(editor)).toEqual([]);
    expect(v.state.doc.textContent).toBe("code[[x]]");
  });

  it("makes no node inside inline code", async () => {
    const { editor } = await open("`code`\n");
    // The caret at the end of the code span keeps its mark, so what is typed there is code.
    caretAtEndOfFirstBlock(editor);
    const v = view(editor);
    v.dispatch(v.state.tr.setStoredMarks(v.state.doc.firstChild!.lastChild!.marks));
    typeText(editor, "[[x]]");
    expect(wikiLinks(editor)).toEqual([]);
  });

  it("makes no node inside the text of a link", async () => {
    const { editor } = await open("[site](https://example.com)\n");
    caretAtEndOfFirstBlock(editor);
    const v = view(editor);
    v.dispatch(v.state.tr.setStoredMarks(v.state.doc.firstChild!.lastChild!.marks));
    typeText(editor, "[[x]]");
    expect(wikiLinks(editor)).toEqual([]);
  });
});

describe("pasting a wikilink", () => {
  it("makes nodes of the links in pasted text, and keeps the text between them", async () => {
    const { editor } = await open("\n");
    view(editor).pasteText("see [[Note]] and [[B|b]] now");
    expect(wikiLinks(editor)).toEqual(["[[Note]]", "[[B|b]]"]);
    expect(view(editor).state.doc.textContent).toBe("see  and  now");
  });

  it("makes nodes in every line of a multi-line paste", async () => {
    const { editor } = await open("\n");
    view(editor).pasteText("[[One]]\n\nsecond [[Two]]");
    expect(wikiLinks(editor)).toEqual(["[[One]]", "[[Two]]"]);
  });

  it.each([
    ["an escaped link", "\\[\\[x\\]\\]"],
    ["an embed", "![[x]]"],
    ["an empty link", "[[]]"],
  ])("leaves %s as text", async (_what, pasted) => {
    const { editor } = await open("\n");
    view(editor).pasteText(pasted);
    expect(wikiLinks(editor)).toEqual([]);
  });

  it("leaves a link pasted into inline code as text", async () => {
    const { editor } = await open("`code`\n");
    caretAtEndOfFirstBlock(editor);
    const v = view(editor);
    v.dispatch(v.state.tr.setStoredMarks(v.state.doc.firstChild!.lastChild!.marks));
    v.pasteText("[[x]]");
    expect(wikiLinks(editor)).toEqual([]);
  });

  it("leaves a link pasted into a code block as text", async () => {
    const { editor } = await open("```\ncode\n```\n");
    const v = view(editor);
    v.dispatch(v.state.tr.setSelection(Selection.atEnd(v.state.doc)));
    v.pasteText("[[x]]");
    expect(wikiLinks(editor)).toEqual([]);
    expect(v.state.doc.textContent).toContain("[[x]]");
  });
});
