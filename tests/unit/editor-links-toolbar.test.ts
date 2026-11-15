// @vitest-environment jsdom
import { editorViewCtx } from "@milkdown/kit/core";
import { TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMarkdownEditor, type MarkdownEditor } from "@/components/knowledge/editor/editor-core";
import { selectionToolbar } from "@/components/knowledge/editor/selection-toolbar";
import { extractDocumentLinks } from "@/modules/knowledge/domain/document-links";
import { LINK_MARKDOWN_FIXTURES } from "../fixtures/link-markdown";

// Decisions 9, 11, 12, 13 of the Notion-parity spec: ⌘K, the link card, a pasted URL, the toolbar's new buttons.
const rect = { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => rect;
const opened: MarkdownEditor[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const editor of opened.splice(0)) await editor.destroy(); document.body.innerHTML = ""; });

async function open(markdown: string) {
  const root = document.body.appendChild(document.createElement("div"));
  const toolbar = selectionToolbar();
  const editor = await createMarkdownEditor({
    root, markdown, className: "kh-editor", ariaLabel: "Content", editable: true, onUserEdit: () => {}, onMarkdown: () => {}, allowImage: () => false,
    extraPlugins: toolbar.plugins, configure: toolbar.configure,
  });
  opened.push(editor);
  const view = editor.action(ctx => ctx.get(editorViewCtx));
  view.dom.focus();
  // The toolbar joins the document on the first update.
  view.dispatch(view.state.tr);
  return { editor, view };
}
const select = (view: EditorView, from: number, to = from) => view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)));
const card = () => document.querySelector<HTMLElement>(".kh-link-card");
const cardShown = () => card()?.dataset.show === "true";
const toolbarEl = () => document.querySelector<HTMLElement>(".kh-selection-toolbar")!;
const keydown = (target: HTMLElement, init: KeyboardEventInit) => {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
};
function paste(view: EditorView, text: string) {
  const event = new Event("paste", { bubbles: true, cancelable: true }) as ClipboardEvent;
  Object.defineProperty(event, "clipboardData", { value: { getData: (type: string) => (type === "text/plain" ? text : "") } });
  view.dom.dispatchEvent(event);
  return event;
}

describe("the toolbar's new buttons", () => {
  it("strikes through, codes and makes Heading 3, with active states", async () => {
    const { editor, view } = await open("some text\n");
    select(view, 1, 5);
    const press = (label: string) => toolbarEl().querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
    press("Strikethrough").click();
    expect(editor.getMarkdown()).toBe("~~some~~ text\n");
    expect(press("Strikethrough").getAttribute("aria-pressed")).toBe("true");
    press("Strikethrough").click();
    press("Inline code").click();
    expect(editor.getMarkdown()).toBe("`some` text\n");
    expect(press("Inline code").getAttribute("aria-pressed")).toBe("true");
    press("Inline code").click();
    press("Heading 3").click();
    expect(editor.getMarkdown()).toBe("### some text\n");
    expect(press("Heading 3").getAttribute("aria-pressed")).toBe("true");
  });
});

describe("⌘K over a selection (9)", () => {
  it("opens the link field and handles the event, so the palette's listener yields", async () => {
    const { view } = await open("some text\n");
    select(view, 1, 5);
    const event = keydown(view.dom, { key: "k", metaKey: true });
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(toolbarEl().querySelector("input"));
  });
  it("leaves the event alone with no selection, for the palette", async () => {
    const { view } = await open("some text\n");
    select(view, 3);
    expect(keydown(view.dom, { key: "k", ctrlKey: true }).defaultPrevented).toBe(false);
  });
});

