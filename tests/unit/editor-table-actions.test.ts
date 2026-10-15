// @vitest-environment jsdom
import { editorViewCtx } from "@milkdown/kit/core";
import { undo } from "@milkdown/kit/prose/history";
import { TextSelection } from "@milkdown/kit/prose/state";
import { afterEach, expect, it } from "vitest";
import { createMarkdownEditor, type MarkdownEditor } from "@/components/knowledge/editor/editor-core";
import { tableActions } from "@/components/knowledge/editor/table-actions";

Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();
const editors: MarkdownEditor[] = [];
afterEach(async () => {
  for (const editor of editors.splice(0)) await editor.destroy();
  document.body.innerHTML = "";
});
const button = (name: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!;
async function open() {
  const root = document.body.appendChild(document.createElement("div"));
  const editor = await createMarkdownEditor({
    root, markdown: "Before\n\n| A | B |\n| - | - |\n| one | two |\n| three | four |\n\nAfter",
    className: "kh-editor", ariaLabel: "Content", editable: true,
    onUserEdit() {}, onMarkdown() {}, allowImage: () => false, extraPlugins: [tableActions()],
  });
  editors.push(editor);
  const view = editor.action(ctx => ctx.get(editorViewCtx));
  let pos = 0;
  view.state.doc.descendants((node, position) => {
    if (node.isText && node.text === "one") pos = position;
  });
  view.focus();
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)));
  return { root, editor, view };
}
it.each(["Delete row", "Delete column", "Delete table"])("%s changes the table and can be undone", async (action) => {
  const { root, editor, view } = await open();
  const original = editor.getMarkdown();
  expect(document.querySelector<HTMLElement>(".kh-table-actions")!.hidden).toBe(false);
  button(action).click();
  expect(editor.getMarkdown()).toContain("Before");
  expect(editor.getMarkdown()).toContain("After");
  expect(editor.getMarkdown()).not.toContain("one");
  if (action === "Delete table") {
    expect(root.querySelector("table")).toBeNull();
    expect(document.querySelector<HTMLElement>(".kh-table-actions")!.hidden).toBe(true);
  } else if (action === "Delete row") {
    expect(root.querySelectorAll("tr")).toHaveLength(2);
    expect(editor.getMarkdown()).toContain("three");
  } else {
    expect(root.querySelectorAll("th")).toHaveLength(1);
    expect(editor.getMarkdown()).toContain("two");
  }
  expect(undo(view.state, view.dispatch)).toBe(true);
  expect(editor.getMarkdown()).toBe(original);
});
it("does not mutate a read-only table and cleans up controls", async () => {
  const { editor } = await open();
  const original = editor.getMarkdown();
  editor.setEditable(false);
  button("Delete table").click();
  expect(editor.getMarkdown()).toBe(original);
  await editor.destroy();
  editors.pop();
  expect(document.querySelector(".kh-table-actions")).toBeNull();
});
