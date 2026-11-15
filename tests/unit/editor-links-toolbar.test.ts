// @vitest-environment jsdom
import { editorViewCtx } from "@milkdown/kit/core";
import { AllSelection, TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMarkdownEditor, type MarkdownEditor } from "@/components/knowledge/editor/editor-core";
import { selectionToolbar, storedLinkTarget, withScheme } from "@/components/knowledge/editor/selection-toolbar";
import type { RenderedLinks } from "@/components/knowledge/rendered-links";
import { linkLookupKey } from "@/modules/knowledge/domain/link-graph";
import { extractDocumentLinks } from "@/modules/knowledge/domain/document-links";
import { LINK_MARKDOWN_FIXTURES } from "../fixtures/link-markdown";

// Decisions 9, 11, 12, 13 of the Notion-parity spec: ⌘K, the link card, a pasted URL, the toolbar's new buttons.
const rect = { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => rect;
const opened: MarkdownEditor[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const editor of opened.splice(0)) await editor.destroy(); document.body.innerHTML = ""; });

async function open(markdown: string, links?: RenderedLinks) {
  const root = document.body.appendChild(document.createElement("div"));
  const toolbar = selectionToolbar(undefined, () => links);
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
  it("over text and a code block links the text and leaves the code as it was", async () => {
    const markdown = "some text\n\n```\ncode\n```\n";
    const { editor, view } = await open(markdown);
    select(view, 1, view.state.doc.content.size - 2);
    expect(paste(view, "https://example.com").defaultPrevented).toBe(true);
    expect(editor.getMarkdown()).toBe("[some text](https://example.com)\n\n```\ncode\n```\n");
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

describe("a link laid over a selection that holds a wikilink", () => {
  // The whole paragraph "a [[X]] b": the wikilink must be written back as it was read, its edge kept.
  const MD = "a [[X]] b\n";
  const all = (view: EditorView) => select(view, 1, view.state.doc.firstChild!.nodeSize - 1);
  const kinds = (markdown: string) => extractDocumentLinks(markdown).map(({ kind, target }) => ({ kind, target }));
  function linkedWikiLinks(view: EditorView) {
    let count = 0;
    view.state.doc.descendants((node) => { if (node.type.name === "wiki_link" && node.marks.some((mark) => mark.type.name === "link")) count += 1; });
    return count;
  }
  function expectKept(editor: MarkdownEditor, view: EditorView, href: string) {
    const markdown = editor.getMarkdown();
    expect(linkedWikiLinks(view)).toBe(0);
    expect(markdown).toContain("[[X]]");
    expect(markdown).not.toMatch(/\[[^\]]*\[\[X\]\][^\]]*\]\(/);
    expect(kinds(markdown)).toEqual(expect.arrayContaining([{ kind: "WIKI", target: "X" }]));
    expect(markdown).toContain(`](${href})`);
    // Read back, as a saved document is: the edge is in the extractor's links, and the editor holds it as a node.
    return markdown;
  }

  it("by a pasted URL", async () => {
    const { editor, view } = await open(MD);
    all(view);
    expect(paste(view, "https://example.com/p").defaultPrevented).toBe(true);
    const markdown = expectKept(editor, view, "https://example.com/p");
    const reopened = await open(markdown);
    expect(kinds(reopened.editor.getMarkdown())).toEqual(kinds(markdown));
  });

  it.each([
    ["the toolbar's Link button", () => toolbarEl().querySelector<HTMLButtonElement>('button[aria-label="Link"]')!.click()],
    ["⌘K", (view: EditorView) => { keydown(view.dom, { key: "k", metaKey: true }); }],
  ])("by %s and the link field", async (_name, start) => {
    const { editor, view } = await open(MD);
    all(view);
    start(view);
    const input = toolbarEl().querySelector<HTMLInputElement>("input")!;
    expect(document.activeElement).toBe(input);
    input.value = "https://example.org/q";
    keydown(input, { key: "Enter" });
    expectKept(editor, view, "https://example.org/q");
  });

  it("is undone with the link in one step", async () => {
    const { editor, view } = await open(MD);
    all(view);
    paste(view, "https://example.com/p");
    const { undo } = await import("@milkdown/kit/prose/history");
    undo(view.state, view.dispatch);
    expect(editor.getMarkdown()).toBe(MD);
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
  describe("Edit on a relative .md link", () => {
    const DOC = "see [other](../notes/other.md#Part) end\n";
    const links: RenderedLinks = { [linkLookupKey("PATH", "../notes/other.md")]: { status: "RESOLVED", basePath: "/w/ws/knowledge/src/doc", title: "Other", ambiguousWith: 0 } };
    const edges = (markdown: string) => extractDocumentLinks(markdown).map(({ kind, target }) => ({ kind, target }));

    it("saves it unchanged, never as https://..., and keeps the document edge", async () => {
      const { editor, view } = await open(DOC, links);
      select(view, 7);
      card()!.querySelector<HTMLButtonElement>("button[aria-label='Edit link']")!.click();
      const input = toolbarEl().querySelector<HTMLInputElement>("input")!;
      expect(input.value).toBe("../notes/other.md#Part");
      keydown(input, { key: "Enter" });
      expect(editor.getMarkdown()).toBe(DOC);
      expect(edges(editor.getMarkdown())).toEqual([{ kind: "PATH", target: "../notes/other.md" }]);
    });
    it("keeps a bare relative link (notes/other.md) saved unedited", async () => {
      const bare = "see [other](notes/other.md) end\n";
      const { editor, view } = await open(bare);
      select(view, 7);
      card()!.querySelector<HTMLButtonElement>("button[aria-label='Edit link']")!.click();
      keydown(toolbarEl().querySelector<HTMLInputElement>("input")!, { key: "Enter" });
      expect(editor.getMarkdown()).toBe(bare);
    });
    it("stays a document link when its address is edited (other.md → other.md#sec)", async () => {
      const bare = "see [other](other.md) end\n";
      const { editor, view } = await open(bare);
      select(view, 7);
      card()!.querySelector<HTMLButtonElement>("button[aria-label='Edit link']")!.click();
      const input = toolbarEl().querySelector<HTMLInputElement>("input")!;
      input.value = "other.md#sec";
      keydown(input, { key: "Enter" });
      expect(editor.getMarkdown()).toBe("see [other](other.md#sec) end\n");
      expect(edges(editor.getMarkdown())).toEqual([{ kind: "PATH", target: "other.md" }]);
    });
    it("becomes a web address when it is edited to one", async () => {
      const { editor, view } = await open("see [other](other.md) end\n");
      select(view, 7);
      card()!.querySelector<HTMLButtonElement>("button[aria-label='Edit link']")!.click();
      const input = toolbarEl().querySelector<HTMLInputElement>("input")!;
      input.value = "example.com";
      keydown(input, { key: "Enter" });
      expect(editor.getMarkdown()).toBe("see [other](https://example.com) end\n");
    });
    it("opens the document from the field's Open, as the card does", async () => {
      const open_ = vi.spyOn(window, "open").mockImplementation(() => null);
      const { view } = await open(DOC, links);
      select(view, 7);
      card()!.querySelector<HTMLButtonElement>("button[aria-label='Edit link']")!.click();
      const button = toolbarEl().querySelector<HTMLButtonElement>("button[aria-label='Open link']")!;
      expect(button.disabled).toBe(false);
      button.click();
      expect(open_).toHaveBeenCalledWith("/w/ws/knowledge/src/doc#Part", "_blank", "noopener,noreferrer");
    });
    it("leaves Open off for a document the workspace does not have", async () => {
      const { view } = await open(DOC);
      select(view, 7);
      card()!.querySelector<HTMLButtonElement>("button[aria-label='Edit link']")!.click();
      expect(toolbarEl().querySelector<HTMLButtonElement>("button[aria-label='Open link']")!.disabled).toBe(true);
    });
  });
  it("follows the link while typing inside it, so Remove unlinks all of it", async () => {
    const { editor, view } = await open(MD);
    select(view, 2);
    select(view, IN_LINK);
    expect(cardShown()).toBe(true);
    view.dispatch(view.state.tr.insertText("xy", IN_LINK));
    expect(cardShown()).toBe(true);
    card()!.querySelector<HTMLButtonElement>("button[aria-label='Remove link']")!.click();
    expect(editor.getMarkdown()).toBe("plain sixyte end\n");
  });
  it("is not shown for a wikilink", async () => {
    const { view } = await open("a [[Other]] b\n");
    select(view, 1);
    select(view, 2);
    expect(cardShown()).toBe(false);
  });
});

describe("an address typed in the link field", () => {
  it("makes an email address mail it, and gives a host with a port https://", () => {
    expect(withScheme("user@example.com")).toBe("mailto:user@example.com");
    expect(withScheme("localhost:3000/x")).toBe("https://localhost:3000/x");
    expect(withScheme("example.com:8080")).toBe("https://example.com:8080");
    expect(storedLinkTarget(withScheme("localhost:3000/x"))).toBe("https://localhost:3000/x");
    for (const kept of ["mailto:a@b.c", "tel:123", "https://user@example.com", "#user@example.com", "./a@b.md"]) expect(withScheme(kept)).toBe(kept);
    for (const kept of ["?a@b.c", "?q=1"]) expect(withScheme(kept)).toBe(kept);
    expect(withScheme("a@b.c?subject=hi")).toBe("mailto:a@b.c?subject=hi");
  });
  it("is given https:// only when it is a web address", () => {
    for (const web of ["example.com/a", "example.com/a.md", "github.com/org/repo/blob/main/README.md", "news.md"]) expect(withScheme(web)).toBe(`https://${web}`);
    for (const kept of ["../notes/other.md", "./other.md#Part", "/w/ws", "#top", "mailto:a@b.c", "https://example.com"]) expect(withScheme(kept)).toBe(kept);
  });
});

describe("where a link already in the document opens (11, Open and Mod-click)", () => {
  const links = { [linkLookupKey("PATH", "notes/other.md")]: { status: "RESOLVED" as const, basePath: "/w/ws/knowledge/src/doc", title: "Other", ambiguousWith: 0 } };

  it("opens a relative .md link at its document, as the reader does, never at an invented host", () => {
    const target = storedLinkTarget("notes/other.md#Some Heading", links);
    expect(target?.startsWith("/w/ws/knowledge/src/doc#")).toBe(true);
    expect(storedLinkTarget("missing.md", links)).toBeNull();
    expect(storedLinkTarget("../other.md")).toBeNull();
  });

  it("opens other stored links only as written", () => {
    expect(storedLinkTarget("https://example.com/a")).toBe("https://example.com/a");
    expect(storedLinkTarget("mailto:a@b.c")).toBe("mailto:a@b.c");
    expect(storedLinkTarget("/w/ws")).toBe("/w/ws");
    expect(storedLinkTarget("example.com")).toBeNull();
    expect(storedLinkTarget("javascript:alert(1)")).toBeNull();
    expect(storedLinkTarget("//evil.example")).toBeNull();
    expect(storedLinkTarget("/\\evil.example")).toBeNull();
  });
});

describe("where the link field is not offered", () => {
  it("⌘K in a code block is left to the palette, and the toolbar's Link button is off", async () => {
    const { view } = await open("```\nlet code = 1\n```\n");
    select(view, 2, 6);
    expect(keydown(view.dom, { key: "k", ctrlKey: true }).defaultPrevented).toBe(false);
    expect(toolbarEl().querySelector<HTMLButtonElement>("button[aria-label='Link']")!.disabled).toBe(true);
  });
  it("the toolbar is not shown over a block chosen with Escape", async () => {
    const { view } = await open("some text here\n\nsecond\n");
    select(view, 1, 5);
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(toolbarEl().dataset.show).toBe("true");
    keydown(view.dom, { key: "Escape", keyCode: 27 } as KeyboardEventInit);
    expect(view.state.selection.constructor.name).toBe("NodeSelection");
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(toolbarEl().dataset.show).not.toBe("true");
  });
});

describe("the toolbar and its Link button, beyond a plain paragraph", () => {
  it("is not shown over a code block chosen with Escape inside a list item", async () => {
    const { view } = await open("- item\n\n  ```\n  code here\n  ```\n");
    let at = -1;
    view.state.doc.descendants((node, pos) => { if (at < 0 && node.type.name === "code_block") at = pos + 2; });
    select(view, at, at + 3);
    keydown(view.dom, { key: "Escape", keyCode: 27 } as KeyboardEventInit);
    expect(view.state.selection.constructor.name).toBe("NodeSelection");
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(toolbarEl().dataset.show).not.toBe("true");
  });
  it("keeps Link on for select-all and in a table cell", async () => {
    const { view } = await open("one\n\ntwo\n");
    view.dispatch(view.state.tr.setSelection(new AllSelection(view.state.doc)));
    expect(toolbarEl().querySelector<HTMLButtonElement>("button[aria-label='Link']")!.disabled).toBe(false);
    const table = await open("| a | b |\n| - | - |\n| cell | x |\n");
    let at = -1;
    table.view.state.doc.descendants((node, pos) => { if (at < 0 && node.isText && node.text === "cell") at = pos; });
    select(table.view, at, at + 4);
    expect(document.querySelectorAll<HTMLElement>(".kh-selection-toolbar")[1].querySelector<HTMLButtonElement>("button[aria-label='Link']")!.disabled).toBe(false);
  });
});
