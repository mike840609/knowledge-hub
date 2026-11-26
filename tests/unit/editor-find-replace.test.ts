// @vitest-environment jsdom
import { editorViewCtx } from "@milkdown/kit/core";
import { undo } from "@milkdown/kit/prose/history";
import { NodeSelection, TextSelection } from "@milkdown/kit/prose/state";
import { afterEach, describe, expect, it } from "vitest";
import { createMarkdownEditor, type MarkdownEditor } from "@/components/knowledge/editor/editor-core";
import { FIND_MATCH_LIMIT, findReplace, type FindController } from "@/components/knowledge/editor/find-replace";
import { extractDocumentLinks } from "@/modules/knowledge/domain/document-links";
import { LINK_MARKDOWN_FIXTURES } from "../fixtures/link-markdown";

/**
 * Find and replace (2026-11-26 spec), run inside the rendered editor. The bar's React is `editor-find-bar.test.tsx`;
 * this holds what is found and what a replacement writes. A saved document's links are read back through the link
 * extractor, as the link-index invariant asks: a replacement must not turn a wikilink into text, or text into one.
 */

const opened: MarkdownEditor[] = [];
afterEach(async () => {
  while (opened.length) await opened.pop()!.destroy();
  document.body.innerHTML = "";
});

async function open(markdown: string, editable = true) {
  const root = document.body.appendChild(document.createElement("div"));
  const find = findReplace();
  const editor = await createMarkdownEditor({
    root, markdown, className: "kh-editor", ariaLabel: "Content", editable,
    onUserEdit() {}, onMarkdown() {}, allowImage: () => false,
    extraPlugins: [find.plugin],
  });
  opened.push(editor);
  const view = editor.action((ctx) => ctx.get(editorViewCtx));
  return { editor, view, find: find.controller, root };
}

const links = (markdown: string) => extractDocumentLinks(markdown).map(({ kind, target, fragment, display }) => ({ kind, target, fragment, display }));
const search = (find: FindController, query: string, matchCase = false) => { find.open(); find.setMatchCase(matchCase); find.setQuery(query); return find.getSnapshot(); };
const selected = (view: { state: { doc: { textBetween: (a: number, b: number) => string }; selection: { from: number; to: number } } }) => view.state.doc.textBetween(view.state.selection.from, view.state.selection.to);
const key = (view: ReturnType<typeof Object>, init: KeyboardEventInit) => {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  (view as { someProp: (name: string, run: (handler: (view: unknown, event: Event) => boolean) => boolean | undefined) => boolean | undefined }).someProp("handleKeyDown", (handler) => handler(view, event));
  return event;
};

