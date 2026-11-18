// @vitest-environment jsdom
import { editorViewCtx } from "@milkdown/kit/core";
import { TextSelection } from "@milkdown/kit/prose/state";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMarkdownEditor, type MarkdownEditor } from "@/components/knowledge/editor/editor-core";
import { RenderedEditor, type RenderedEditorProps } from "@/components/knowledge/editor/rendered-editor";
import { selectionToolbar } from "@/components/knowledge/editor/selection-toolbar";
import { turnEntry } from "@/components/knowledge/editor/block-gutter";
import { extractDocumentLinks } from "@/modules/knowledge/domain/document-links";

// Layout (floating-ui positioning, where the toolbar lands) is not something jsdom has, so
// nothing here asserts a position; the browser run in Task 3 covers that. These pin the DOM
// contract: button types, key routing, the link address, the blur rule, the pressed state.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has no layout, and its Range lacks the two geometry methods that ProseMirror's
// scroll-into-view and the tooltip's positioning call. Zero-sized answers are enough here.
const noRect = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) } as DOMRect;
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => noRect;

const opened: MarkdownEditor[] = [];
const mounted: Root[] = [];
afterEach(async () => {
  for (const root of mounted.splice(0)) act(() => root.unmount());
  while (opened.length) await opened.pop()!.destroy();
  document.body.innerHTML = "";
});

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
// The tooltip provider is throttled at 200ms; a selection made after the first update shows after it.
const throttleWindow = () => wait(260);

async function open(markdown: string, editable = true, comment?: Parameters<typeof selectionToolbar>[0]): Promise<MarkdownEditor> {
  const root = document.createElement("div");
  document.body.appendChild(root);
  const toolbar = selectionToolbar(comment);
  const editor = await createMarkdownEditor({
    root,
    markdown,
    className: "kh-editor",
    ariaLabel: "Content",
    editable,
    onUserEdit: () => {},
    onMarkdown: () => {},
    allowImage: () => false,
    extraPlugins: toolbar.plugins,
    configure: toolbar.configure,
  });
  opened.push(editor);
  return editor;
}

/** Focus the editor and select [from, to): the state in which the toolbar is meant to show. */
function select(editor: MarkdownEditor, from: number, to: number) {
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    view.dom.focus();
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)));
  });
}
function editorDom(editor: MarkdownEditor): HTMLElement {
  return editor.action((ctx) => ctx.get(editorViewCtx).dom as HTMLElement);
}

function toolbarElement(): HTMLElement {
  const element = document.querySelector<HTMLElement>(".kh-selection-toolbar");
  if (!element) throw new Error("the toolbar is not in the document");
  return element;
}
const button = (label: string) => toolbarElement().querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const linkBox = () => toolbarElement().querySelector<HTMLInputElement>("input")!;
const buttonRow = () => toolbarElement().children[0] as HTMLElement;

/** Mount the toolbar: it joins the document on the first ProseMirror update. */
function mountToolbar(editor: MarkdownEditor) {
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    view.dispatch(view.state.tr);
  });
}

