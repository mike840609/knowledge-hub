// @vitest-environment jsdom
import { editorViewCtx } from "@milkdown/kit/core";
import { Selection, TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { atMentionSuggest, dateRows } from "@/components/knowledge/editor/at-mention-suggest";
import { isIsoDate, isoDate } from "@/components/knowledge/editor/date-text";
import { createMarkdownEditor, type MarkdownEditor } from "@/components/knowledge/editor/editor-core";
import { wikiLinkSuggest } from "@/components/knowledge/editor/wikilink-suggest";
import type { LinkTargetView } from "@/modules/knowledge/application/knowledge-link-service";
import { extractDocumentLinks } from "@/modules/knowledge/domain/document-links";

/**
 * The `@` list (2026-11-25 spec), run inside the rendered editor. Layout is not something jsdom has; these pin what
 * it offers, which keys it takes, and what a pick writes. A page pick is read back through the link extractor, as
 * the link-index invariant asks: a pick written as text would be no link at all.
 */

const noRect = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) } as DOMRect;
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => noRect;

const NOW = new Date(2026, 10, 25, 12, 0, 0);
const opened: MarkdownEditor[] = [];
afterEach(async () => {
  while (opened.length) await opened.pop()!.destroy();
  document.body.innerHTML = "";
});
const flush = async () => { for (let turn = 0; turn < 5; turn += 1) await Promise.resolve(); };

function target(title: string, editedAt: string, sourceName = "Notes", documentId = `doc-${title}`): LinkTargetView {
  return { documentId, sourceId: "source-1", sourceName, title, editedAt };
}
const CATALOG = [
  target("Kubernetes", "2026-09-01T00:00:00.000Z"),
  target("Kube-proxy", "2026-09-03T00:00:00.000Z"),
  target("Airflow", "2026-09-02T00:00:00.000Z", "Data"),
  target("Todo list", "2026-09-04T00:00:00.000Z"),
];

async function open(config: { markdown?: string; editable?: boolean; targets?: LinkTargetView[]; loadTargets?: () => Promise<{ targets: LinkTargetView[]; truncated: boolean }>; exclude?: string } = {}) {
  const root = document.body.appendChild(document.createElement("div"));
  const loadTargets = vi.fn(config.loadTargets ?? (async () => ({ targets: config.targets ?? CATALOG, truncated: false })));
  const links = wikiLinkSuggest({ loadTargets });
  const mention = atMentionSuggest({ targets: links.targets, excludeDocumentId: () => config.exclude, now: () => NOW });
  const editor = await createMarkdownEditor({
    root, markdown: config.markdown ?? "", className: "kh-editor", ariaLabel: "Content", editable: config.editable ?? true,
    onUserEdit() {}, onMarkdown() {}, allowImage: () => false,
    extraPlugins: [...links.plugins, ...mention.plugins],
    configure: (ctx) => { links.configure(ctx); mention.configure(ctx); },
  });
  opened.push(editor);
  const view = editor.action((ctx) => ctx.get(editorViewCtx));
  view.focus();
  return { editor, view, loadTargets };
}

const type = (view: EditorView, text: string) => {
  for (const character of text) {
    const { from, to } = view.state.selection;
    if (!view.someProp("handleTextInput", (handler) => handler(view, from, to, character, () => view.state.tr.insertText(character, from, to)))) {
      view.dispatch(view.state.tr.insertText(character, from, to));
    }
  }
};
const KEY_CODES: Record<string, number> = { Enter: 13, Escape: 27, ArrowDown: 40, ArrowUp: 38, Tab: 9 };
const key = (view: EditorView, name: string, init: KeyboardEventInit = {}) => {
  const event = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init });
  Object.defineProperty(event, "keyCode", { value: KEY_CODES[name] ?? 0 });
  view.dom.dispatchEvent(event);
  return event;
};
const menu = () => document.querySelector<HTMLElement>(".kh-at-menu")!;
const rows = () => [...menu().querySelectorAll<HTMLElement>("[role='option']")];
const labels = () => rows().map((row) => row.children[0].textContent);
const headings = () => [...menu().querySelectorAll(".kh-at-heading")].map((heading) => heading.textContent);
const active = () => rows().find((row) => row.getAttribute("aria-selected") === "true")?.children[0].textContent;
const savedLinks = (editor: MarkdownEditor) => extractDocumentLinks(editor.getMarkdown()).map((link) => [link.kind, link.target, link.display]);
const atEnd = (view: EditorView) => view.dispatch(view.state.tr.setSelection(Selection.atEnd(view.state.doc)));

