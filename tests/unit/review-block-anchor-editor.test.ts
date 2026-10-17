// @vitest-environment jsdom
import { afterEach, expect, test } from "vitest";
import { editorViewCtx } from "@milkdown/kit/core";
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