describe("a URL pasted over a selection (12)", () => {
  it("links the selection and keeps its text", async () => {
    const { editor, view } = await open("some text\n");
    select(view, 1, 5);
    expect(paste(view, "https://example.com/a?b=1").defaultPrevented).toBe(true);
    expect(editor.getMarkdown()).toBe("[some](https://example.com/a?b=1) text\n");
  });
  it.each(["https://example.com and more", "example.com", "ftp://example.com", "https://a.com\nhttps://b.com", "[x](https://a.com)"])("pastes %j as it did", async (text) => {
    const { editor, view } = await open("some text\n");
    select(view, 1, 5);
    paste(view, text);
    expect(editor.getMarkdown()).not.toContain("[some](");
  });
  it("is unchanged with no selection", async () => {
    const { editor, view } = await open("some text\n");
    select(view, 3);
    paste(view, "https://example.com");
    expect(editor.getMarkdown()).not.toContain("](");
  });
  it("keeps wikilinks through a link paste", async () => {
    for (const fixture of LINK_MARKDOWN_FIXTURES) {
      const { editor, view } = await open(`${fixture.markdown}\n\nplain words\n`);
      const end = view.state.doc.content.size;
      select(view, end - 11, end - 6);
      paste(view, "https://example.com");
      const shape = (markdown: string) => extractDocumentLinks(markdown).map((link) => ({ ...link, line: 0 }));
      expect(shape(editor.getMarkdown())).toEqual(expect.arrayContaining(shape(fixture.markdown)));
    }
  });
});

describe("the link card (11)", () => {
  const MD = "plain [site](https://example.com) end\n";
  // doc positions: paragraph starts at 1; "plain " is 6 chars, link text is 4
  const IN_LINK = 9;

  it("shows for a caret that enters the link, and hides when it leaves", async () => {
    const { view } = await open(MD);
    select(view, 2);
    expect(cardShown()).toBe(false);
    select(view, IN_LINK);
    expect(cardShown()).toBe(true);
    expect(card()!.textContent).toContain("https://example.com");
    select(view, 3);
    expect(cardShown()).toBe(false);
  });
  it("does not show while typing inside the link", async () => {
    const { view } = await open(MD);
    select(view, 2);
    select(view, IN_LINK);
    select(view, 3);
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, IN_LINK)).insertText("x"));
    expect(cardShown()).toBe(false);
  });
  it("closes on Escape before the block-selecting binding, and selects no block", async () => {
    const { view } = await open(MD);
    select(view, IN_LINK);
    expect(cardShown()).toBe(true);
    const event = keydown(view.dom, { key: "Escape" });
    expect(cardShown()).toBe(false);
    expect(event.defaultPrevented).toBe(true);
    expect(view.dom.querySelector(".ProseMirror-selectednode")).toBeNull();
    // A second Escape, with no card, is Task 1's: it selects the block.
    keydown(view.dom, { key: "Escape" });
    expect(view.dom.querySelector(".ProseMirror-selectednode")).not.toBeNull();
  });
  it("Open uses a new tab with noopener and noreferrer", async () => {
    const open_ = vi.spyOn(window, "open").mockImplementation(() => null);
    const { view } = await open(MD);
    select(view, IN_LINK);
    card()!.querySelector<HTMLButtonElement>("button[aria-label='Open link']")!.click();
    expect(open_).toHaveBeenCalledWith("https://example.com", "_blank", "noopener,noreferrer");
  });
  it("Remove unlinks the whole link and keeps the text", async () => {
    const { editor, view } = await open(MD);
    select(view, IN_LINK);
    card()!.querySelector<HTMLButtonElement>("button[aria-label='Remove link']")!.click();
    expect(editor.getMarkdown()).toBe("plain site end\n");
    expect(cardShown()).toBe(false);
  });
  it("Edit opens the toolbar's link field with the address, and saving rewrites it", async () => {
    const { editor, view } = await open(MD);
    select(view, IN_LINK);
    card()!.querySelector<HTMLButtonElement>("button[aria-label='Edit link']")!.click();
    const input = toolbarEl().querySelector<HTMLInputElement>("input")!;
    expect(input.value).toBe("https://example.com");
    expect(document.activeElement).toBe(input);
    expect(cardShown()).toBe(false);
    input.value = "https://example.org";
    keydown(input, { key: "Enter" });
    expect(editor.getMarkdown()).toBe("plain [site](https://example.org) end\n");
  });
  it("is not shown for a wikilink", async () => {
    const { view } = await open("a [[Other]] b\n");
    select(view, 1);
    select(view, 2);
    expect(cardShown()).toBe(false);
  });
});
