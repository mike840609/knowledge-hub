// @vitest-environment jsdom
import { editorViewCtx } from "@milkdown/kit/core";
import { TextSelection } from "@milkdown/kit/prose/state";
import { afterEach, describe, expect, it } from "vitest";
import { createMarkdownEditor, type MarkdownEditor } from "@/components/knowledge/editor/editor-core";
import { convertBlockToDetails } from "@/components/knowledge/editor/details-toggle";

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
    expect(saved).toContain("<details>");
    expect(saved).toContain("<summary>Fold me</summary>");
    expect(saved).toContain("</details>");
    const reopened = await open(saved);
    expect(reopened.getMarkdown()).toBe(saved);
  });
  it("refuses outside paragraphs and headings", async () => {
    const editor = await open("```js\nconst a = 1;\n```");
    const v = view(editor);
    expect(convertBlockToDetails(v)).toBe(false);
  });
});
