// @vitest-environment jsdom
import { editorViewCtx } from "@milkdown/kit/core";
import { afterEach, expect, it } from "vitest";
import { createMarkdownEditor, type MarkdownEditor } from "@/components/knowledge/editor/editor-core";
import { taskCheckbox } from "@/components/knowledge/editor/task-checkbox";

const rect = { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => rect;
const opened: MarkdownEditor[] = [];
afterEach(async () => {
  for (const editor of opened.splice(0)) await editor.destroy();
  document.body.innerHTML = "";
});

async function open(markdown: string) {
  const root = document.body.appendChild(document.createElement("div"));
  const editor = await createMarkdownEditor({ root, markdown, className: "kh-editor", ariaLabel: "Content", editable: true, onUserEdit() {}, onMarkdown() {}, allowImage: () => false, extraPlugins: [taskCheckbox()] });
  opened.push(editor);
  return { root, editor, view: editor.action((ctx) => ctx.get(editorViewCtx)) };
}

const boxes = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>("[role='checkbox']")];

// Launcher audit: the editor drew a to-do's checkbox with `::before`, so it had no control to press.
// A to-do list that cannot be ticked in the editor is a list that can only be finished in Markdown.
it("ticks a to-do from its checkbox, and the Markdown follows", async () => {
  const { root, editor } = await open("- [ ] First\n- [x] Second\n");
  expect(boxes(root).map((box) => box.getAttribute("aria-checked"))).toEqual(["false", "true"]);
  boxes(root)[0].click();
  expect(editor.getMarkdown()).toContain("- [x] First");
  expect(boxes(root)[0].getAttribute("aria-checked")).toBe("true");
  boxes(root)[1].click();
  expect(editor.getMarkdown()).toContain("- [ ] Second");
});

it("names the action for a screen reader and toggles it from the keyboard", async () => {
  const { root, editor } = await open("- [ ] First\n");
  const box = boxes(root)[0];
  expect(box.getAttribute("aria-label")).toBe("Mark task complete");
  box.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true }));
  expect(editor.getMarkdown()).toContain("- [x] First");
  expect(boxes(root)[0].getAttribute("aria-label")).toBe("Mark task incomplete");
  expect(boxes(root)[0].getAttribute("aria-checked")).toBe("true");
});

it("is one undo step, and only on a real to-do", async () => {
  const { root, editor, view } = await open("- [ ] First\n- Second\n");
  boxes(root)[0].click();
  editor.action((ctx) => ctx.get(editorViewCtx));
  // The undo history is the editor's: one step puts the item back.
  const { undo } = await import("@milkdown/kit/prose/history");
  undo(view.state, view.dispatch);
  expect(editor.getMarkdown()).toContain("- [ ] First");
  // A plain bullet has no checkbox.
  expect(boxes(root)).toHaveLength(1);
});
