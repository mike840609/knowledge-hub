// @vitest-environment jsdom
import { editorViewCtx } from "@milkdown/kit/core";
import { TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { afterEach, expect, it } from "vitest";
import { createMarkdownEditor, type MarkdownEditor } from "@/components/knowledge/editor/editor-core";
import { emojiSuggest } from "@/components/knowledge/editor/emoji-suggest";
import { emojiMatches } from "@/lib/emoji-catalog";

const rect = { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => rect;
const opened: MarkdownEditor[] = [];
afterEach(async () => {
  for (const editor of opened.splice(0)) await editor.destroy();
  document.body.innerHTML = "";
});
async function open(markdown = "") {
  const root = document.body.appendChild(document.createElement("div"));
  const emoji = emojiSuggest();
  const editor = await createMarkdownEditor({
    root, markdown, className: "kh-editor", ariaLabel: "Content", editable: true,
    onUserEdit() {}, onMarkdown() {}, allowImage: () => false,
    extraPlugins: emoji.plugins, configure: emoji.configure,
  });
  opened.push(editor);
  const view = editor.action((ctx) => ctx.get(editorViewCtx));
  view.focus();
  return { root, editor, view };
}
const menu = () => document.querySelector<HTMLElement>(".kh-emoji-menu")!;
const rows = () => [...menu().querySelectorAll<HTMLElement>("[role='option']")];
const type = (view: EditorView, text: string) => {
  for (const character of text) {
    const { from, to } = view.state.selection;
    if (!view.someProp("handleTextInput", (handler) => handler(view, from, to, character, () => view.state.tr.insertText(character, from, to)))) {
      view.dispatch(view.state.tr.insertText(character, from, to));
    }
  }
};
const key = (view: EditorView, name: string, init: KeyboardEventInit = {}) => {
  const event = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init });
  Object.defineProperty(event, "keyCode", { value: name === "Enter" ? 13 : name === "Escape" ? 27 : name === "ArrowDown" ? 40 : name === "ArrowUp" ? 38 : 0 });
  view.dom.dispatchEvent(event);
  return event;
};

// Launcher audit (2026-11-18): Notion's `:shortcode:` habit had no equivalent in the editor.
it("offers emoji after a colon and inserts the chosen one", async () => {
  const { editor, view } = await open();
  type(view, ":sm");
  expect(menu().hidden).toBe(false);
  expect(rows().length).toBeGreaterThan(0);
  expect(view.dom.getAttribute("aria-expanded")).toBe("true");
  const first = emojiMatches("sm")[0];
  expect(rows()[0].textContent).toContain(first.name);
  key(view, "Enter");
  expect(menu().hidden).toBe(true);
  expect(view.state.doc.textContent).toBe(first.char);
  expect(editor.getMarkdown()).toContain(first.char);
  expect(editor.getMarkdown()).not.toContain(":sm");
});

it("moves through the list with the arrow keys", async () => {
  const { view } = await open();
  type(view, ":sm");
  const second = emojiMatches("sm")[1];
  key(view, "ArrowDown");
  key(view, "Enter");
  expect(view.state.doc.textContent).toBe(second.char);
});

it("announces the listbox it controls and the active option", async () => {
  const { view } = await open();
  type(view, ":sm");
  expect(view.dom.getAttribute("aria-controls")).toBe(menu().id);
  expect(menu().id).not.toBe("");
  const active = menu().querySelector('[aria-selected="true"]')!;
  expect(view.dom.getAttribute("aria-activedescendant")).toBe(active.id);
});

it("leaves Shift-Tab to the editor while the list is open", async () => {
  const { view } = await open("- item\n");
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 4)));
  type(view, ":sm");
  key(view, "Tab", { shiftKey: true });
  expect(menu().hidden).toBe(true);
  expect(view.state.doc.textContent).toContain(":sm");
});

