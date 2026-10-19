// @vitest-environment jsdom
import { editorViewCtx } from "@milkdown/kit/core";
import { undo } from "@milkdown/kit/prose/history";
import { TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { afterEach, describe, expect, it } from "vitest";
import { createMarkdownEditor, type MarkdownEditor } from "@/components/knowledge/editor/editor-core";

// Layout is not something jsdom has; zero-sized answers are enough here, as in the toolbar tests.
const noRect = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) } as DOMRect;
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => noRect;
Element.prototype.getClientRects = () => [] as unknown as DOMRectList;

const opened: MarkdownEditor[] = [];
afterEach(async () => {
  while (opened.length) await opened.pop()!.destroy();
  document.body.innerHTML = "";
});

async function open(markdown: string, editable = true): Promise<EditorView> {
  const root = document.createElement("div");
  document.body.appendChild(root);
  const editor = await createMarkdownEditor({
    root, markdown, className: "kh-editor", ariaLabel: "Content", editable,
    onUserEdit: () => {}, onMarkdown: () => {}, allowImage: () => false,
  });
  opened.push(editor);
  return editor.action((ctx) => ctx.get(editorViewCtx));
}
const markdownOf = () => opened.at(-1)!.getMarkdown().trim();

/** Puts the caret at the start of the first text node reading `text`. */
function caretBefore(view: EditorView, text: string) {
  let at = -1;
  view.state.doc.descendants((node, pos) => {
    if (at < 0 && node.isText && node.text === text) at = pos;
  });
  if (at < 0) throw new Error(`"${text}" missing from test document`);
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at)));
}
/** Empties the paragraph holding `text`, leaving the caret in it — what selecting it and deleting does. */
function emptyParagraphOf(view: EditorView, text: string) {
  caretBefore(view, text);
  const { from } = view.state.selection;
  view.dispatch(view.state.tr.delete(from, from + text.length));
}
function backspace(view: EditorView) {
  view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true }));
}

describe("Backspace lifts a block out of its wrapper when nothing precedes it", () => {
  it("turns a quote that opens the document into a paragraph, keeping its text", async () => {
    const view = await open("> quote\n\nAfter\n");
    caretBefore(view, "quote");
    backspace(view);
    expect(view.state.doc.toString()).toBe('doc(paragraph("quote"), paragraph("After"))');
    expect(view.state.selection.$from.parent.textContent).toBe("quote");
  });

  it("removes one level of a nested quote per press", async () => {
    const view = await open("> > inner\n");
    caretBefore(view, "inner");
    backspace(view);
    expect(view.state.doc.toString()).toBe('doc(blockquote(paragraph("inner")))');
    backspace(view);
    expect(view.state.doc.toString()).toBe('doc(paragraph("inner"))');
  });

  it("dissolves a callout that opens the document without exposing its marker", async () => {
    const view = await open("> [!NOTE]\n> body\n");
    caretBefore(view, "body");
    backspace(view);
    backspace(view);
    expect(view.state.doc.toString()).toBe('doc(paragraph("body"))');
    expect(markdownOf()).toBe("body");
  });

  it("is one undo step", async () => {
    const view = await open("> quote\n");
    caretBefore(view, "quote");
    backspace(view);
    undo(view.state, view.dispatch);
    expect(view.state.doc.toString()).toBe('doc(blockquote(paragraph("quote")))');
  });

  it("leaves a quote after other content to the usual join", async () => {
    const view = await open("Before\n\n> quote\n");
    caretBefore(view, "quote");
    backspace(view);
    expect(view.state.doc.toString()).toBe('doc(paragraph("Beforequote"))');
  });

  it("does not lift from the middle of the text or with a selection", async () => {
    const view = await open("> quote\n");
    const start = view.state.selection.$from.start();
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, start + 2)));
    backspace(view);
    expect(view.state.doc.toString()).toBe('doc(blockquote(paragraph("quote")))');
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, start, start + 2)));
    backspace(view);
    expect(view.state.doc.toString()).toBe('doc(blockquote(paragraph("ote")))');
  });

  it("leaves blocks that are not wrapped, lists and tables to their own handling", async () => {
    const heading = await open("# Title\n");
    caretBefore(heading, "Title");
    backspace(heading);
    expect(heading.state.doc.toString()).toBe('doc(paragraph("Title"))');

    const code = await open("```js\ncode\n```\n");
    caretBefore(code, "code");
    backspace(code);
    expect(code.state.doc.toString()).toBe('doc(code_block("code"))');

    const list = await open("- item\n");
    caretBefore(list, "item");
    backspace(list);
    expect(list.state.doc.toString()).toBe('doc(paragraph("item"))');

    const table = await open("| a | b |\n| - | - |\n| 1 | 2 |\n");
    const before = table.state.doc.toString();
    caretBefore(table, "a");
    backspace(table);
    expect(table.state.doc.toString()).toBe(before);
  });

  it("does nothing when the editor is read-only", async () => {
    const view = await open("> quote\n", false);
    caretBefore(view, "quote");
    backspace(view);
    expect(view.state.doc.toString()).toBe('doc(blockquote(paragraph("quote")))');
  });
});

