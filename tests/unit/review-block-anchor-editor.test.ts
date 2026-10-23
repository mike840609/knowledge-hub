// @vitest-environment jsdom
import { afterEach, expect, test } from "vitest";
import { editorViewCtx } from "@milkdown/kit/core";
import { TextSelection } from "@milkdown/kit/prose/state";
import { createMarkdownEditor, type MarkdownEditor } from "@/components/knowledge/editor/editor-core";
import { editorReviewPathsPlugin, updateEditorReviewPaths } from "@/components/knowledge/editor/review-paths";
import { reviewBlockAnchor, selectionAnchorInBlock } from "@/components/knowledge/review-selection";

const opened: MarkdownEditor[] = [];
afterEach(async () => {
  while (opened.length) await opened.pop()!.destroy();
  document.body.innerHTML = "";
});

test("a selection in the real editor narrows the block button anchor", async () => {
  const markdown = `${"filler ".repeat(120)}target words here.\n`;
  const frame = document.createElement("div");
  frame.setAttribute("data-review-document", "");
  document.body.appendChild(frame);
  const host = document.createElement("div");
  frame.appendChild(host);
  const editor = await createMarkdownEditor({
    root: host, markdown, className: "kh-editor", ariaLabel: "Content",
    editable: true, onUserEdit: () => {}, onMarkdown: () => {}, allowImage: () => false,
    extraPlugins: [editorReviewPathsPlugin],
  });
  opened.push(editor);
  const view = editor.action(ctx => ctx.get(editorViewCtx));
  expect(updateEditorReviewPaths(view, markdown)).toBe(true);
  const paragraph = view.dom.querySelector("p")!;
  expect(paragraph.getAttribute("data-review-path")).toBe("0");
  const block = reviewBlockAnchor(paragraph, markdown)!;
  expect([...block.exact]).toHaveLength(512);
  const text = paragraph.firstChild as Text;
  const start = text.data.indexOf("target words");
  const range = document.createRange();
  range.setStart(text, start);
  range.setEnd(text, start + "target words".length);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  const narrowed = selectionAnchorInBlock(frame, markdown, block, selection);
  expect(narrowed?.exact).toBe("target words");
  expect(narrowed?.blockPath).toEqual(block.blockPath);
});

async function rendered(markdown: string) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const editor = await createMarkdownEditor({
    root: host, markdown, className: "kh-editor", ariaLabel: "Content",
    editable: true, onUserEdit: () => {}, onMarkdown: () => {}, allowImage: () => false,
    extraPlugins: [editorReviewPathsPlugin],
  });
  opened.push(editor);
  return editor.action(ctx => ctx.get(editorViewCtx));
}

test("the real editor stamps around a footnote reference, and its paragraph takes a comment", async () => {
  const markdown = "Safe\n\nA note[^1] here.\n\nSafe\n\n[^1]: The note.\n";
  const view = await rendered(markdown);
  expect(view.dom.querySelector('sup[data-type="footnote_reference"]')).not.toBeNull();
  expect(updateEditorReviewPaths(view, markdown)).toBe(true);
  const paragraphs = [...view.dom.querySelectorAll<HTMLElement>("p")];
  expect(paragraphs.map(p => p.getAttribute("data-review-path"))).toEqual(["0", "1", "2", "3.0"]);
  expect(reviewBlockAnchor(paragraphs[1], markdown)).toMatchObject({ blockPath: [1], exact: "A note here." });
});

test("the real editor: a comment's paragraph takes a comment, a <br>'s does not, both stay stamped", async () => {
  const markdown = "Safe\n\nOne <!-- c --> two.\n\nSafe\n\nOne<br>two.\n";
  const view = await rendered(markdown);
  expect(view.dom.querySelectorAll('span[data-type="html"]')).toHaveLength(2);
  expect(updateEditorReviewPaths(view, markdown)).toBe(true);
  const paragraphs = [...view.dom.querySelectorAll<HTMLElement>("p")];
  expect(paragraphs.map(p => p.getAttribute("data-review-path"))).toEqual(["0", "1", "2", "3"]);
  expect(reviewBlockAnchor(paragraphs[1], markdown)).toMatchObject({ blockPath: [1], exact: "One two." });
  expect(reviewBlockAnchor(paragraphs[3], markdown)).toBeNull();
});

test("the real editor drops a trailing hard break from the text it stamps", async () => {
  const markdown = "one\n\nSame\n\nSame";
  const view = await rendered(markdown);
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 4)).replaceSelectionWith(view.state.schema.nodes.hardbreak.create()));
  expect(view.dom.querySelector('p br[data-type="hardbreak"]')).not.toBeNull();
  expect(updateEditorReviewPaths(view, markdown)).toBe(true);
  const paragraphs = [...view.dom.children].filter((element): element is HTMLElement => element instanceof HTMLElement && element.tagName === "P");
  expect(paragraphs.map(p => p.getAttribute("data-review-path"))).toEqual(["0", "1", "2"]);
});

test("the real editor drops a trailing hard break in a cell too", async () => {
  const markdown = "| A |\n| --- |\n| one |\n\nSame\n\nSame";
  const view = await rendered(markdown);
  const text = view.dom.querySelector("td p")!.firstChild as Text;
  const pos = view.posAtDOM(text, text.length);
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)).replaceSelectionWith(view.state.schema.nodes.hardbreak.create()));
  expect(view.dom.querySelector('td br[data-type="hardbreak"]')).not.toBeNull();
  expect(updateEditorReviewPaths(view, markdown)).toBe(true);
  expect(view.dom.querySelector<HTMLElement>("td")!.getAttribute("data-review-path")).toBe("0.1.0");
  const paragraphs = [...view.dom.children].filter((element): element is HTMLElement => element instanceof HTMLElement && element.tagName === "P");
  expect(paragraphs.map(p => p.getAttribute("data-review-path"))).toEqual(["1", "2"]);
});