describe("date text", () => {
  it("writes the day in YYYY-MM-DD, with an offset", () => {
    expect(isoDate(0, NOW)).toBe("2026-11-25");
    expect(isoDate(1, NOW)).toBe("2026-11-26");
    expect(isoDate(-1, new Date(2026, 11, 1))).toBe("2026-11-30");
    expect(isoDate(1, new Date(2026, 11, 31))).toBe("2027-01-01");
  });
  it("accepts only real calendar days", () => {
    expect(isIsoDate("2026-12-01")).toBe(true);
    expect(isIsoDate("2028-02-29")).toBe(true);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("2026-13-01")).toBe(false);
    expect(isIsoDate("2026-1-1")).toBe(false);
  });
  it("matches dates by the prefix of a name or a Chinese word, and takes a typed day as itself", () => {
    expect(dateRows("", NOW).map((row) => row.label)).toEqual(["Today", "Tomorrow", "Yesterday"]);
    expect(dateRows("to", NOW).map((row) => row.label)).toEqual(["Today", "Tomorrow"]);
    expect(dateRows("明", NOW).map((row) => row.label)).toEqual(["Tomorrow"]);
    expect(dateRows("2026-12-01", NOW).map((row) => row.detail)).toEqual(["Date"]);
    expect(dateRows("2026-02-30", NOW)).toEqual([]);
    expect(dateRows("kube", NOW)).toEqual([]);
  });
});

describe("opening", () => {
  it("opens on `@` with the pages first and the dates after, each under one heading", async () => {
    const { view, loadTargets } = await open();
    type(view, "@");
    await flush();
    expect(menu().hidden).toBe(false);
    expect(headings()).toEqual(["Pages", "Dates"]);
    expect(labels()).toEqual(["Todo list", "Kube-proxy", "Airflow", "Kubernetes", "Today", "Tomorrow", "Yesterday"]);
    expect(rows().length).toBe(7);
    expect(loadTargets).toHaveBeenCalledTimes(1);
  });

  it("opens after whitespace", async () => {
    const { view } = await open({ markdown: "see" });
    atEnd(view);
    type(view, " @");
    expect(menu().hidden).toBe(false);
  });

  it("opens after an opening bracket, and after a Han character where no space is written", async () => {
    const bracket = await open({ markdown: "(" });
    atEnd(bracket.view);
    type(bracket.view, "@");
    expect(menu().hidden).toBe(false);
    await bracket.editor.destroy();
    opened.splice(opened.indexOf(bracket.editor), 1);
    document.body.innerHTML = "";
    const han = await open({ markdown: "中文" });
    atEnd(han.view);
    type(han.view, "@");
    expect(menu().hidden).toBe(false);
  });

  it("does not open inside a word", async () => {
    const { view } = await open({ markdown: "mail me at a" });
    atEnd(view);
    type(view, "@kube");
    expect(view.state.doc.textContent).toBe("mail me at a@kube");
    expect(menu().hidden).toBe(true);
  });

  it("does not open in an email-like word", async () => {
    const { view } = await open({ markdown: "a" });
    atEnd(view);
    type(view, "@b");
    expect(menu().hidden).toBe(true);
    expect(view.dom.getAttribute("aria-expanded")).not.toBe("true");
  });

  it("does not open in a code block", async () => {
    const { view } = await open({ markdown: "```\ncode\n```\n" });
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 4)));
    type(view, " @");
    expect(view.state.doc.textContent).toContain("@");
    expect(menu().hidden).toBe(true);
  });

  it("does not open in inline code", async () => {
    const { view } = await open({ markdown: "`ping x`" });
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 6)));
    type(view, "@");
    expect(view.state.doc.textContent).toBe("ping @x");
    expect(menu().hidden).toBe(true);
  });

  it("does not open for a caret placed after an `@word` already written", async () => {
    const { editor, view } = await open({ markdown: "ping @kube\n\nsecond" });
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 11)));
    await flush();
    expect(menu().hidden).toBe(true);
    expect(key(view, "ArrowDown").defaultPrevented).toBe(false);
    key(view, "Enter");
    expect(editor.getMarkdown()).toContain("ping @kube");
    expect(savedLinks(editor)).toEqual([]);
  });

  it("does not open in a read-only editor", async () => {
    const { view } = await open({ editable: false });
    type(view, "@");
    expect(menu().hidden).toBe(true);
  });

  it("stands down while a `[[` link is being written", async () => {
    const { view } = await open();
    type(view, "[[Kube @");
    await flush();
    expect(menu().hidden).toBe(true);
  });

  it("leaves a colon or a slash after the `@` to the emoji and `/` lists", async () => {
    const { view } = await open();
    type(view, "@kube:sm");
    expect(menu().hidden).toBe(true);
    const slash = await open();
    type(slash.view, "@x/h");
    expect([...document.querySelectorAll<HTMLElement>(".kh-at-menu")].every((popup) => popup.hidden)).toBe(true);
  });

  it("treats `@ ` followed by a space as prose, and closes when nothing answers", async () => {
    const { editor, view } = await open();
    type(view, "email me @ 5pm");
    expect(menu().hidden).toBe(true);
    type(view, " and then");
    expect(menu().hidden).toBe(true);
    const typed = await open();
    type(typed.view, "@zzzz");
    await flush();
    expect(menu().hidden).toBe(true);
    key(typed.view, "Enter");
    expect(typed.editor.getMarkdown()).toContain("@zzzz");
    expect(editor.getMarkdown()).toContain("5pm");
  });
});