describe("finding", () => {
  it("counts matches, case-insensitively unless the case is matched", async () => {
    const { find } = await open("Cat and cat and CAT.\n\nAnother cat.\n");
    expect(search(find, "cat")).toMatchObject({ open: true, total: 4, index: 0 });
    expect(search(find, "cat", true)).toMatchObject({ total: 2 });
    expect(search(find, "dog")).toMatchObject({ total: 0 });
    expect(search(find, "")).toMatchObject({ total: 0 });
  });

  it("takes the query as plain text, not a pattern", async () => {
    const { find } = await open("a.c abc (x) [y]\n");
    expect(search(find, "a.c").total).toBe(1);
    expect(search(find, "(x)").total).toBe(1);
    expect(search(find, "[y]").total).toBe(1);
  });

  it("draws every match, and the current one differently", async () => {
    const { find, root } = await open("one two one two one\n");
    search(find, "one");
    expect(root.querySelectorAll(".kh-find-match")).toHaveLength(3);
    expect(root.querySelectorAll(".kh-find-current")).toHaveLength(1);
    find.step(1);
    expect(root.querySelector(".kh-find-current")?.getBoundingClientRect).toBeDefined();
    expect(find.getSnapshot().index).toBe(1);
  });

  it("steps to the next and previous match, wrapping, and selects it in the editor", async () => {
    const { find, view } = await open("x1 x2 x3\n");
    search(find, "x");
    find.step(1);
    expect(find.getSnapshot().index).toBe(1);
    expect(selected(view)).toBe("x");
    expect(view.state.selection.from).toBe(4);
    find.step(1);
    find.step(1);
    expect(find.getSnapshot().index).toBe(0);
    find.step(-1);
    expect(find.getSnapshot().index).toBe(2);
  });

  it("starts at the first match at or after the caret", async () => {
    const { find, view } = await open("a one\n\nb one\n\nc one\n");
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 9)));
    expect(search(find, "one")).toMatchObject({ total: 3, index: 1 });
  });

  it("pre-fills the query from a selection on one line, and only then", async () => {
    const { find, view } = await open("alpha beta\n\ngamma\n");
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 7, 11)));
    find.open();
    expect(find.getSnapshot().query).toBe("beta");
    find.close();
    find.setQuery("keep");
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2, 14)));
    find.open();
    expect(find.getSnapshot().query).toBe("keep");
  });

  it("never matches across two blocks", async () => {
    const { find } = await open("end of one\n\nstart of two\n\n- item a\n- item b\n");
    expect(search(find, "one start").total).toBe(0);
    expect(search(find, "onestart").total).toBe(0);
    expect(search(find, "item").total).toBe(2);
    expect(search(find, "a item").total).toBe(0);
  });

  it("matches across differently marked runs in one block", async () => {
    const { find } = await open("plain **bold** and *it*\n");
    expect(search(find, "plain bold").total).toBe(1);
    expect(search(find, "bold and it").total).toBe(1);
  });

  it("searches code blocks and link text, not link addresses", async () => {
    const { find } = await open("```js\nconst needle = 1;\n```\n\n[needle here](https://needle.example/)\n");
    expect(search(find, "needle").total).toBe(2);
  });

  it("does not match inside, or across, a wikilink", async () => {
    const { find } = await open("Open [[Needle Page]] now needle\n");
    expect(search(find, "needle").total).toBe(1);
    expect(search(find, "open needle").total).toBe(0);
    expect(search(find, "now needle").total).toBe(1);
    expect(search(find, "Page").total).toBe(0);
  });

  it("keeps the first thousand matches and says there are more", async () => {
    const { find } = await open(`${"ab ".repeat(FIND_MATCH_LIMIT + 50)}\n`);
    expect(search(find, "ab")).toMatchObject({ total: FIND_MATCH_LIMIT, truncated: true });
  });

  it("follows the document: matches are found again after an edit", async () => {
    const { find, view } = await open("one two\n");
    search(find, "two");
    view.dispatch(view.state.tr.insertText(" two", 8));
    expect(find.getSnapshot().total).toBe(2);
  });

  it("closes, clears its highlights and leaves the caret at the current match", async () => {
    const { find, view, root } = await open("aa bb aa\n");
    search(find, "aa");
    find.step(1);
    find.close();
    expect(find.getSnapshot().open).toBe(false);
    expect(root.querySelectorAll(".kh-find-match")).toHaveLength(0);
    expect(view.state.selection.empty).toBe(true);
    expect(view.state.selection.from).toBe(9);
  });
});