function key(target: HTMLElement, init: KeyboardEventInit) {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

describe("the selection toolbar's DOM contract", () => {
  it("keeps a pending toolbar reveal when review metadata updates after selection", async () => {
    const editor = await open("hello world");
    mountToolbar(editor);
    await throttleWindow();
    // Selection and review decorations can update in the same tooltip throttle window.
    select(editor, 1, 1);
    select(editor, 7, 12);
    editor.action(ctx => {
      const view = ctx.get(editorViewCtx);
      view.dispatch(view.state.tr.setMeta("review-availability", true));
    });
    await throttleWindow();
    expect(toolbarElement().dataset.show).toBe("true");
  });

  it("offers Comment in the same toolbar only while commenting is available", async () => {
    let available = true;
    const run = vi.fn();
    const editor = await open("hello world", true, { available: () => available, run });
    select(editor, 1, 6);
    const comment = button("Comment on selection");
    expect(comment.type).toBe("button");
    expect(comment.parentElement!.hidden).toBe(false);
    comment.click();
    expect(run).toHaveBeenCalledTimes(1);
    expect(editor.getMarkdown()).toBe("hello world\n");
    available = false;
    mountToolbar(editor);
    expect(comment.parentElement!.hidden).toBe(true);
    comment.click();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("captures the final native range before Tab moves focus to formatting", async () => {
    const editor = await open("hello world");
    select(editor, 7, 10);
    const dom = editorDom(editor);
    const text = dom.querySelector("p")!.firstChild!;
    const range = document.createRange();
    range.setStart(text, 6);
    range.setEnd(text, 11);
    const native = document.getSelection()!;
    native.removeAllRanges();
    native.addRange(range);
    key(dom, { key: "Tab" });
    editor.action(ctx => {
      const view = ctx.get(editorViewCtx);
      expect(view.state.doc.textBetween(view.state.selection.from, view.state.selection.to)).toBe("world");
    });
    button("Bold").click();
    expect(editor.getMarkdown()).toBe("hello **world**\n");
  });
  it("makes every control a type=button, so pressing one cannot submit the composer's form", async () => {
    const editor = await open("some text\n");
    mountToolbar(editor);
    const buttons = [...buttonRow().querySelectorAll("button")];
    expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual([
      "Turn into, Text",
      "Bold",
      "Italic",
      "Strikethrough",
      "Inline code",
      "Link",
      "Clear formatting",
    ]);
    for (const b of buttons) expect(b.getAttribute("type")).toBe("button");
    expect(toolbarElement().getAttribute("role")).toBe("toolbar");
  });

  it("puts Comment on selection last, after every formatting control", async () => {
    const editor = await open("some text\n", true, { available: () => true, run: () => {} });
    mountToolbar(editor);
    expect([...buttonRow().querySelectorAll("button")].map((b) => b.getAttribute("aria-label"))).toEqual([
      "Turn into, Text",
      "Bold",
      "Italic",
      "Strikethrough",
      "Inline code",
      "Link",
      "Clear formatting",
      "Comment on selection",
    ]);
  });

  it("cancels mousedown on the buttons and on the toolbar's own padding, but not on the link box", async () => {
    const editor = await open("some text\n");
    mountToolbar(editor);
    const down = (target: HTMLElement) => {
      const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
      target.dispatchEvent(event);
      return event.defaultPrevented;
    };
    for (const b of toolbarElement().querySelectorAll("button")) expect(down(b)).toBe(true);
    expect(down(toolbarElement())).toBe(true);
    expect(down(linkBox())).toBe(false);
  });

  it("styles the pressed state on every button, and marks the active toggle", async () => {
    const editor = await open("**bold** text\n");
    mountToolbar(editor);
    for (const b of buttonRow().querySelectorAll("button")) {
      expect(b.className).toContain("aria-pressed:bg-kh-bg-selected");
      expect(b.className).toContain("aria-pressed:text-kh-text");
    }
    select(editor, 1, 5);
    expect(button("Bold").getAttribute("aria-pressed")).toBe("true");
    expect(button("Italic").getAttribute("aria-pressed")).toBe("false");
  });

  it("does nothing when a button is pressed while the view is not editable", async () => {
    const editor = await open("some text\n", false);
    mountToolbar(editor);
    select(editor, 1, 5);
    button("Bold").click();
    expect(editor.getMarkdown()).toBe("some text\n");
    editor.setEditable(true);
    button("Bold").click();
    expect(editor.getMarkdown()).toBe("**some** text\n");
  });

  it("takes the link address in a plain text box that cannot block the form's Save", async () => {
    const editor = await open("some text\n");
    mountToolbar(editor);
    const box = linkBox();
    expect(box.type).toBe("text");
    expect(box.getAttribute("inputmode")).toBe("url");
    expect(box.getAttribute("autocomplete")).toBe("off");
    expect(box.getAttribute("aria-label")).toBe("Link address");
  });

  it("stops Enter and Escape in the link box, and lets every other key, such as ⌘K, bubble", async () => {
    const editor = await open("some text\n");
    mountToolbar(editor);
    const reached: string[] = [];
    const listener = (event: KeyboardEvent) => reached.push(event.key);
    document.addEventListener("keydown", listener);
    try {
      key(linkBox(), { key: "Enter" });
      key(linkBox(), { key: "Escape" });
      expect(reached).toEqual([]);
      key(linkBox(), { key: "k", metaKey: true });
      key(linkBox(), { key: "a" });
      expect(reached).toEqual(["k", "a"]);
    } finally {
      document.removeEventListener("keydown", listener);
    }
  });

  it("ignores Enter while an input method is composing", async () => {
    const editor = await open("some text\n");
    mountToolbar(editor);
    select(editor, 1, 5);
    button("Link").click();
    const box = linkBox();
    box.value = "example.com";
    // Chrome flags the composing keydown; Safari reports it as keyCode 229 after compositionend.
    key(box, { key: "Enter", isComposing: true });
    key(box, { key: "Enter", keyCode: 229 });
    expect(editor.getMarkdown()).toBe("some text\n");
    expect(box.value).toBe("example.com");
    expect(buttonRow().className).toBe("hidden");
  });

  it("gives the link box focus and the buttons back on Escape without linking", async () => {
    const editor = await open("some text\n");
    mountToolbar(editor);
    select(editor, 1, 5);
    button("Link").click();
    expect(document.activeElement).toBe(linkBox());
    expect(buttonRow().className).toBe("hidden");
    linkBox().value = "example.com";
    key(linkBox(), { key: "Escape" });
    expect(buttonRow().className).not.toContain("hidden");
    expect(linkBox().value).toBe("");
    expect(editor.getMarkdown()).toBe("some text\n");
  });

  it.each([
    ["example.com", "https://example.com"],
    ["  example.com/a?b=1  ", "https://example.com/a?b=1"],
    ["https://example.com", "https://example.com"],
    ["http://example.com", "http://example.com"],
    ["/docs/a", "/docs/a"],
    ["#top", "#top"],
    ["mailto:me@example.com", "mailto:me@example.com"],
  ])("links %j to %j", async (typed, href) => {
    const editor = await open("some text\n");
    mountToolbar(editor);
    select(editor, 1, 5);
    button("Link").click();
    linkBox().value = typed;
    key(linkBox(), { key: "Enter" });
    expect(editor.getMarkdown()).toBe(`[some](${href}) text\n`);
  });

  it("links nothing for an empty address", async () => {
    const editor = await open("some text\n");
    mountToolbar(editor);
    select(editor, 1, 5);
    button("Link").click();
    linkBox().value = "   ";
    key(linkBox(), { key: "Enter" });
    expect(editor.getMarkdown()).toBe("some text\n");
    expect(buttonRow().className).not.toContain("hidden");
  });
});


describe("editing links", () => {
  const original = '[some **linked** text](https://example.com "Keep this title") after\n';

  async function editExisting() {
    const editor = await open(original);
    mountToolbar(editor);
    // Select only the bold word inside one link spanning three differently marked nodes.
    select(editor, 6, 12);
    button("Link").click();
    return editor;
  }

  it("opens the existing address without removing the link or changing the selection", async () => {
    const editor = await editExisting();
    expect(editor.getMarkdown()).toBe(original);
    expect(linkBox().value).toBe("https://example.com");
    expect(document.activeElement).toBe(linkBox());
    expect(buttonRow().className).toBe("hidden");
    for (const label of ["Open link", "Save link", "Remove link"]) {
      expect(button(label)?.type).toBe("button");
    }
    editor.action(ctx => {
      const { selection } = ctx.get(editorViewCtx).state;
      expect([selection.from, selection.to]).toEqual([6, 12]);
    });
  });

  it("saves the whole existing link while keeping its text, formatting, title and selection", async () => {
    const editor = await editExisting();
    linkBox().value = "updated.example/docs";
    button("Save link")?.click();
    expect(editor.getMarkdown()).toBe('[some **linked** text](https://updated.example/docs "Keep this title") after\n');
    expect(document.activeElement).toBe(editorDom(editor));
    editor.action(ctx => {
      const { selection } = ctx.get(editorViewCtx).state;
      expect([selection.from, selection.to]).toEqual([6, 12]);
    });
  });

  it("removes the whole selected link without removing text or other formatting", async () => {
    const editor = await editExisting();
    button("Remove link")?.click();
    expect(editor.getMarkdown()).toBe("some **linked** text after\n");
    expect(document.activeElement).toBe(editorDom(editor));
  });

  it("discards edits on Escape while preserving the original link", async () => {
    const editor = await editExisting();
    linkBox().value = "unsaved.example";
    key(linkBox(), { key: "Escape" });
    expect(editor.getMarkdown()).toBe(original);
    expect(buttonRow().className).not.toContain("hidden");
    expect(document.activeElement).toBe(editorDom(editor));
  });

  it("opens the address in a separate tab without changing the document", async () => {
    const openWindow = vi.spyOn(window, "open").mockImplementation(() => null);
    const editor = await editExisting();
    button("Open link")?.click();
    expect(openWindow).toHaveBeenCalledWith("https://example.com", "_blank", "noopener,noreferrer");
    expect(editor.getMarkdown()).toBe(original);
  });

  it("does not open an unsafe stored address", async () => {
    const openWindow = vi.spyOn(window, "open").mockImplementation(() => null);
    const editor = await open("[some](javascript:alert%281%29) text\n");
    mountToolbar(editor);
    select(editor, 1, 5);
    button("Link").click();
    expect(button("Open link")?.disabled).toBe(true);
    button("Open link")?.click();
    expect(openWindow).not.toHaveBeenCalled();
  });

  it("does not guess an address or mutate a selection spanning different links", async () => {
    const markdown = "[one](https://one.example) and [two](https://two.example)\n";
    const editor = await open(markdown);
    mountToolbar(editor);
    select(editor, 1, 12);
    expect(button("Link").disabled).toBe(true);
    button("Link").click();
    expect(editor.getMarkdown()).toBe(markdown);
    expect(buttonRow().className).not.toContain("hidden");
  });

  it("updates only the existing link when the selection also includes unlinked text", async () => {
    const editor = await open("plain [linked](https://example.com) after\n");
    mountToolbar(editor);
    select(editor, 1, 19);
    button("Link").click();
    linkBox().value = "updated.example";
    key(linkBox(), { key: "Enter" });
    expect(editor.getMarkdown()).toBe("plain [linked](https://updated.example) after\n");
  });

  it("keeps an existing link when Save receives an empty address", async () => {
    const editor = await editExisting();
    linkBox().value = "  ";
    button("Save link")?.click();
    expect(editor.getMarkdown()).toBe(original);
  });

  it("creates a new link with Save and keeps Remove unavailable", async () => {
    const editor = await open("some text\n");
    mountToolbar(editor);
    select(editor, 1, 5);
    button("Link").click();
    expect(button("Remove link")?.disabled).toBe(true);
    linkBox().value = "example.com";
    linkBox().dispatchEvent(new Event("input", { bubbles: true }));
    button("Save link")?.click();
    expect(editor.getMarkdown()).toBe("[some](https://example.com) text\n");
  });
});


// The H1-H3, list and Toggle buttons became one Turn into menu (2026-11-21 list-commands spec, decisions 5-7).
// What their tests pinned (a turn from the toolbar, which conversions it allows in a list) is pinned here,
// through the menu.
const turnButton = () => toolbarElement().querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!;
const turnMenu = () => toolbarElement().querySelector<HTMLElement>('[role="menu"]')!;
const entries = () => [...turnMenu().querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')];
const entry = (label: string) => entries().find((item) => item.textContent === label)!;
const viewOf = (editor: MarkdownEditor) => editor.action((ctx) => ctx.get(editorViewCtx));
const selectedText = (editor: MarkdownEditor) => { const { state } = viewOf(editor); return state.doc.textBetween(state.selection.from, state.selection.to, "|"); };
/** Selects `text` (its first occurrence) in the document. */
function selectText(editor: MarkdownEditor, text: string, to?: string) {
  const { state } = viewOf(editor);
  const find = (needle: string) => {
    let at = -1;
    state.doc.descendants((node, pos) => {
      if (at >= 0 || !node.isText) return at < 0;
      const index = node.text!.indexOf(needle);
      if (index >= 0) at = pos + index;
      return false;
    });
    if (at < 0) throw new Error(`no ${needle} in the document`);
    return at;
  };
  const from = find(text);
  select(editor, from, to === undefined ? from + text.length : find(to) + to.length);
}
function openTurnMenu() {
  turnButton().click();
  expect(turnMenu().hidden).toBe(false);
}

describe("Turn into on the selection toolbar", () => {
  it("sits first, a ghost sm button with a chevron, then a separator before the marks", async () => {
    const editor = await open("some text\n");
    mountToolbar(editor);
    const row = buttonRow();
    expect(row.firstElementChild).toBe(turnButton());
    expect(turnButton().nextElementSibling?.getAttribute("role")).toBe("separator");
    expect(turnButton().type).toBe("button");
    expect(turnButton().getAttribute("aria-expanded")).toBe("false");
    expect(turnButton().querySelector("svg")).not.toBeNull();
    expect(turnButton().className).toContain("h-6");
  });

  it.each([
    ["some text\n", "some", "Text"],
    ["## Title\n", "Title", "Heading 2"],
    ["- item\n", "item", "Bulleted list"],
    ["1. item\n", "item", "Numbered list"],
    ["- [ ] task\n", "task", "To-do list"],
    ["> quoted\n", "quoted", "Quote"],
    ["```\ncode\n```\n", "code", "Code"],
  ])("label names the kind: in %j, selecting %j reads %s", async (markdown, text, label) => {
    const editor = await open(markdown);
    mountToolbar(editor);
    selectText(editor, text);
    expect(turnButton().textContent).toBe(label);
    expect(turnButton().getAttribute("aria-label")).toBe(`Turn into, ${label}`);
  });

  it("names a selection over several kinds Mixed, and turns them into one numbered list, one undo away", async () => {
    const { undo } = await import("@milkdown/kit/prose/history");
    const editor = await open("P\n\n- a\n- b\n");
    mountToolbar(editor);
    selectText(editor, "P", "b");
    expect(turnButton().textContent).toBe("Mixed");
    openTurnMenu();
    expect(entries().some((item) => item.getAttribute("aria-checked") === "true")).toBe(false);
    entry("Numbered list").click();
    const { state } = viewOf(editor);
    expect(state.doc.childCount).toBe(1);
    expect(state.doc.firstChild!.type.name).toBe("ordered_list");
    expect(state.doc.firstChild!.childCount).toBe(3);
    expect(editor.getMarkdown()).toBe("1. P\n2. a\n3. b\n");
    editor.action((ctx) => { const view = ctx.get(editorViewCtx); undo(view.state, view.dispatch); });
    expect(editor.getMarkdown()).toBe("P\n\n- a\n- b\n");
  });

  it("enables Numbered list in a bulleted item, and turns only that item", async () => {
    const editor = await open("- a\n- b\n- c\n");
    mountToolbar(editor);
    selectText(editor, "b");
    expect(turnButton().textContent).toBe("Bulleted list");
    openTurnMenu();
    expect(entry("Numbered list").disabled).toBe(false);
    // The item's own kind is checked, and there is nothing to turn it into.
    expect(entry("Bulleted list").getAttribute("aria-checked")).toBe("true");
    expect(entry("Bulleted list").disabled).toBe(true);
    entry("Numbered list").click();
    const { doc } = viewOf(editor).state;
    expect(Array.from({ length: doc.childCount }, (_, index) => doc.child(index).type.name)).toEqual(["bullet_list", "ordered_list", "bullet_list"]);
    expect(editor.getMarkdown()).toContain("1. b");
    expect(turnButton().textContent).toBe("Numbered list");
  });

  it("turns a bulleted item back into text, where the Bulleted list button used to lift it", async () => {
    const editor = await open("- item\n");
    mountToolbar(editor);
    selectText(editor, "item");
    openTurnMenu();
    entry("Text").click();
    expect(editor.getMarkdown()).toBe("item\n");
  });

  it.each([
    ["Heading 1", "# some text\n"],
    ["Heading 3", "### some text\n"],
    ["Bulleted list", "- some text\n"],
    ["Quote", "> some text\n"],
    ["Toggle", "<details open>"],
  ])("turns a paragraph into %s from the menu", async (label, expected) => {
    const editor = await open("some text\n");
    mountToolbar(editor);
    selectText(editor, "some");
    openTurnMenu();
    entry(label).click();
    expect(editor.getMarkdown()).toContain(expected);
    expect(turnMenu().hidden).toBe(true);
  });

  it("keeps the same text selected after a turn, so a mark can follow", async () => {
    const editor = await open("first line\n\nsecond line\n");
    mountToolbar(editor);
    selectText(editor, "line", "second");
    expect(selectedText(editor)).toBe("line|second");
    openTurnMenu();
    entry("Bulleted list").click();
    expect(selectedText(editor)).toBe("line|second");
    expect(document.activeElement).toBe(editorDom(editor));
    button("Bold").click();
    expect(editor.getMarkdown()).toBe("- first **line**\n- **second** line\n");
  });

  it("keeps the text selected through a turn into a heading and a callout", async () => {
    const editor = await open("some text\n");
    mountToolbar(editor);
    selectText(editor, "text");
    openTurnMenu();
    entry("Heading 2").click();
    expect(selectedText(editor)).toBe("text");
    openTurnMenu();
    entry("Callout").click();
    expect(selectedText(editor)).toBe("text");
  });

  it("offers the grip menu's entries, in its order", async () => {
    const editor = await open("some text\n");
    mountToolbar(editor);
    selectText(editor, "some");
    openTurnMenu();
    expect(entries().map((item) => item.textContent)).toEqual(["Text", "Heading 1", "Heading 2", "Heading 3", "Bulleted list", "Numbered list", "To-do list", "Quote", "Code", "Toggle", "Callout"]);
    for (const item of entries()) expect(item.type).toBe("button");
    expect(turnMenu().className).toContain("kh-block-move-menu");
    expect(turnButton().getAttribute("aria-expanded")).toBe("true");
  });

  it("follows canTurnInto: in a code block, Toggle is disabled", async () => {
    const editor = await open("```\ncode\n```\n");
    mountToolbar(editor);
    selectText(editor, "code");
    openTurnMenu();
    expect(entry("Toggle").disabled).toBe(true);
    expect(entry("Callout").disabled).toBe(true);
    expect(entry("Text").disabled).toBe(false);
    entry("Toggle").click();
    expect(editor.getMarkdown()).toBe("```\ncode\n```\n");
  });

  it("keeps the toolbar open while the menu is open and focused", async () => {
    const editor = await open("some text\n");
    mountToolbar(editor);
    await throttleWindow();
    selectText(editor, "some");
    await throttleWindow();
    openTurnMenu();
    expect(turnMenu().contains(document.activeElement)).toBe(true);
    editorDom(editor).dispatchEvent(new FocusEvent("blur", { relatedTarget: document.activeElement }));
    mountToolbar(editor);
    await throttleWindow();
    expect(toolbarElement().dataset.show).toBe("true");
    expect(turnMenu().hidden).toBe(false);
  });

  it("closes on Escape and returns to the text, the selection as it was", async () => {
    const editor = await open("some text\n");
    mountToolbar(editor);
    selectText(editor, "text");
    openTurnMenu();
    const reached: string[] = [];
    const listener = (event: KeyboardEvent) => reached.push(event.key);
    document.addEventListener("keydown", listener);
    try {
      const event = key(document.activeElement as HTMLElement, { key: "Escape" });
      expect(event.defaultPrevented).toBe(true);
      expect(reached).toEqual([]);
    } finally {
      document.removeEventListener("keydown", listener);
    }
    expect(turnMenu().hidden).toBe(true);
    expect(turnButton().getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(editorDom(editor));
    expect(selectedText(editor)).toBe("text");
    expect(editor.getMarkdown()).toBe("some text\n");
  });

  it("moves between enabled entries with the arrow keys", async () => {
    const editor = await open("some text\n");
    mountToolbar(editor);
    selectText(editor, "some");
    openTurnMenu();
    // Text is the current kind, so the first enabled entry is Heading 1.
    expect(document.activeElement).toBe(entry("Heading 1"));
    key(document.activeElement as HTMLElement, { key: "ArrowDown" });
    expect(document.activeElement).toBe(entry("Heading 2"));
    key(document.activeElement as HTMLElement, { key: "ArrowUp" });
    key(document.activeElement as HTMLElement, { key: "ArrowUp" });
    expect(document.activeElement).toBe(entry("Callout"));
  });

  it("acts on the item, not its list, for a selection inside a nested item", async () => {
    const editor = await open("- a\n  - b\n  - c\n");
    mountToolbar(editor);
    selectText(editor, "c");
    openTurnMenu();
    entry("Quote").click();
    expect(editor.getMarkdown()).toContain("> c");
    expect(editor.getMarkdown()).toContain("- b");
  });

  it("takes the two top-level items for a selection from a nested item out to its parent's sibling", async () => {
    const editor = await open("- a\n  - b\n- c\n");
    mountToolbar(editor);
    selectText(editor, "b", "c");
    openTurnMenu();
    entry("Numbered list").click();
    expect(editor.getMarkdown()).toBe("1. a\n   - b\n2. c\n");
    expect(selectedText(editor)).toBe("b|c");
  });

  it("leaves out a block whose text the selection only reaches the start of", async () => {
    const editor = await open("some text\n\n## Next\n");
    mountToolbar(editor);
    const next = viewOf(editor).state.doc.child(0).nodeSize + 1;
    select(editor, 6, next);
    expect(turnButton().textContent).toBe("Text");
  });

  it("keeps the same text selected after Mixed turns into one numbered list", async () => {
    const editor = await open("Para\n\n- alpha\n- beta\n");
    mountToolbar(editor);
    selectText(editor, "ara", "be");
    openTurnMenu();
    entry("Numbered list").click();
    expect(editor.getMarkdown()).toBe("1. Para\n2. alpha\n3. beta\n");
    expect(selectedText(editor)).toBe("ara|alpha|be");
  });

  it("drops a callout's marker line on a turn into Text, and keeps the words selected", async () => {
    const editor = await open("> [!NOTE]\n> some words\n");
    mountToolbar(editor);
    selectText(editor, "words");
    expect(turnButton().textContent).toBe("Callout");
    openTurnMenu();
    entry("Text").click();
    expect(editor.getMarkdown()).toBe("some words\n");
    expect(selectedText(editor)).toBe("words");
  });

  it("keeps the selection in the paragraph it turned when another has the same text", async () => {
    const editor = await open("same text\n\nsame text\n");
    mountToolbar(editor);
    const second = viewOf(editor).state.doc.child(0).nodeSize + 1;
    select(editor, second + 5, second + 9);
    expect(selectedText(editor)).toBe("text");
    openTurnMenu();
    entry("Heading 2").click();
    expect(editor.getMarkdown()).toBe("same text\n\n## same text\n");
    const { state } = viewOf(editor);
    expect(selectedText(editor)).toBe("text");
    expect(state.selection.$from.parent.type.name).toBe("heading");
    // The bold lands in the heading, not the first paragraph.
    button("Bold").click();
    expect(editor.getMarkdown()).toBe("same text\n\n## same **text**\n");
  });

  it("keeps a [[wikilink]] as a link through a toolbar turn", async () => {
    const editor = await open("see [[Target]] here\n");
    mountToolbar(editor);
    selectText(editor, "here");
    const before = extractDocumentLinks(editor.getMarkdown()).map(({ kind, target }) => ({ kind, target }));
    expect(before).toEqual([{ kind: "WIKI", target: "Target" }]);
    openTurnMenu();
    entry("Bulleted list").click();
    expect(editor.getMarkdown()).toBe("- see [[Target]] here\n");
    expect(extractDocumentLinks(editor.getMarkdown()).map(({ kind, target }) => ({ kind, target }))).toEqual(before);
    openTurnMenu();
    entry("Heading 2").click();
    expect(editor.getMarkdown()).toBe("## see [[Target]] here\n");
    expect(extractDocumentLinks(editor.getMarkdown()).map(({ kind, target }) => ({ kind, target }))).toEqual(before);
  });

  it("focuses the menu itself when no entry is enabled, so Escape still closes it", async () => {
    const editor = await open("| a | b |\n| - | - |\n| c | d |\n");
    mountToolbar(editor);
    selectText(editor, "c");
    expect(turnButton().textContent).toBe("Turn into");
    openTurnMenu();
    expect(entries().every((item) => item.disabled)).toBe(true);
    expect(document.activeElement).toBe(turnMenu());
    key(turnMenu(), { key: "Escape" });
    expect(turnMenu().hidden).toBe(true);
    expect(document.activeElement).toBe(editorDom(editor));
    expect(selectedText(editor)).toBe("c");
  });

  it("does nothing while the view is not editable", async () => {
    const editor = await open("some text\n", false);
    mountToolbar(editor);
    selectText(editor, "some");
    turnButton().click();
    expect(turnMenu().hidden).toBe(true);
    expect(editor.getMarkdown()).toBe("some text\n");
  });
});

it("no H1, H2, H3, list or Toggle buttons remain on the toolbar", async () => {
  const editor = await open("- item\n");
  mountToolbar(editor);
  selectText(editor, "item");
  for (const label of ["Heading 1", "Heading 2", "Heading 3", "Bulleted list", "Numbered list", "Toggle section"]) {
    expect(buttonRow().querySelector(`button[aria-label="${label}"]`)).toBeNull();
  }
  for (const text of ["H1", "H2", "H3", "•", "1.", "Toggle"]) {
    expect([...buttonRow().querySelectorAll("button")].some((item) => item.textContent === text)).toBe(false);
  }
});

describe("hiding on blur", () => {
  async function shown() {
    const editor = await open("some text\n");
    mountToolbar(editor);
    await throttleWindow();
    select(editor, 1, 5);
    await throttleWindow();
    return editor;
  }

  it("shows over a focused selection", async () => {
    await shown();
    expect(toolbarElement().dataset.show).toBe("true");
  });

  it("hides when the editor loses focus to somewhere else", async () => {
    const editor = await shown();
    editorDom(editor).dispatchEvent(new FocusEvent("blur", { relatedTarget: null }));
    expect(toolbarElement().dataset.show).toBe("false");
  });

  it("stays when focus moves into the toolbar, as it does to the link box", async () => {
    const editor = await shown();
    editorDom(editor).dispatchEvent(new FocusEvent("blur", { relatedTarget: linkBox() }));
    expect(toolbarElement().dataset.show).toBe("true");
  });

  it("stays through pressing the link button, which moves focus into the box", async () => {
    await shown();
    button("Link").click();
    expect(document.activeElement).toBe(linkBox());
    expect(toolbarElement().dataset.show).toBe("true");
  });

  /** Moves focus out of the editor for real, to a field elsewhere on the page. */
  function focusElsewhere() {
    const field = document.createElement("input");
    document.body.appendChild(field);
    field.focus();
  }

  // Focus coming back (from the Markdown view, from the title field) dispatches no ProseMirror
  // update, so an unchanged selection would otherwise stay without its toolbar.
  it("comes back when focus returns to the editor with the selection unchanged", async () => {
    const editor = await shown();
    focusElsewhere();
    await throttleWindow();
    expect(toolbarElement().dataset.show).toBe("false");
    editorDom(editor).focus();
    await throttleWindow();
    expect(toolbarElement().dataset.show).toBe("true");
  });

  it("stays hidden when focus returns to a caret", async () => {
    const editor = await open("some text\n");
    mountToolbar(editor);
    await throttleWindow();
    select(editor, 3, 3);
    await throttleWindow();
    focusElsewhere();
    await throttleWindow();
    editorDom(editor).focus();
    await throttleWindow();
    expect(toolbarElement().dataset.show).toBe("false");
  });

  it("hides the link box when focus leaves it for anywhere but the editor or the toolbar", async () => {
    await shown();
    button("Link").click();
    expect(document.activeElement).toBe(linkBox());
    linkBox().value = "half-typed";
    focusElsewhere();
    expect(toolbarElement().dataset.show).toBe("false");
    expect(buttonRow().className).not.toContain("hidden");
    expect(linkBox().value).toBe("");
  });

  it("keeps the half-typed address when the browser tab loses focus", async () => {
    await shown();
    button("Link").click();
    expect(document.activeElement).toBe(linkBox());
    linkBox().value = "half-typed";
    // Switching tabs blurs with a null relatedTarget while the document itself is unfocused.
    const hasFocus = vi.spyOn(document, "hasFocus").mockReturnValue(false);
    try {
      linkBox().dispatchEvent(new FocusEvent("blur", { relatedTarget: null }));
      expect(toolbarElement().dataset.show).toBe("true");
      expect(buttonRow().className).toBe("hidden");
      expect(linkBox().value).toBe("half-typed");
    } finally {
      hasFocus.mockRestore();
    }
  });

  it("keeps the link box's toolbar when focus goes from the box back into the editor", async () => {
    const editor = await shown();
    button("Link").click();
    linkBox().dispatchEvent(new FocusEvent("blur", { relatedTarget: editorDom(editor) }));
    expect(toolbarElement().dataset.show).toBe("true");
  });

  it("leaves nothing behind when the editor is destroyed", async () => {
    const editor = await shown();
    const dom = editorDom(editor);
    opened.splice(opened.indexOf(editor), 1);
    await editor.destroy();
    expect(document.querySelector(".kh-selection-toolbar")).toBeNull();
    dom.dispatchEvent(new FocusEvent("blur", { relatedTarget: null }));
  });
});

describe("the React wrapper", () => {
  function props(overrides: Partial<RenderedEditorProps> = {}): RenderedEditorProps {
    return { workspaceId: "00000000-0000-4000-8000-000000000001", markdown: "some text\n", editable: true, onReady: () => {}, onFail: () => {}, onUserEdit: () => {}, onMarkdown: () => {}, ...overrides };
  }
  function mount(initial: RenderedEditorProps) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mounted.push(root);
    // Synchronous on purpose: the build is a promise, so nothing of it has run when this returns.
    act(() => root.render(createElement(RenderedEditor, initial)));
    return {
      container,
      render: (next: RenderedEditorProps) => act(() => root.render(createElement(RenderedEditor, next))),
    };
  }
  function ready() {
    let onReady!: (editor: MarkdownEditor) => void;
    const promise = new Promise<MarkdownEditor>((resolve) => { onReady = resolve; });
    return { promise, onReady };
  }
  const isEditable = (editor: MarkdownEditor) => editor.action((ctx) => ctx.get(editorViewCtx).editable);

  it("applies an editable change that arrived while the editor was still building", async () => {
    const built = ready();
    const wrapper = mount(props({ editable: true, onReady: built.onReady }));
    wrapper.render(props({ editable: false, onReady: built.onReady }));
    const editor = await built.promise;
    expect(isEditable(editor)).toBe(false);
  });

  // The composer's sync base: if its Markdown moved on while the editor was building (a draft
  // discarded, a source edit), it must learn that the editor opened with the older text.
  it("reports the Markdown it opened with, even when the prop moved on while it was building", async () => {
    const onReady = vi.fn();
    const wrapper = mount(props({ markdown: "opened with\n", onReady }));
    wrapper.render(props({ markdown: "moved on\n", onReady }));
    await vi.waitFor(() => expect(onReady).toHaveBeenCalledOnce());
    const [editor, openedWith] = onReady.mock.calls[0] as [MarkdownEditor, string];
    expect(openedWith).toBe("opened with\n");
    expect(editor.getMarkdown()).toBe("opened with\n");
  });

  it("follows later editable changes", async () => {
    const built = ready();
    const wrapper = mount(props({ editable: false, onReady: built.onReady }));
    const editor = await built.promise;
    expect(isEditable(editor)).toBe(false);
    wrapper.render(props({ editable: true, onReady: built.onReady }));
    expect(isEditable(editor)).toBe(true);
  });

  describe.each([true, false])("clicking a link with editable=%s", (editable) => {
    async function withLink() {
      const built = ready();
      const wrapper = mount(props({ markdown: "[site](https://example.com)\n", editable, onReady: built.onReady }));
      await built.promise;
      const anchor = wrapper.container.querySelector("a")!;
      expect(anchor.getAttribute("href")).toBe("https://example.com");
      return { anchor, paragraph: wrapper.container.querySelector("p")! };
    }
    const click = (target: HTMLElement, init: MouseEventInit = {}) => {
      const event = new MouseEvent("click", { bubbles: true, cancelable: true, ...init });
      target.dispatchEvent(event);
      return event;
    };

    it("never navigates on a plain click", async () => {
      const open = vi.spyOn(window, "open").mockImplementation(() => null);
      const { anchor } = await withLink();
      expect(click(anchor).defaultPrevented).toBe(true);
      expect(open).not.toHaveBeenCalled();
    });

    it("opens a new tab on ⌘-click and on Ctrl-click", async () => {
      const open = vi.spyOn(window, "open").mockImplementation(() => null);
      const { anchor } = await withLink();
      expect(click(anchor, { metaKey: true }).defaultPrevented).toBe(true);
      expect(click(anchor, { ctrlKey: true }).defaultPrevented).toBe(true);
      expect(open).toHaveBeenCalledTimes(2);
      expect(open).toHaveBeenCalledWith("https://example.com", "_blank", "noopener,noreferrer");
    });

    it("opens nothing on ⌘-click of a link with an unsafe scheme", async () => {
      const open = vi.spyOn(window, "open").mockImplementation(() => null);
      const built = ready();
      const wrapper = mount(props({ markdown: "[a](javascript:alert(1)) [b](data:text/html,x)\n", editable, onReady: built.onReady }));
      await built.promise;
      for (const anchor of wrapper.container.querySelectorAll("a")) click(anchor as HTMLElement, { metaKey: true });
      expect(open).not.toHaveBeenCalled();
    });

    it("leaves a click that is not on a link alone", async () => {
      const open = vi.spyOn(window, "open").mockImplementation(() => null);
      const { paragraph } = await withLink();
      expect(click(paragraph, { metaKey: true }).defaultPrevented).toBe(false);
      expect(open).not.toHaveBeenCalled();
    });
  });
});

// Launcher audit (2026-11-18): Notion's clear-formatting habit (Cmd+\) had no equivalent; the
// selection toolbar could add marks but never take them all away.
it("clears every inline mark from a selection, and from the next character at a caret", async () => {
  const editor = await open("**bold** and *italic*");
  mountToolbar(editor);
  select(editor, 1, 5);
  await throttleWindow();
  button("Clear formatting").click();
  expect(editor.getMarkdown()).toBe("bold and *italic*\n");
  // Select the italic word and use the keyboard habit.
  select(editor, 10, 16);
  await throttleWindow();
  // Cmd/Ctrl-\ alone stays the app's navigation toggle; the editor must not take it.
  const rail = key(editorDom(editor), { key: "\\", metaKey: true });
  expect(rail.defaultPrevented).toBe(false);
  const event = key(editorDom(editor), { key: "|", code: "Backslash", metaKey: true, shiftKey: true });
  expect(event.defaultPrevented).toBe(true);
  expect(editor.getMarkdown()).toBe("bold and italic\n");
});

it("drops the mark the caret would type with when nothing is selected", async () => {
  const editor = await open("**bold** and plain");
  mountToolbar(editor);
  select(editor, 3, 3);
  await throttleWindow();
  button("Clear formatting").click();
  editor.action(ctx => {
    const view = ctx.get(editorViewCtx);
    view.dispatch(view.state.tr.insertText("x"));
  });
  expect(editor.getMarkdown()).toBe("**bo**x**ld** and plain\n");
});

// Launcher audit (2026-11-18): Notion's link card copies the address; ours only opened, edited or
// removed it.
it("copies the link address from its card", async () => {
  const writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  const editor = await open("[example](https://example.com) after\n");
  mountToolbar(editor);
  select(editor, 4, 4);
  await wait(320);
  const card = document.querySelector<HTMLElement>(".kh-link-card")!;
  expect(card.dataset.show).toBe("true");
  const copy = card.querySelector<HTMLButtonElement>('button[aria-label="Copy link"]')!;
  expect(copy.type).toBe("button");
  copy.click();
  await wait(20);
  expect(writeText).toHaveBeenCalledWith("https://example.com");
  expect(copy.getAttribute("aria-label")).toBe("Copied");
  expect(card.querySelector("[data-copy-status]")?.textContent).toBe("Link copied");
  expect(card.querySelector("[data-copy-status]")?.getAttribute("aria-live")).toBe("polite");
  expect(editor.getMarkdown()).toBe("[example](https://example.com) after\n");
});


it("copies a relative document link exactly as written", async () => {
  const writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  const editor = await open("[doc](notes/other.md) after\n");
  mountToolbar(editor);
  select(editor, 3, 3);
  await wait(320);
  document.querySelector<HTMLButtonElement>('.kh-link-card button[aria-label="Copy link"]')!.click();
  expect(writeText).toHaveBeenCalledWith("notes/other.md");
});

it("leaves the card alone when the clipboard refuses", async () => {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn(async () => { throw new Error("denied"); }) } });
  const editor = await open("[site](https://example.com) after\n");
  mountToolbar(editor);
  select(editor, 3, 3);
  await wait(320);
  const card = document.querySelector<HTMLElement>(".kh-link-card")!;
  card.querySelector<HTMLButtonElement>('button[aria-label="Copy link"]')!.click();
  await wait(20);
  expect(card.querySelector<HTMLButtonElement>('button[aria-label="Copy link"]')?.textContent).toBe("Copy");
  expect(card.querySelector("[data-copy-status]")?.textContent).toBe("");
});

it("keeps the block type when clearing a heading's marks, and can be undone", async () => {
  const { undo } = await import("@milkdown/kit/prose/history");
  const editor = await open("## Heading **bold**");
  mountToolbar(editor);
  select(editor, 9, 13);
  await throttleWindow();
  button("Clear formatting").click();
  expect(editor.getMarkdown()).toBe("## Heading bold\n");
  editor.action(ctx => { const view = ctx.get(editorViewCtx); undo(view.state, view.dispatch); });
  expect(editor.getMarkdown()).toBe("## Heading **bold**\n");
});

// Review (2026-11-17): a link is content, not formatting; its card's Remove is how it goes.
it("keeps a link and its address when clearing formatting over it", async () => {
  const editor = await open("[linked](https://example.com) text\n");
  mountToolbar(editor);
  select(editor, 1, 7);
  await throttleWindow();
  button("Clear formatting").click();
  expect(editor.getMarkdown()).toBe("[linked](https://example.com) text\n");
});

it("clears formatting but keeps links, so select-all and clear never drops a URL", async () => {
  const editor = await open("a **[site](https://example.com)** *b*");
  mountToolbar(editor);
  select(editor, 1, 9); // all of "a site b"
  await throttleWindow();
  button("Clear formatting").click();
  expect(editor.getMarkdown()).toBe("a [site](https://example.com) b\n");
});

describe("turnEntry, the one Turn into predicate both menus use", () => {
  const blocksOf = async (markdown: string) => {
    const editor = await open(markdown);
    const { doc } = viewOf(editor).state;
    const blocks: { pos: number; node: import("@milkdown/kit/prose/model").Node }[] = [];
    doc.forEach((node, pos) => {
      if (node.type.name === "bullet_list" || node.type.name === "ordered_list") node.forEach((item, inner) => blocks.push({ pos: pos + 1 + inner, node: item }));
      else blocks.push({ pos, node });
    });
    return blocks;
  };

  it("checks and disables the kind every block already is", async () => {
    const blocks = await blocksOf("## A\n\n## B\n");
    expect(turnEntry(blocks, "h2")).toEqual({ checked: true, disabled: true });
    expect(turnEntry(blocks, "paragraph")).toEqual({ checked: false, disabled: false });
  });

  it("enables a kind some blocks already are, where the rest can take it", async () => {
    const blocks = await blocksOf("P\n\n- a\n");
    expect(turnEntry(blocks, "bullet")).toEqual({ checked: false, disabled: false });
  });

  it("disables a kind one block cannot take", async () => {
    const blocks = await blocksOf("P\n\n```\ncode\n```\n");
    expect(turnEntry(blocks, "toggle")).toEqual({ checked: false, disabled: true });
    expect(turnEntry(blocks, "quote")).toEqual({ checked: false, disabled: false });
  });

  it("disables everything for no blocks", () => {
    expect(turnEntry([], "paragraph")).toEqual({ checked: false, disabled: true });
  });
});

// Browser run (list commands, Task 4): the document pane's `contain: layout` keeps the toolbar, and its Turn into menu,
// under the block and table controls drawn on the body at 30, and the menu hangs over the gutter's column. While the
// menu is open those controls step aside; the rule that does it must match them then, and only then.
describe("the controls drawn on the body step aside while the Turn into menu is open", () => {
  it("hides the block and table controls by a rule that matches only while the menu is open", async () => {
    const { readFileSync } = await import("node:fs");
    const css = readFileSync("src/app/globals.css", "utf8");
    const rule = /\n(body:has\(\.kh-selection-toolbar \[role="menu"\]:not\(\[hidden\]\)\)[^{]+)\{\s*visibility:\s*hidden;\s*\}/.exec(css);
    expect(rule).not.toBeNull();
    const selector = rule![1].trim();
    const controls = ["kh-block-gutter", "kh-table-grip", "kh-table-col-grip", "kh-table-add"].map((name) => {
      const element = document.body.appendChild(document.createElement("div"));
      element.className = name;
      return element;
    });
    const editor = await open("- a\n- b\n");
    mountToolbar(editor);
    selectText(editor, "b");
    expect(controls.some((element) => element.matches(selector))).toBe(false);
    openTurnMenu();
    expect(controls.every((element) => element.matches(selector))).toBe(true);
    key(turnMenu(), { key: "Escape" });
    expect(turnMenu().hidden).toBe(true);
    expect(controls.some((element) => element.matches(selector))).toBe(false);
  });
});

// Recorded in the design-language contract (list commands, Task 4): the toolbar acts on the blocks the block-unit spec
// names, so a selection inside a quote turns the whole quote, and inside a toggle's body nothing is offered.
describe("Turn into on the toolbar, inside a container", () => {
  it("turns the whole quote from a selection in one of its paragraphs", async () => {
    const editor = await open("> one\n>\n> two\n");
    mountToolbar(editor);
    selectText(editor, "two");
    expect(turnButton().textContent).toBe("Quote");
    openTurnMenu();
    entry("Text").click();
    expect(editor.getMarkdown()).toBe("one\n\ntwo\n");
  });

  // Whole-branch review, I2: the container rule is for its paragraphs. A list item is a block of its own wherever its
  // list is, so a selection in an item in a quote turns that item, inside the quote.
  it("turns only the item from a selection in a list item inside a quote", async () => {
    const editor = await open("> - a\n> - b\n");
    mountToolbar(editor);
    selectText(editor, "b");
    expect(turnButton().textContent).toBe("Bulleted list");
    openTurnMenu();
    for (const label of ["Text", "Heading 1", "Numbered list", "Quote", "Code"]) expect(entry(label).disabled, label).toBe(false);
    entry("Text").click();
    expect(editor.getMarkdown()).toBe("> - a\n>\n> b\n");
  });

  it("offers nothing inside a toggle's body", async () => {
    const editor = await open("<details>\n<summary>Title</summary>\n\nbody words\n\n</details>\n");
    mountToolbar(editor);
    selectText(editor, "body");
    openTurnMenu();
    expect(entries().length).toBeGreaterThan(0);
    expect(entries().every((item) => item.disabled)).toBe(true);
  });
});
