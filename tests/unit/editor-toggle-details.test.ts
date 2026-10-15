// @vitest-environment jsdom
import { editorViewCtx } from "@milkdown/kit/core";
import { undo } from "@milkdown/kit/prose/history";
import { TextSelection } from "@milkdown/kit/prose/state";
import { afterEach, describe, expect, it } from "vitest";
import { createMarkdownEditor, type MarkdownEditor } from "@/components/knowledge/editor/editor-core";
import { convertBlockToDetails, flipNearestDetails } from "@/components/knowledge/editor/details-toggle";

// jsdom has no layout; undo scrolls the selection into view.
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }) as DOMRect;
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
  });
  opened.push(editor);
  return editor;
}

const view = (editor: MarkdownEditor) => editor.action((ctx) => ctx.get(editorViewCtx));

describe("toolbar conversion into a details disclosure", () => {
  it("turns the current paragraph into a toggle and keeps it through save and reopen", async () => {
    const editor = await open("Fold me");
    const v = view(editor);
    v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, 1)));
    expect(convertBlockToDetails(v)).toBe(true);
    const saved = editor.getMarkdown();
    expect(saved).toContain("<details open>");
    expect(saved).toContain("<summary>Fold me</summary>");
    expect(saved).toContain("</details>");
    const reopened = await open(saved);
    expect(reopened.getMarkdown()).toBe(saved);
  });
  it("is one undo step on each side: typed text before it and after it are undone separately", async () => {
    const editor = await open("");
    const v = view(editor);
    v.dispatch(v.state.tr.insertText("abc"));
    expect(convertBlockToDetails(v)).toBe(true);
    const converted = v.state.doc;
    v.dispatch(v.state.tr.insertText("x"));
    undo(v.state, v.dispatch);
    expect(v.state.doc.eq(converted)).toBe(true);
    undo(v.state, v.dispatch);
    expect(v.state.doc.textContent).toBe("abc");
  });
  it("refuses outside paragraphs and headings", async () => {
    const editor = await open("```js\nconst a = 1;\n```");
    const v = view(editor);
    expect(convertBlockToDetails(v)).toBe(false);
  });
  it("flips the open attribute at the caret and keeps it through reopen", async () => {
    const editor = await open("<details>\n<summary>More</summary>\n\nbody\n\n</details>\n");
    const v = view(editor);
    expect(flipNearestDetails(v, 1)).toBe(true);
    const saved = editor.getMarkdown();
    expect(saved).toContain("<details open>");
    const reopened = await open(saved);
    expect(reopened.getMarkdown()).toBe(saved);
  });
  it("flips back and ignores positions outside any toggle", async () => {
    const editor = await open("<details open>\n<summary>More</summary>\n\nbody\n\n</details>\n\ntail");
    const v = view(editor);
    const tail = editor.getMarkdown().length;
    expect(flipNearestDetails(v, tail)).toBe(false);
    expect(flipNearestDetails(v, 1)).toBe(true);
    expect(editor.getMarkdown()).not.toContain("<details open>");
  });
});

it('moves the caret to the visible summary when folding from the body', async () => {
  const editor = await open('<details open>\n<summary>Title</summary>\n\nbody\n\n</details>');
  const v = view(editor);
  let body = 0;
  v.state.doc.descendants((node, pos) => { if (node.type.name === 'paragraph') body = pos + 1; });
  v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, body)));
  expect(flipNearestDetails(v, body)).toBe(true);
  expect(v.state.selection.$from.parent.type.name).toBe('details_summary');
});
it('does not toggle a readonly editor', async () => {
  const editor = await open('<details open>\n<summary>Title</summary>\n\nbody\n\n</details>');
  editor.setEditable(false);
  expect(flipNearestDetails(view(editor), 1)).toBe(false);
});