describe("pages", () => {
  it("narrows with the query, and Enter writes the link the `[[` list writes", async () => {
    const { editor, view } = await open({ markdown: "See" });
    atEnd(view);
    type(view, " @kubern");
    await flush();
    expect(labels()).toEqual(["Kubernetes"]);
    expect(rows()[0].children[1].textContent).toBe("Notes");
    key(view, "Enter");
    expect(menu().hidden).toBe(true);
    expect(editor.getMarkdown()).toBe("See [[Kubernetes]]\n");
    expect(savedLinks(editor)).toEqual([["WIKI", "Kubernetes", null]]);
    // A wiki_link node, not text that looks like one.
    let nodes = 0;
    view.state.doc.descendants((node) => { if (node.type.name === "wiki_link") nodes += 1; });
    expect(nodes).toBe(1);
  });

  it("matches a title with spaces, and keeps the rendered editor's round trip", async () => {
    const { editor, view } = await open();
    type(view, "@todo li");
    await flush();
    expect(labels()).toEqual(["Todo list"]);
    key(view, "Tab");
    expect(editor.getMarkdown()).toBe("[[Todo list]]\n");
    type(view, " next");
    expect(editor.getMarkdown()).toBe("[[Todo list]] next\n");
    expect(savedLinks(editor)).toEqual([["WIKI", "Todo list", null]]);
  });

  it("a click on a row picks it and keeps the caret in the editor", async () => {
    const { editor, view } = await open();
    type(view, "@airf");
    await flush();
    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 });
    rows()[0].dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    expect(editor.getMarkdown()).toBe("[[Airflow]]\n");
  });

  it("does not offer the document being written", async () => {
    const { view } = await open({ exclude: "doc-Kubernetes" });
    type(view, "@kubern");
    await flush();
    expect(menu().hidden).toBe(true);
  });

  it("one undo takes back the pick and leaves what was typed", async () => {
    const { view } = await open();
    const { undo } = await import("@milkdown/kit/prose/history");
    type(view, "@kubern");
    await flush();
    key(view, "Enter");
    undo(view.state, view.dispatch);
    expect(view.state.doc.textContent).toBe("@kubern");
  });

  it("says the pages are loading, then offers them when they arrive; dates work meanwhile", async () => {
    let arrive: (value: { targets: LinkTargetView[]; truncated: boolean }) => void = () => {};
    const { view } = await open({ loadTargets: () => new Promise((resolve) => { arrive = resolve; }) });
    type(view, "@");
    expect(menu().textContent).toContain("Loading pages…");
    expect(labels()).toEqual(["Today", "Tomorrow", "Yesterday"]);
    arrive({ targets: CATALOG, truncated: false });
    await flush();
    expect(menu().textContent).not.toContain("Loading pages…");
    expect(labels()).toContain("Kubernetes");
  });

  it("says so when the pages could not be loaded, and the dates still work", async () => {
    const { editor, view } = await open({ loadTargets: async () => { throw new Error("offline"); } });
    type(view, "@");
    await flush();
    expect(menu().textContent).toContain("Couldn't load pages.");
    key(view, "Enter");
    expect(editor.getMarkdown()).toBe(`${isoDate(0, new Date())}\n`);
  });
});