describe("keys", () => {
  it("Mod-F opens the bar from the editor; Mod-G steps only while it is open", async () => {
    const { find, view } = await open("a a a\n");
    expect(key(view, { key: "g", ctrlKey: true }).defaultPrevented).toBe(false);
    expect(key(view, { key: "f", ctrlKey: true }).defaultPrevented).toBe(true);
    expect(find.getSnapshot().open).toBe(true);
    const token = find.getSnapshot().focusToken;
    find.setQuery("a");
    key(view, { key: "g", ctrlKey: true });
    expect(find.getSnapshot().index).toBe(1);
    key(view, { key: "G", ctrlKey: true, shiftKey: true });
    expect(find.getSnapshot().index).toBe(0);
    key(view, { key: "f", ctrlKey: true });
    expect(find.getSnapshot().focusToken).toBeGreaterThan(token);
  });

  it("Mod-Alt-F opens it with the replace field", async () => {
    const { find, view } = await open("a\n");
    key(view, { key: "f", code: "KeyF", ctrlKey: true, altKey: true });
    expect(find.getSnapshot()).toMatchObject({ open: true, replaceOpen: true });
  });

  it("on a Mac, Command-Option-F opens it by the physical key (Option-F types \"ƒ\")", async () => {
    const platform = Object.getOwnPropertyDescriptor(Navigator.prototype, "platform");
    Object.defineProperty(navigator, "platform", { configurable: true, get: () => "MacIntel" });
    try {
      const { find, view } = await open("a\n");
      key(view, { key: "ƒ", code: "KeyF", metaKey: true, altKey: true });
      expect(find.getSnapshot()).toMatchObject({ open: true, replaceOpen: true });
    } finally {
      delete (navigator as unknown as Record<string, unknown>).platform;
      if (platform) Object.defineProperty(Navigator.prototype, "platform", platform);
    }
  });

  it("leaves AltGr+F (Ctrl+Alt on Windows) to the editor: on some layouts it types \"[\"", async () => {
    const { find, view } = await open("a\n");
    // Firefox may report AltGraph for any Ctrl+Alt, so the character decides: "[" is not "f".
    expect(key(view, { key: "[", code: "KeyF", ctrlKey: true, altKey: true, modifierAltGraph: true } as KeyboardEventInit).defaultPrevented).toBe(false);
    expect(find.getSnapshot().open).toBe(false);
    expect(key(view, { key: "f", code: "KeyF", ctrlKey: true, altKey: true, modifierAltGraph: true } as KeyboardEventInit).defaultPrevented).toBe(true);
    expect(find.getSnapshot()).toMatchObject({ open: true, replaceOpen: true });
  });

  it("Ctrl+F and Ctrl+G on a non-Latin layout go by the physical key", async () => {
    const { find, view } = await open("a a\n");
    expect(key(view, { key: "а", code: "KeyF", ctrlKey: true }).defaultPrevented).toBe(true);
    find.setQuery("a");
    key(view, { key: "п", code: "KeyG", ctrlKey: true });
    expect(find.getSnapshot()).toMatchObject({ open: true, index: 1 });
    // A non-Latin character on another physical key is not F.
    find.close();
    expect(key(view, { key: "ф", code: "KeyA", ctrlKey: true }).defaultPrevented).toBe(false);
  });

  it("Ctrl+Alt+F on a non-Latin layout opens replace by the physical key", async () => {
    const { find, view } = await open("a\n");
    key(view, { key: "а", code: "KeyF", ctrlKey: true, altKey: true });
    expect(find.getSnapshot()).toMatchObject({ open: true, replaceOpen: true });
  });

  it("Mod-F with the bar open keeps the query the writer typed", async () => {
    const { find, view } = await open("hello world\n");
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 6)));
    key(view, { key: "f", ctrlKey: true });
    find.setQuery("cat");
    key(view, { key: "f", ctrlKey: true });
    expect(find.getSnapshot().query).toBe("cat");
  });

  it("leaves other keys, and a Mod-F with Shift, to the browser", async () => {
    const { view } = await open("a\n");
    expect(key(view, { key: "f" }).defaultPrevented).toBe(false);
    expect(key(view, { key: "F", ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(false);
  });
});

describe("living through the editor", () => {
  it("still notifies the bar after a whole-document replace (Mod-/ round trip, a newer revision)", async () => {
    const { editor, find } = await open("one\n");
    let calls = 0;
    find.subscribe(() => { calls += 1; });
    search(find, "two");
    editor.replaceMarkdown("two two\n");
    // The bar stays open on the same query, and finds it in the new document.
    expect(find.getSnapshot()).toMatchObject({ open: true, query: "two", total: 2 });
    const before = calls;
    find.setQuery("tw");
    expect(calls).toBeGreaterThan(before);
    expect(find.getSnapshot()).toMatchObject({ open: true, total: 2 });
  });

  it("leaves no match selected once the query finds nothing, so Escape and a keystroke overwrite nothing", async () => {
    const { find, view } = await open("alpha beta\n");
    search(find, "be");
    expect(selected(view)).toBe("be");
    find.setQuery("bex");
    find.close();
    expect(view.state.selection.empty).toBe(true);
    find.open();
    find.setQuery("");
    expect(view.state.selection.empty).toBe(true);
  });

  it("never collapses a selection the writer made, and never builds one inside a list (a block range)", async () => {
    const { find, view } = await open("alpha\n\n- one\n- two\n");
    let list = -1;
    view.state.doc.forEach((node, offset) => { if (node.type.name === "bullet_list") list = offset; });
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, list)));
    find.open();
    expect(find.getSnapshot().query).toBe("");
    find.setQuery("zzz");
    find.setMatchCase(true);
    expect(view.state.selection).toBeInstanceOf(NodeSelection);
    expect(view.state.selection.from).toBe(list);
  });

  it("keeps the current match, not the first, across a newer revision", async () => {
    const { editor, find, view } = await open("cat a\n\ncat b\n\ncat c\n\ncat d\n");
    search(find, "cat");
    find.step(1); find.step(1);
    expect(find.getSnapshot().index).toBe(2);
    editor.replaceMarkdown("cat a\n\ncat b\n\ncat c\n\ncat d\n\ncat e\n");
    expect(find.getSnapshot()).toMatchObject({ open: true, index: 2, total: 5 });
    find.replace("dog");
    expect(view.state.doc.child(2).textContent).toBe("dog c");
  });

  it("closing leaves the caret where the writer moved it, not at the match", async () => {
    const { find, view } = await open("one\n\ntwo\n\nthree\n");
    search(find, "one");
    const end = view.state.doc.content.size - 1;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, end)).insertText("!"));
    const caret = view.state.selection.from;
    find.close();
    expect(view.state.selection.from).toBe(caret);
  });

  it("after replacing the last match the replacement is not left selected", async () => {
    const { find, view } = await open("cat\n");
    search(find, "cat");
    find.replace("dog");
    expect(view.state.doc.textContent).toBe("dog");
    expect(view.state.selection.empty).toBe(true);
    expect(view.state.selection.from).toBe(4);
  });

  it("replacing the last match leaves a selection the writer made elsewhere alone", async () => {
    const { find, view } = await open("cat\n\nhello world\n");
    search(find, "cat");
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 7, 12)));
    find.replace("dog");
    expect(view.state.doc.child(0).textContent).toBe("dog");
    expect(selected(view)).toBe("ello ");
  });

  it("reopening on a kept query selects its current match", async () => {
    const { find, view } = await open("x\n\nfind me\n");
    search(find, "me");
    find.close();
    find.open();
    expect(selected(view)).toBe("me");
  });

  it("selects the current match as the query is typed", async () => {
    const { find, view } = await open("x\n\nfind me\n");
    search(find, "me");
    expect(selected(view)).toBe("me");
  });
});

