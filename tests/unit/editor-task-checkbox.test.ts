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

async function open(markdown: string, editable = true) {
  const root = document.body.appendChild(document.createElement("div"));
  const editor = await createMarkdownEditor({ root, markdown, className: "kh-editor", ariaLabel: "Content", editable, onUserEdit() {}, onMarkdown() {}, allowImage: () => false, extraPlugins: [taskCheckbox()] });
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

// Review finding (2026-11-17): decorations render in a read-only editor too, so a revision
// snapshot showed a focusable checkbox that could not be pressed.
it("offers no control at all when the document opens read-only", async () => {
  const { root, editor } = await open("- [ ] First\n", false);
  expect(boxes(root)).toHaveLength(0);
  expect(root.querySelector(".kh-task-toggle")).not.toBeNull();
  editor.setEditable(true);
  expect(boxes(root)).toHaveLength(1);
});

it("turns its control inert when the editor becomes read-only, and live again", async () => {
  const { root, editor } = await open("- [ ] First\n");
  expect(boxes(root)).toHaveLength(1);
  editor.setEditable(false);
  expect(boxes(root)).toHaveLength(0);
  const before = editor.getMarkdown();
  root.querySelector<HTMLElement>(".kh-task-toggle")!.click();
  expect(editor.getMarkdown()).toBe(before);
  editor.setEditable(true);
  expect(boxes(root)).toHaveLength(1);
});

it("keeps focus on the control after a keyboard tick", async () => {
  const { root } = await open("- [ ] First\n");
  const box = boxes(root)[0];
  box.focus();
  box.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true }));
  expect(document.activeElement?.getAttribute("role")).toBe("checkbox");
  expect(document.activeElement?.getAttribute("aria-checked")).toBe("true");
});

// Review (2026-11-17): a key on a focused box ran the editor's keymap against the hidden caret.
it("keeps keys pressed on a focused checkbox away from the editor's keymap", async () => {
  const { root, editor, view } = await open("Para\n\n- [ ] First\n- [ ] Second\n");
  const { TextSelection } = await import("@milkdown/kit/prose/state");
  let second = 0;
  view.state.doc.descendants((node, pos) => { if (node.isText && node.text === "Second") second = pos; });
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, second)));
  const box = boxes(root)[0];
  box.focus();
  box.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", keyCode: 8, bubbles: true, cancelable: true }));
  expect(editor.getMarkdown()).toBe("Para\n\n- [ ] First\n- [ ] Second\n");
});