describe("dates", () => {
  it.each([["@tod", 0, "Today"], ["@tom", 1, "Tomorrow"], ["@yes", -1, "Yesterday"]])("%s writes the day as plain text", async (typed, offset, label) => {
    const { editor, view } = await open();
    type(view, typed);
    await flush();
    expect(active()).toBe(label);
    key(view, "Enter");
    expect(editor.getMarkdown()).toBe(`${isoDate(offset, NOW)}\n`);
    expect(savedLinks(editor)).toEqual([]);
  });

  it("puts the date first when its name begins what was typed", async () => {
    const { view } = await open();
    type(view, "@to");
    await flush();
    expect(headings()).toEqual(["Dates", "Pages"]);
    expect(active()).toBe("Today");
    expect(labels()).toContain("Todo list");
  });

  it("takes a typed day as itself", async () => {
    const { editor, view } = await open({ markdown: "Due" });
    atEnd(view);
    type(view, " @2026-12-01");
    await flush();
    expect(labels()).toEqual(["2026-12-01"]);
    key(view, "Enter");
    expect(editor.getMarkdown()).toBe("Due 2026-12-01\n");
  });

  it("writes the same text `/Today's date` writes", async () => {
    // slash-commands.ts calls `isoDate()` too; the date helper is their one source.
    expect(isoDate()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const { editor, view } = await open();
    type(view, "@today");
    key(view, "Enter");
    expect(editor.getMarkdown()).toBe(`${isoDate(0, NOW)}\n`);
  });
});

describe("keys", () => {
  it("moves across groups with the arrows and wraps", async () => {
    const { editor, view } = await open();
    type(view, "@");
    await flush();
    expect(active()).toBe("Todo list");
    key(view, "ArrowUp");
    expect(active()).toBe("Yesterday");
    key(view, "ArrowDown");
    expect(active()).toBe("Todo list");
    for (let step = 0; step < 4; step += 1) key(view, "ArrowDown");
    expect(active()).toBe("Today");
    key(view, "Enter");
    expect(editor.getMarkdown()).toBe(`${isoDate(0, NOW)}\n`);
  });

  it("Escape closes and leaves `@query` as text", async () => {
    const { editor, view } = await open();
    type(view, "@kube");
    await flush();
    const escape = key(view, "Escape");
    expect(escape.defaultPrevented).toBe(true);
    expect(menu().hidden).toBe(true);
    expect(view.dom.getAttribute("aria-expanded")).not.toBe("true");
    expect(editor.getMarkdown()).toBe("@kube\n");
    // Typing on does not reopen the dismissed list at the same `@`; Enter is the editor's again.
    type(view, "r");
    expect(menu().hidden).toBe(true);
  });

  it("leaves Shift-Tab to the editor while the list is open", async () => {
    const { view } = await open({ markdown: "- item\n" });
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 4)));
    type(view, " @kube");
    await flush();
    key(view, "Tab", { shiftKey: true });
    expect(view.state.doc.textContent).toContain("@kube");
    expect(savedLinks({ getMarkdown: () => view.state.doc.textContent } as MarkdownEditor)).toEqual([]);
  });

  it("with the list closed, Enter and the arrows are the editor's", async () => {
    const { view } = await open({ markdown: "plain" });
    atEnd(view);
    expect(key(view, "ArrowDown").defaultPrevented).toBe(false);
    key(view, "Enter");
    expect(view.state.doc.childCount).toBe(2);
  });
});

describe("accessibility", () => {
  it("is a listbox of options in named groups, and the editor is a combobox naming the chosen one", async () => {
    const { view } = await open();
    type(view, "@");
    await flush();
    const listbox = menu().querySelector<HTMLElement>("[role='listbox']")!;
    expect(listbox.getAttribute("aria-label")).toBe("Mentions");
    const groups = [...listbox.querySelectorAll<HTMLElement>("[role='group']")];
    expect(groups.map((group) => document.getElementById(group.getAttribute("aria-labelledby")!)?.textContent)).toEqual(["Pages", "Dates"]);
    expect(view.dom.getAttribute("role")).toBe("combobox");
    expect(view.dom.getAttribute("aria-expanded")).toBe("true");
    expect(view.dom.getAttribute("aria-controls")).toBe(listbox.id);
    const chosen = rows().find((row) => row.getAttribute("aria-selected") === "true")!;
    expect(view.dom.getAttribute("aria-activedescendant")).toBe(chosen.id);
    key(view, "ArrowDown");
    const next = rows().find((row) => row.getAttribute("aria-selected") === "true")!;
    expect(next).not.toBe(chosen);
    expect(view.dom.getAttribute("aria-activedescendant")).toBe(next.id);
    expect(menu().querySelector("[aria-live=polite]")?.textContent).toBe("7 suggestions.");
  });

  it("gives the combobox back when it closes", async () => {
    const { view } = await open();
    type(view, "@");
    await flush();
    key(view, "Escape");
    expect(view.dom.getAttribute("aria-controls")).toBeNull();
    expect(view.dom.getAttribute("aria-activedescendant")).toBeNull();
  });
});