describe("replacing", () => {
  it("replaces the current match and moves to the next", async () => {
    const { find, view, editor } = await open("cat one cat two cat\n");
    search(find, "cat");
    find.replace("dog");
    expect(editor.getMarkdown()).toBe("dog one cat two cat\n");
    expect(find.getSnapshot()).toMatchObject({ total: 2, index: 0 });
    expect(selected(view)).toBe("cat");
    find.replace("dog");
    expect(editor.getMarkdown()).toBe("dog one dog two cat\n");
  });

  it("does not loop on a replacement that contains the query", async () => {
    const { find, editor } = await open("a a\n");
    search(find, "a");
    find.replace("aa");
    find.replace("aa");
    expect(editor.getMarkdown()).toBe("aa aa\n");
  });

  it("replaces all in one transaction, and one undo takes it all back", async () => {
    const { find, view, editor } = await open("cat **cat**\n\nthe cat\n\n- cat\n");
    const before = editor.getMarkdown();
    search(find, "cat");
    let transactions = 0;
    const dispatch = view.dispatch.bind(view);
    view.dispatch = (tr) => { if (tr.docChanged) transactions += 1; dispatch(tr); };
    find.replaceAll("dog");
    expect(transactions).toBe(1);
    expect(editor.getMarkdown()).toBe("dog **dog**\n\nthe dog\n\n- dog\n");
    expect(find.getSnapshot()).toMatchObject({ total: 0, notice: "Replaced 4" });
    expect(undo(view.state, view.dispatch)).toBe(true);
    expect(editor.getMarkdown()).toBe(before);
  });

  it("is not merged into a quick edit before it", async () => {
    const { find, view, editor } = await open("cat\n");
    view.dispatch(view.state.tr.insertText("x", 1));
    search(find, "cat");
    find.replaceAll("dog");
    undo(view.state, view.dispatch);
    expect(editor.getMarkdown()).toBe("xcat\n");
  });

  it("gives the replacement the marks at the start of the match, and may delete", async () => {
    const { find, editor } = await open("a **bold** b\n");
    search(find, "bold");
    find.replaceAll("strong");
    expect(editor.getMarkdown()).toBe("a **strong** b\n");
    search(find, " b");
    find.replaceAll("");
    expect(editor.getMarkdown()).toBe("a **strong**\n");
  });

  it("replaces inside a code block", async () => {
    const { find, editor } = await open("```\nlet a = a;\n```\n");
    search(find, "a");
    find.replaceAll("b");
    expect(editor.getMarkdown()).toBe("```\nlet b = b;\n```\n");
  });

  it("changes nothing in a read-only editor", async () => {
    const { find, editor } = await open("cat\n", false);
    search(find, "cat");
    find.replaceAll("dog");
    find.replace("dog");
    expect(editor.getMarkdown()).toBe("cat\n");
    expect(find.getSnapshot().editable).toBe(false);
  });
});

describe("the links a saved document holds", () => {
  const withWiki = LINK_MARKDOWN_FIXTURES.filter((fixture) => fixture.links.some((link) => link.kind === "WIKI"));

  it.each(withWiki.map((fixture) => [fixture.name, fixture.markdown, fixture.links] as const))("%s: replace all in the text around them leaves them", async (_name, markdown, expected) => {
    const { find, editor } = await open(`${markdown.trimEnd()}\n\nSee e and see.\n`);
    search(find, "e");
    find.replaceAll("EE");
    // Only the text outside the links changed; every wikilink and path link is read back as it was.
    expect(links(editor.getMarkdown()).filter((link) => link.kind === "WIKI")).toEqual(expected.filter((link) => link.kind === "WIKI"));
  });

  it("leaves page mentions alone when the query is the page's own title", async () => {
    const markdown = "Read [[Needle]] and needle, [[Needle#Setup|needle]].\n";
    const { find, editor } = await open(markdown);
    search(find, "needle");
    find.replaceAll("thread");
    expect(editor.getMarkdown()).toBe("Read [[Needle]] and thread, [[Needle#Setup|needle]].\n");
    expect(links(editor.getMarkdown())).toEqual(links(markdown));
  });
});