describe("Backspace in an emptied list item that holds nested items", () => {
  it("removes the empty item and moves its nested items into its place", async () => {
    const view = await open("Before\n\n- a\n  - b\n  - c\n\nAfter\n");
    emptyParagraphOf(view, "a");
    backspace(view);
    expect(markdownOf()).toBe("Before\n\n- b\n- c\n\nAfter");
    expect(view.state.selection.$from.parent.textContent).toBe("b");
  });

  it("works when the list opens the document", async () => {
    const view = await open("- a\n  - b\n");
    emptyParagraphOf(view, "a");
    backspace(view);
    expect(markdownOf()).toBe("- b");
  });

  it("keeps its siblings and their order", async () => {
    const view = await open("- x\n- a\n  - b\n- y\n");
    emptyParagraphOf(view, "a");
    backspace(view);
    expect(markdownOf()).toBe("- x\n- b\n- y");
  });

  it("gives the moved items the outer list's kind", async () => {
    const view = await open("1. a\n   - b\n2. y\n");
    emptyParagraphOf(view, "a");
    backspace(view);
    expect(markdownOf()).toBe("1. b\n2. y");
  });

  it("is one undo step", async () => {
    const view = await open("- a\n  - b\n");
    emptyParagraphOf(view, "a");
    const emptied = view.state.doc.toString();
    backspace(view);
    undo(view.state, view.dispatch);
    expect(view.state.doc.toString()).toBe(emptied);
  });

  it("leaves an item without nested items to the list's own Backspace", async () => {
    const plain = await open("- a\n");
    emptyParagraphOf(plain, "a");
    backspace(plain);
    expect(plain.state.doc.toString()).toBe("doc(paragraph)");
  });
});

describe("Backspace at the start of a list's first item that holds nested items", () => {
  it("lifts its text to a paragraph before the list, as an item without nested items is lifted", async () => {
    const view = await open("Before\n\n- a\n  - b\n");
    caretBefore(view, "a");
    backspace(view);
    expect(markdownOf()).toBe("Before\n\na\n\n- b");
    expect(view.state.selection.$from.parent.textContent).toBe("a");
    expect(view.state.selection.$from.parentOffset).toBe(0);
  });

  it("works when the list opens the document, for a task item, and inside a quote", async () => {
    const start = await open("- a\n  - b\n");
    caretBefore(start, "a");
    backspace(start);
    expect(markdownOf()).toBe("a\n\n- b");

    const task = await open("- [ ] a\n  - b\n");
    caretBefore(task, "a");
    backspace(task);
    expect(markdownOf()).toBe("a\n\n- b");

    const quoted = await open("> q\n>\n> - a\n>   - b\n");
    caretBefore(quoted, "a");
    backspace(quoted);
    expect(quoted.state.doc.toString()).toBe('doc(blockquote(paragraph("q"), paragraph("a"), bullet_list(list_item(paragraph("b")))))');
  });

  it("does not merge into a code block before the list", async () => {
    const view = await open("```\nc\n```\n\n- a\n  - b\n");
    caretBefore(view, "a");
    backspace(view);
    expect(view.state.doc.toString()).toBe('doc(code_block("c"), paragraph("a"), bullet_list(list_item(paragraph("b"))))');
  });

  it("keeps the item's inline content and the list's later items", async () => {
    const view = await open("- **a**\n  - b\n- y\n");
    caretBefore(view, "a");
    backspace(view);
    expect(markdownOf()).toBe("**a**\n\n- b\n- y");
  });

  it("is one undo step", async () => {
    const view = await open("- a\n  - b\n");
    const before = view.state.doc.toString();
    caretBefore(view, "a");
    backspace(view);
    undo(view.state, view.dispatch);
    expect(view.state.doc.toString()).toBe(before);
  });

  it("leaves a later item to the list's join into the item above", async () => {
    const view = await open("- x\n- a\n  - b\n");
    caretBefore(view, "a");
    backspace(view);
    expect(view.state.doc.toString()).toBe('doc(bullet_list(list_item(paragraph("x"), paragraph("a"), bullet_list(list_item(paragraph("b"))))))');
  });
});