it("converts after a CJK character, where a space is not written", async () => {
  const { view } = await open("中文");
  view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)));
  type(view, ":grinning_face: ");
  expect(view.state.doc.textContent).toBe("中文😀 ");
});

it("converts the longest shortcode the catalog has", async () => {
  const { view } = await open();
  type(view, ":grinning_face_with_smiling_eyes: ");
  expect(view.state.doc.textContent).toBe("😄 ");
});

it("opens after a CJK character, where a space is not written", async () => {
  const { view } = await open("中文");
  view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)));
  type(view, ":sm");
  expect(menu().hidden).toBe(false);
});

it("opens at the end of a very long paragraph", async () => {
  const { view } = await open("a".repeat(200));
  view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)));
  type(view, " :sm");
  expect(menu().hidden).toBe(false);
});

it("closes on Escape without inserting anything", async () => {
  const { editor, view } = await open();
  type(view, ":sm");
  key(view, "Escape");
  expect(menu().hidden).toBe(true);
  expect(editor.getMarkdown()).toBe(":sm\n");
});

it("converts a fully typed :shortcode: on the space, keeping the space", async () => {
  const { editor, view } = await open();
  type(view, ":grinning_face: ");
  expect(editor.getMarkdown()).toBe("😀 \n");
  type(view, "next");
  expect(editor.getMarkdown()).toBe("😀 next\n");
});

it("converts as its own undo step, back to the typed code", async () => {
  const { view } = await open();
  const { undo } = await import("@milkdown/kit/prose/history");
  type(view, ":grinning_face: ");
  undo(view.state, view.dispatch);
  expect(view.state.doc.textContent).toBe(":grinning_face:");
});

it("takes a Traditional Chinese keyword too", async () => {
  const { editor, view } = await open();
  type(view, ":微笑: ");
  expect(editor.getMarkdown()).not.toContain(":微笑:");
  expect(editor.getMarkdown()).toMatch(/\p{Extended_Pictographic}/u);
});

it.each(["12", "see http://", "a@b"])("does not open after a word character: %j", async (prefix) => {
  const { view } = await open(prefix);
  view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)));
  type(view, ":smi");
  expect(menu().hidden).toBe(true);
  expect(view.state.doc.textContent).toBe(`${prefix}:smi`);
});

it("does not convert a code after a word character", async () => {
  const { view } = await open("x");
  view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)));
  type(view, ":grinning_face: ");
  expect(view.state.doc.textContent).toBe("x:grinning_face: ");
});

it("does not open in inline code or in a code block", async () => {
  const inline = await open("text");
  inline.view.dispatch(inline.view.state.tr.insertText(":sm"));
  // Select the typed text and make it inline code, then put the caret at its end.
  inline.view.dispatch(inline.view.state.tr.addMark(1, 4, inline.view.state.schema.marks.inlineCode.create()));
  inline.view.dispatch(inline.view.state.tr.setSelection(TextSelection.create(inline.view.state.doc, 4)));
  expect(menu().hidden).toBe(true);

  const code = await open("```\ncode\n```\n");
  code.view.dispatch(code.view.state.tr.setSelection(TextSelection.create(code.view.state.doc, 4)));
  type(code.view, ":sm");
  expect(menu().hidden).toBe(true);
});

// Review (2026-11-17): a caret placed at the end of text already there (`備註:ok`) must not open
// the list, or its Enter and arrows would rewrite what the writer did not just type.
it("does not open on a caret placed after an existing colon word; Enter and arrows stay the editor's", async () => {
  const { editor, view } = await open("備註:ok\n\nsecond line");
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 6)));
  expect(menu().hidden).toBe(true);
  expect(key(view, "ArrowDown").defaultPrevented).toBe(false);
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 6)));
  key(view, "Enter");
  expect(editor.getMarkdown()).not.toContain("🆗");
  expect(editor.getMarkdown()).toContain("備註:ok");
  // Typing there is a fresh trigger: the list answers the writer's own keys.
  type(view, " :ok");
  expect(menu().hidden).toBe(false);
});
