// @vitest-environment jsdom
import { editorViewCtx } from "@milkdown/kit/core";
import { TextSelection } from "@milkdown/kit/prose/state";
import { afterEach, describe, expect, it } from "vitest";
import { createMarkdownEditor, type MarkdownEditor } from "@/components/knowledge/editor/editor-core";

// Layout is not something jsdom has; zero-sized answers are enough here, as in the toolbar tests.
const noRect = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) } as DOMRect;
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => noRect;

const opened: MarkdownEditor[] = [];
afterEach(async () => {
  while (opened.length) await opened.pop()!.destroy();
  document.body.innerHTML = "";
});

async function open(markdown: string): Promise<MarkdownEditor> {
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
    allowImage: () => false,
  });
  opened.push(editor);
  return editor;
}

function dom(editor: MarkdownEditor): HTMLElement {
  return editor.action((ctx) => ctx.get(editorViewCtx).dom as HTMLElement);
}
function lastChildName(editor: MarkdownEditor): string | null {
  return editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    return view.state.doc.lastChild?.type.name ?? null;
  });
}
function selectionParentName(editor: MarkdownEditor): string {
  return editor.action((ctx) => ctx.get(editorViewCtx).state.selection.$from.parent.type.name);
}
function caretAtEnd(editor: MarkdownEditor) {
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)));
  });
}
function caretAtCodeEnd(editor: MarkdownEditor) {
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    let codeEnd = -1;
    view.state.doc.descendants((node, pos) => {
      if (node.type.name === "code_block") codeEnd = pos + node.nodeSize - 1;
    });
    view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(codeEnd))));
  });
}
function arrowDown(editor: MarkdownEditor, init: KeyboardEventInit = {}) {
  dom(editor).dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true, ...init }));
}

describe("leaving a trailing code block", () => {
  const markdown = "text\n\n```js\ncode\n```\n";

  it("lands in a new paragraph below, without touching the Markdown", async () => {
    const editor = await open(markdown);
    caretAtEnd(editor);
    arrowDown(editor);
    expect(lastChildName(editor)).toBe("paragraph");
    expect(selectionParentName(editor)).toBe("paragraph");
    expect(editor.getMarkdown()).toBe(markdown);
  });

  it("stays inside the code in the middle of it", async () => {
    const editor = await open(markdown);
    caretAtCodeEnd(editor);
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(10))));
    });
    arrowDown(editor);
    expect(lastChildName(editor)).toBe("code_block");
    expect(selectionParentName(editor)).toBe("code_block");
    expect(editor.getMarkdown()).toBe(markdown);
  });

  it("leaves a non-trailing code block to the default movement", async () => {
    const editor = await open("```js\ncode\n```\n\ntail\n");
    caretAtCodeEnd(editor);
    arrowDown(editor);
    expect(lastChildName(editor)).toBe("paragraph");
    expect(editor.getMarkdown()).toBe("```js\ncode\n```\n\ntail\n");
  });

  it("does not hijack Shift+ArrowDown", async () => {
    const editor = await open(markdown);
    caretAtEnd(editor);
    arrowDown(editor, { shiftKey: true });
    expect(lastChildName(editor)).toBe("code_block");
    expect(editor.getMarkdown()).toBe(markdown);
  });
});
