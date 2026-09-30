// @vitest-environment jsdom
import { editorViewCtx } from "@milkdown/kit/core";
import { Selection, TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMarkdownEditor, type MarkdownEditor } from "@/components/knowledge/editor/editor-core";
import { TARGETS_REFRESH_MS, TARGETS_RETRY_MS, wikiLinkSuggest, type LinkTargetsResult } from "@/components/knowledge/editor/wikilink-suggest";
import type { LinkTargetView } from "@/modules/knowledge/application/knowledge-link-service";
import { extractDocumentLinks } from "@/modules/knowledge/domain/document-links";

/**
 * The `[[` list, run inside the rendered editor (daily-driver spec §6.1). Layout is not something
 * jsdom has, so nothing here asserts where the list is; these pin what it offers, which keys it
 * takes, what a pick writes into the document, and that a refusal or a failure leaves the document
 * and the typing alone. What a saved document holds is read back through the extractor, as the
 * link-index invariant asks: a pick that was written as text would be no link at all.
 */

const noRect = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) } as DOMRect;
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => noRect;

const opened: MarkdownEditor[] = [];
afterEach(async () => {
  vi.useRealTimers();
  while (opened.length) await opened.pop()!.destroy();
  document.body.innerHTML = "";
});

const flush = async () => {
  // A fetch that resolved, and the `finally` after it.
  for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
};

function target(title: string, editedAt: string, sourceName = "Notes", documentId = `doc-${title}`): LinkTargetView {
  return { documentId, sourceId: "source-1", sourceName, title, editedAt };
}
const CATALOG = [
  target("Kubernetes", "2026-09-01T00:00:00.000Z"),
  target("Kube-proxy", "2026-09-03T00:00:00.000Z"),
  target("Airflow", "2026-09-02T00:00:00.000Z", "Data"),
];

type Options = {
  markdown?: string;
  targets?: LinkTargetView[];
  truncated?: boolean;
  loadTargets?: () => Promise<LinkTargetsResult>;
  excludeDocumentId?: string;
  now?: () => number;
  editable?: boolean;
};

async function open(options: Options = {}) {
  const root = document.createElement("div");
  document.body.appendChild(root);
  const loadTargets = vi.fn(options.loadTargets ?? (async () => ({ targets: options.targets ?? CATALOG, truncated: options.truncated ?? false })));
  const suggest = wikiLinkSuggest({ loadTargets, excludeDocumentId: () => options.excludeDocumentId, now: options.now });
  const onMarkdown = vi.fn();
  const editor = await createMarkdownEditor({
    root,
    markdown: options.markdown ?? "Start ",
    className: "kh-editor",
    ariaLabel: "Content",
    editable: options.editable ?? true,
    onUserEdit: () => {},
    onMarkdown,
    allowImage: () => false,
    extraPlugins: suggest.plugins,
    configure: suggest.configure,
  });
  opened.push(editor);
  return { root, editor, loadTargets };
}

const viewOf = (editor: MarkdownEditor): EditorView => editor.action((ctx) => ctx.get(editorViewCtx));
const domOf = (editor: MarkdownEditor): HTMLElement => viewOf(editor).dom as HTMLElement;

/** Focus, with the caret at the end of the first textblock. */
function focusAtEnd(editor: MarkdownEditor) {
  const view = viewOf(editor);
  view.dom.focus();
  view.dispatch(view.state.tr.setSelection(Selection.atEnd(view.state.doc)));
}

/** Typing, one character at a time as the browser reports it: input rules see each one before it lands. */
function typeText(editor: MarkdownEditor, text: string) {
  const view = viewOf(editor);
  for (const character of text) {
    const { from, to } = view.state.selection;
    if (!view.someProp("handleTextInput", (handler) => handler(view, from, to, character, () => view.state.tr.insertText(character, from, to)))) {
      view.dispatch(view.state.tr.insertText(character, from, to));
    }
  }
}

function press(editor: MarkdownEditor, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  domOf(editor).dispatchEvent(event);
  return event;
}

const popup = () => document.querySelector<HTMLElement>(".kh-wikilink-suggest");
const isShown = () => popup()?.dataset.show === "true";
const options = () => [...document.querySelectorAll<HTMLElement>(".kh-wikilink-suggest [role=option]")];
const titles = () => options().map((row) => row.children[0].textContent);
const activeTitle = () => options().find((row) => row.getAttribute("aria-selected") === "true")?.children[0].textContent;
const message = () => popup()!.querySelector<HTMLElement>("p")!;
const announced = () => popup()?.querySelector("[aria-live=polite]")?.textContent;

/** The links a saved document holds, read the way the link index reads them. */
const savedLinks = (editor: MarkdownEditor) => extractDocumentLinks(editor.getMarkdown()).map((link) => [link.kind, link.target, link.display]);

describe("opening", () => {
  it("offers the documents once `[[` is typed, newest first, each with its source", async () => {
    const { editor, loadTargets } = await open();
    focusAtEnd(editor);
    expect(isShown()).toBe(false);
    typeText(editor, "[[");
    await flush();
    expect(isShown()).toBe(true);
    expect(titles()).toEqual(["Kube-proxy", "Airflow", "Kubernetes"]);
    expect(options().map((row) => row.children[1].textContent)).toEqual(["Notes", "Data", "Notes"]);
    expect(loadTargets).toHaveBeenCalledTimes(1);
  });

  it("does not fetch anything until a link is being written", async () => {
    const { editor, loadTargets } = await open();
    focusAtEnd(editor);
    typeText(editor, "just text, [one bracket and a [ b");
    await flush();
    expect(loadTargets).not.toHaveBeenCalled();
    expect(popup()?.dataset.show).not.toBe("true");
  });

  it("narrows as the name is typed, best match first, and says how many there are", async () => {
    const { editor } = await open();
    focusAtEnd(editor);
    typeText(editor, "[[kube");
    await flush();
    expect(titles()).toEqual(["Kube-proxy", "Kubernetes"]);
    expect(announced()).toBe("2 suggestions.");
    typeText(editor, "rn");
    expect(titles()).toEqual(["Kubernetes"]);
    expect(announced()).toBe("1 suggestion.");
  });

  it("says so when nothing fits, and leaves Enter to the editor", async () => {
    const { editor } = await open();
    focusAtEnd(editor);
    typeText(editor, "[[zookeeper");
    await flush();
    expect(isShown()).toBe(true);
    expect(options()).toEqual([]);
    expect(message().textContent).toBe("No matching documents.");
    press(editor, "Enter");
    // The editor's own Enter ran: the paragraph was split, and nothing was made into a link.
    expect(viewOf(editor).state.doc.childCount).toBe(2);
    expect(viewOf(editor).state.doc.firstChild!.textContent).toContain("[[zookeeper");
    expect(savedLinks(editor)).toEqual([]);
  });

  it("says when the list it searched was cut", async () => {
    const { editor } = await open({ truncated: true });
    focusAtEnd(editor);
    typeText(editor, "[[zookeeper");
    await flush();
    expect(message().textContent).toBe("No match among the 3 most recently edited documents.");
  });

  it("closes when the link is finished or abandoned", async () => {
    const { editor } = await open();
    focusAtEnd(editor);
    typeText(editor, "[[Kube");
    await flush();
    expect(isShown()).toBe(true);
    typeText(editor, "|the cluster");
    expect(isShown()).toBe(false);
  });

  it("does not offer the document that is being written to itself", async () => {
    const { editor } = await open({ excludeDocumentId: "doc-Kubernetes" });
    focusAtEnd(editor);
    typeText(editor, "[[");
    await flush();
    expect(titles()).toEqual(["Kube-proxy", "Airflow"]);
  });
});

describe("where `[[` is not the start of a link", () => {
  async function typedIn(markdown: string, place: (editor: MarkdownEditor) => void, text = "[[Kube") {
    const { editor, loadTargets } = await open({ markdown });
    focusAtEnd(editor);
    place(editor);
    typeText(editor, text);
    await flush();
    return { editor, loadTargets };
  }

  it("is not one in a code block", async () => {
    const { loadTargets } = await typedIn("```\ncode\n```\n", () => {});
    expect(isShown()).toBe(false);
    expect(loadTargets).not.toHaveBeenCalled();
  });

  it("is not one in inline code", async () => {
    const { editor } = await open({ markdown: "run `xyz`" });
    const view = viewOf(editor);
    view.dom.focus();
    // Inside the code span, after the `x`: at its end the mark is not in force, and what is typed there is text.
    let inside = 0;
    view.state.doc.descendants((node, pos) => {
      if (node.isText && node.marks.some((mark) => mark.type.name === "inlineCode")) inside = pos + 1;
    });
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, inside)));
    typeText(editor, "[[Kube");
    await flush();
    expect(isShown()).toBe(false);
  });

  it("is not one inside a link's text", async () => {
    const { editor } = await open({ markdown: "see [docs](https://example.com/docs)" });
    const view = viewOf(editor);
    view.dom.focus();
    let inside = 0;
    view.state.doc.descendants((node, pos) => {
      if (node.isText && node.marks.some((mark) => mark.type.name === "link")) inside = pos + node.nodeSize;
    });
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, inside)));
    typeText(editor, "[[Kube");
    await flush();
    expect(isShown()).toBe(false);
  });

  it.each(["`[[`", "[\\[\\[](https://example.com/docs)"])("does not complete brackets in preceding marked text: %s", async (markdown) => {
    const { editor, loadTargets } = await open({ markdown });
    focusAtEnd(editor);
    const view = viewOf(editor);
    // Type ordinary text after the mark, without extending its formatting.
    view.dispatch(view.state.tr.setStoredMarks([]));
    typeText(editor, "air");
    await flush();
    expect(isShown()).toBe(false);
    expect(loadTargets).not.toHaveBeenCalled();
    press(editor, "Enter");
    expect(savedLinks(editor)).toEqual([]);
    expect(editor.getMarkdown()).toContain(markdown);
  });

  it("completes a new trigger after inline code without replacing the code", async () => {
    const { editor } = await open({ markdown: "`[[`" });
    focusAtEnd(editor);
    typeText(editor, " [[air");
    await flush();
    expect(isShown()).toBe(true);
    press(editor, "Enter");
    expect(savedLinks(editor)).toEqual([["WIKI", "Airflow", null]]);
    expect(editor.getMarkdown()).toContain("`[[`");
  });

  it("is not one after a backslash, or an exclamation mark", async () => {
    await typedIn("Start ", () => {}, "\\[[Kube");
    expect(isShown()).toBe(false);
    await typedIn("Start ", () => {}, "![[Kube");
    expect(isShown()).toBe(false);
  });

  it("is not one when something is selected", async () => {
    const { editor } = await open();
    focusAtEnd(editor);
    typeText(editor, "[[Kubex");
    await flush();
    expect(isShown()).toBe(true);
    // The last letter selected: what is before its start is still a link being written, but nothing is being typed.
    const view = viewOf(editor);
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, view.state.selection.to - 1, view.state.selection.to)));
    expect(isShown()).toBe(false);
  });

  it("is one in a list item and in a table cell, as anywhere else text is", async () => {
    await typedIn("- item", () => {});
    expect(isShown()).toBe(true);
  });

  it("is not offered in a read-only editor", async () => {
    const { editor } = await open({ editable: true });
    focusAtEnd(editor);
    typeText(editor, "[[Kube");
    await flush();
    expect(isShown()).toBe(true);
    editor.setEditable(false);
    expect(isShown()).toBe(false);
    press(editor, "ArrowDown");
    expect(savedLinks(editor)).toEqual([]);
  });
});

describe("choosing", () => {
  it("puts the link into the document as a link: it is in the saved Markdown, and the index would find it", async () => {
    const { editor } = await open();
    focusAtEnd(editor);
    typeText(editor, "[[kube");
    await flush();
    expect(activeTitle()).toBe("Kube-proxy");
    press(editor, "ArrowDown");
    expect(activeTitle()).toBe("Kubernetes");
    const enter = press(editor, "Enter");
    expect(enter.defaultPrevented).toBe(true);
    expect(isShown()).toBe(false);

    const markdown = editor.getMarkdown();
    expect(markdown).toContain("[[Kubernetes]]");
    expect(markdown).not.toContain("\\[");
    expect(markdown).not.toContain("kube");
    expect(savedLinks(editor)).toEqual([["WIKI", "Kubernetes", null]]);
    // And it survives being opened and saved again: the node reads back as it was written.
    editor.replaceMarkdown(markdown);
    expect(editor.getMarkdown()).toBe(markdown);
  });

  it("leaves the caret after the link, so typing goes on from there", async () => {
    const { editor } = await open({ markdown: "See" });
    focusAtEnd(editor);
    typeText(editor, " [[air");
    await flush();
    press(editor, "Enter");
    typeText(editor, " for jobs.");
    expect(editor.getMarkdown().trim()).toBe("See [[Airflow]] for jobs.");
  });

  it("replaces only the text it was asked about, in the middle of a paragraph too", async () => {
    const { editor } = await open({ markdown: "Before  after" });
    const view = viewOf(editor);
    view.dom.focus();
    // Between the two spaces.
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1 + "Before ".length)));
    typeText(editor, "[[Airf");
    await flush();
    press(editor, "Tab");
    expect(editor.getMarkdown().trim()).toBe("Before [[Airflow]] after");
  });

  it("takes Tab as well as Enter", async () => {
    const { editor } = await open();
    focusAtEnd(editor);
    typeText(editor, "[[air");
    await flush();
    const tab = press(editor, "Tab");
    expect(tab.defaultPrevented).toBe(true);
    expect(savedLinks(editor)).toEqual([["WIKI", "Airflow", null]]);
  });

  it("takes a click on a row, and the editor keeps the caret", async () => {
    const { editor } = await open();
    focusAtEnd(editor);
    typeText(editor, "[[");
    await flush();
    const row = options().find((option) => option.children[0].textContent === "Airflow")!;
    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    row.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    expect(savedLinks(editor)).toEqual([["WIKI", "Airflow", null]]);
  });

  it.each([1, 2])("does not choose on mouse button %s", async (button) => {
    const { editor } = await open();
    focusAtEnd(editor);
    typeText(editor, "[[air");
    await flush();
    const before = editor.getMarkdown();
    options()[0].dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button }));
    expect(editor.getMarkdown()).toBe(before);
    expect(savedLinks(editor)).toEqual([]);
    expect(isShown()).toBe(true);
  });

  it("wraps from the last row to the first, and back", async () => {
    const { editor } = await open();
    focusAtEnd(editor);
    typeText(editor, "[[");
    await flush();
    expect(activeTitle()).toBe("Kube-proxy");
    press(editor, "ArrowUp");
    expect(activeTitle()).toBe("Kubernetes");
    press(editor, "ArrowDown");
    expect(activeTitle()).toBe("Kube-proxy");
  });

  it("goes back to the first row when what is typed changes", async () => {
    const { editor } = await open();
    focusAtEnd(editor);
    typeText(editor, "[[");
    await flush();
    press(editor, "ArrowDown");
    expect(activeTitle()).toBe("Airflow");
    typeText(editor, "k");
    expect(activeTitle()).toBe("Kube-proxy");
  });

  it("can be undone in one step, back to what was typed", async () => {
    const { editor } = await open();
    focusAtEnd(editor);
    typeText(editor, "[[air");
    await flush();
    press(editor, "Enter");
    expect(editor.getMarkdown()).toContain("[[Airflow]]");
    const { undo } = await import("@milkdown/kit/prose/history");
    const view = viewOf(editor);
    undo(view.state, view.dispatch);
    expect(view.state.doc.textContent).toContain("[[air");
    expect(view.state.doc.textContent).not.toContain("Airflow");
  });

  it("undoes following typing separately from accepting a suggestion", async () => {
    const { editor } = await open({ markdown: "See" });
    focusAtEnd(editor);
    typeText(editor, " [[air");
    await flush();
    const before = editor.getMarkdown();
    press(editor, "Enter");
    const picked = editor.getMarkdown();
    typeText(editor, " suffix");
    const { undo, redo } = await import("@milkdown/kit/prose/history");
    const view = viewOf(editor);
    undo(view.state, view.dispatch);
    expect(editor.getMarkdown()).toBe(picked);
    undo(view.state, view.dispatch);
    expect(editor.getMarkdown()).toBe(before);
    redo(view.state, view.dispatch);
    expect(editor.getMarkdown()).toBe(picked);
    redo(view.state, view.dispatch);
    expect(editor.getMarkdown().trim()).toBe("See [[Airflow]] suffix");
  });

  it("writes a title as the resolver reads it, for a title with spaces, Chinese and an accent", async () => {
    const { editor } = await open({
      targets: [target("Naïve  Bayes notes", "2026-09-01T00:00:00.000Z"), target("知識庫 2026", "2026-09-02T00:00:00.000Z")],
    });
    for (const [query, expected] of [["naïve", "Naïve  Bayes notes"], ["知識", "知識庫 2026"]] as const) {
      editor.replaceMarkdown("Start ");
      focusAtEnd(editor);
      typeText(editor, `[[${query}`);
      await flush();
      press(editor, "Enter");
      expect(savedLinks(editor)).toEqual([["WIKI", expected, null]]);
    }
  });
});

describe("keys that are not the list's", () => {
  it("leaves Esc to close the list, and the document as it was", async () => {
    const { editor } = await open();
    focusAtEnd(editor);
    typeText(editor, "[[Kub");
    await flush();
    const before = editor.getMarkdown();
    const reaching = vi.fn();
    document.body.addEventListener("keydown", reaching);
    const escape = press(editor, "Escape");
    document.body.removeEventListener("keydown", reaching);
    expect(escape.defaultPrevented).toBe(true);
    // The composer leaves the page on Esc; here it only closes the list.
    expect(reaching).not.toHaveBeenCalled();
    expect(isShown()).toBe(false);
    expect(editor.getMarkdown()).toBe(before);
    expect(viewOf(editor).state.doc.textContent).toContain("[[Kub");
  });

  it("stays closed while that link is typed on, and opens again for the next one", async () => {
    const { editor } = await open();
    focusAtEnd(editor);
    typeText(editor, "[[Kub");
    await flush();
    press(editor, "Escape");
    typeText(editor, "ern");
    expect(isShown()).toBe(false);
    typeText(editor, " and [[");
    expect(isShown()).toBe(true);
  });

  it("opens again when the caret comes back to a link it had dismissed, since it left it in between", async () => {
    const { editor } = await open();
    focusAtEnd(editor);
    typeText(editor, "[[Kub");
    await flush();
    const view = viewOf(editor);
    const end = view.state.selection.to;
    press(editor, "Escape");
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)));
    expect(isShown()).toBe(false);
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, end)));
    expect(isShown()).toBe(true);
  });

  it("gives Esc back to the page when there is no list", async () => {
    const { editor } = await open();
    focusAtEnd(editor);
    const reaching = vi.fn();
    document.body.addEventListener("keydown", reaching);
    const escape = press(editor, "Escape");
    document.body.removeEventListener("keydown", reaching);
    expect(escape.defaultPrevented).toBe(false);
    expect(reaching).toHaveBeenCalled();
  });

  it.each([
    ["reports it while composing", { isComposing: true }],
    ["reports it as keyCode 229", { keyCode: 229 }],
  ] as const)("does not take an input method's Enter, which chooses its own candidate (%s)", async (_how, init) => {
    const { editor } = await open();
    focusAtEnd(editor);
    typeText(editor, "[[air");
    await flush();
    // Not the list's: nothing was chosen. (What the editor does with a key is its own business.)
    press(editor, "Enter", init);
    expect(savedLinks(editor)).toEqual([]);
    expect(viewOf(editor).state.doc.textContent).toContain("[[air");
    expect(viewOf(editor).state.doc.textContent).not.toContain("Airflow");
  });

  it("does not take ⌘Enter, which saves", async () => {
    const { editor } = await open();
    focusAtEnd(editor);
    typeText(editor, "[[air");
    await flush();
    const before = editor.getMarkdown();
    press(editor, "Enter", { metaKey: true });
    press(editor, "Enter", { ctrlKey: true });
    expect(editor.getMarkdown()).toBe(before);
    expect(savedLinks(editor)).toEqual([]);
  });

  it("leaves Shift+Enter and Shift+arrows alone", async () => {
    const { editor } = await open();
    focusAtEnd(editor);
    typeText(editor, "[[air");
    await flush();
    expect(press(editor, "ArrowDown", { shiftKey: true }).defaultPrevented).toBe(false);
    expect(activeTitle()).toBe("Airflow");
    expect(savedLinks(editor)).toEqual([]);
  });

  it("leaves Shift+Enter to the editor, which breaks the line", async () => {
    const { editor } = await open();
    focusAtEnd(editor);
    typeText(editor, "[[air");
    await flush();
    press(editor, "Enter", { shiftKey: true });
    expect(savedLinks(editor)).toEqual([]);
    expect(viewOf(editor).state.doc.textContent).toContain("[[air");
  });

  it("keeps the editor's own claim on ⌘Enter, which is the composer's Save, list or no list", async () => {
    const { editor } = await open({ markdown: "```\ncode\n```\n" });
    const view = viewOf(editor);
    view.dom.focus();
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 3)));
    const before = view.state.doc.childCount;
    // Ctrl, which is `Mod` where these tests run; ⌘ is the same key on a Mac.
    press(editor, "Enter", { ctrlKey: true });
    // ProseMirror's own ⌘Enter would leave the code block by adding a paragraph after it.
    expect(view.state.doc.childCount).toBe(before);
  });

  it("does not take Enter or the arrows when no list is showing", async () => {
    const { editor } = await open();
    focusAtEnd(editor);
    typeText(editor, "plain");
    expect(press(editor, "ArrowDown").defaultPrevented).toBe(false);
    expect(press(editor, "Tab").defaultPrevented).toBe(false);
  });
});

describe("the list for someone using a screen reader", () => {
  it("makes the editor a combobox while the list is open, and puts it back when it closes", async () => {
    const { editor } = await open();
    focusAtEnd(editor);
    const dom = domOf(editor);
    const roleBefore = dom.getAttribute("role");
    typeText(editor, "[[");
    await flush();
    const listbox = document.getElementById(dom.getAttribute("aria-controls")!)!;
    expect(dom.getAttribute("role")).toBe("combobox");
    expect(dom.getAttribute("aria-expanded")).toBe("true");
    expect(dom.getAttribute("aria-haspopup")).toBe("listbox");
    expect(listbox.getAttribute("role")).toBe("listbox");
    expect(listbox.getAttribute("aria-label")).toBe("Documents to link to");
    const active = document.getElementById(dom.getAttribute("aria-activedescendant")!)!;
    expect(active.getAttribute("role")).toBe("option");
    expect(active.getAttribute("aria-selected")).toBe("true");
    expect(announced()).toBe("3 suggestions.");
    press(editor, "ArrowDown");
    expect(document.getElementById(dom.getAttribute("aria-activedescendant")!)!.textContent).toContain("Airflow");

    press(editor, "Escape");
    expect(dom.getAttribute("role")).toBe(roleBefore);
    for (const name of ["aria-expanded", "aria-controls", "aria-activedescendant", "aria-haspopup", "aria-autocomplete"]) {
      expect(dom.hasAttribute(name), name).toBe(false);
    }
  });

  it("is not expanded while it only has a message to give, and does not point at a row that is not there", async () => {
    const { editor } = await open();
    focusAtEnd(editor);
    typeText(editor, "[[zookeeper");
    await flush();
    const dom = domOf(editor);
    expect(dom.getAttribute("aria-expanded")).toBe("false");
    expect(dom.hasAttribute("aria-activedescendant")).toBe(false);
    expect(announced()).toBe("No matching documents.");
  });

  it("uses a live region of its own, leaving the page's status to the toasts", async () => {
    const { editor } = await open();
    focusAtEnd(editor);
    typeText(editor, "[[");
    await flush();
    expect(popup()!.querySelector("[role=status]")).toBeNull();
    expect(popup()!.querySelector("[aria-live=polite]")).not.toBeNull();
  });
});

describe("focus", () => {
  it("hides the list when the editor loses focus, and shows it again when it comes back", async () => {
    const { editor } = await open();
    focusAtEnd(editor);
    typeText(editor, "[[Kube");
    await flush();
    expect(isShown()).toBe(true);
    domOf(editor).dispatchEvent(new FocusEvent("blur", { relatedTarget: null }));
    expect(isShown()).toBe(false);
    // A key pressed while the list is not showing is not the list's: not claimed, and Esc goes on to the page.
    expect(press(editor, "ArrowDown").defaultPrevented).toBe(false);
    expect(press(editor, "Escape").defaultPrevented).toBe(false);
    domOf(editor).dispatchEvent(new FocusEvent("focus"));
    expect(isShown()).toBe(true);
  });

  it("keeps the caret in the document when the list is pressed", async () => {
    const { editor } = await open();
    focusAtEnd(editor);
    typeText(editor, "[[");
    await flush();
    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    popup()!.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
  });
});

describe("the list of documents", () => {
  it("says so when it cannot be fetched, and typing goes on", async () => {
    const { editor, loadTargets } = await open({ loadTargets: async () => { throw new Error("offline"); } });
    focusAtEnd(editor);
    typeText(editor, "[[Kub");
    await flush();
    expect(isShown()).toBe(true);
    expect(options()).toEqual([]);
    expect(message().textContent).toBe("Couldn't load suggestions. You can still type the link out.");
    expect(announced()).toBe("Couldn't load suggestions. You can still type the link out.");
    // Enter is the editor's: it splits the paragraph, and the text is not made into anything.
    press(editor, "Enter");
    expect(viewOf(editor).state.doc.childCount).toBe(2);
    editor.replaceMarkdown("Start ");
    focusAtEnd(editor);
    typeText(editor, "[[Kubernetes]]");
    expect(savedLinks(editor)).toEqual([["WIKI", "Kubernetes", null]]);
    expect(loadTargets).toHaveBeenCalledTimes(1);
  });

  it("shows that it is loading until the list arrives", async () => {
    let arrive!: (result: LinkTargetsResult) => void;
    const { editor } = await open({ loadTargets: () => new Promise<LinkTargetsResult>((resolve) => { arrive = resolve; }) });
    focusAtEnd(editor);
    typeText(editor, "[[air");
    expect(message().textContent).toBe("Loading documents…");
    press(editor, "Enter");
    expect(savedLinks(editor)).toEqual([]);
    expect(viewOf(editor).state.doc.childCount).toBe(2);
    editor.replaceMarkdown("Start ");
    focusAtEnd(editor);
    typeText(editor, "[[air");
    arrive({ targets: CATALOG, truncated: false });
    await flush();
    expect(titles()).toEqual(["Airflow"]);
  });

  it("tries again after a failure, but not on every key", async () => {
    let clock = 1_000;
    let fail = true;
    const { editor, loadTargets } = await open({
      now: () => clock,
      loadTargets: async () => {
        if (fail) throw new Error("offline");
        return { targets: CATALOG, truncated: false };
      },
    });
    focusAtEnd(editor);
    typeText(editor, "[[Kub");
    await flush();
    typeText(editor, "e");
    await flush();
    expect(loadTargets).toHaveBeenCalledTimes(1);
    fail = false;
    clock += TARGETS_RETRY_MS;
    typeText(editor, "r");
    await flush();
    expect(loadTargets).toHaveBeenCalledTimes(2);
    expect(titles()).toEqual(["Kubernetes"]);
  });

  it("is fetched once, and again only when a minute has passed", async () => {
    let clock = 1_000;
    const { editor, loadTargets } = await open({ now: () => clock });
    focusAtEnd(editor);
    typeText(editor, "[[a");
    await flush();
    typeText(editor, "i");
    press(editor, "Escape");
    typeText(editor, " [[k");
    await flush();
    expect(loadTargets).toHaveBeenCalledTimes(1);
    clock += TARGETS_REFRESH_MS - 1;
    typeText(editor, "u");
    await flush();
    expect(loadTargets).toHaveBeenCalledTimes(1);
    clock += 1;
    typeText(editor, "b");
    await flush();
    expect(loadTargets).toHaveBeenCalledTimes(2);
  });

  it("keeps offering the list it has when a refresh fails", async () => {
    let clock = 1_000;
    let fail = false;
    const { editor, loadTargets } = await open({
      now: () => clock,
      loadTargets: async () => {
        if (fail) throw new Error("offline");
        return { targets: CATALOG, truncated: false };
      },
    });
    focusAtEnd(editor);
    typeText(editor, "[[k");
    await flush();
    fail = true;
    clock += TARGETS_REFRESH_MS;
    typeText(editor, "u");
    await flush();
    expect(loadTargets).toHaveBeenCalledTimes(2);
    expect(titles()).toEqual(["Kube-proxy", "Kubernetes"]);
  });

  it("does not ask twice while it is being fetched", async () => {
    let arrive!: (result: LinkTargetsResult) => void;
    const { editor, loadTargets } = await open({ loadTargets: () => new Promise<LinkTargetsResult>((resolve) => { arrive = resolve; }) });
    focusAtEnd(editor);
    typeText(editor, "[[abc");
    expect(loadTargets).toHaveBeenCalledTimes(1);
    arrive({ targets: CATALOG, truncated: false });
    await flush();
  });
});

describe("leaving nothing behind", () => {
  it("removes every listener it added, on the editor and on the window", async () => {
    const onWindow = { add: vi.spyOn(window, "addEventListener"), remove: vi.spyOn(window, "removeEventListener") };
    const onNodes = { add: vi.spyOn(EventTarget.prototype, "addEventListener"), remove: vi.spyOn(EventTarget.prototype, "removeEventListener") };
    const kinds = ["blur", "focus", "scroll", "resize"];
    // Which listeners are still attached: added, and not removed by the same target, type and function.
    const attached = (spies: { add: typeof onWindow.add; remove: typeof onWindow.remove }) => {
      const live = new Map<string, number>();
      const id = (call: unknown[], context: unknown) => `${(context as { tagName?: string })?.tagName ?? "window"}|${String(call[0])}|${String(call[1])}|${JSON.stringify(call[2] ?? false)}`;
      spies.add.mock.calls.forEach((call, index) => {
        if (kinds.includes(String(call[0]))) live.set(id(call, spies.add.mock.contexts[index]), (live.get(id(call, spies.add.mock.contexts[index])) ?? 0) + 1);
      });
      spies.remove.mock.calls.forEach((call, index) => {
        if (kinds.includes(String(call[0]))) live.set(id(call, spies.remove.mock.contexts[index]), (live.get(id(call, spies.remove.mock.contexts[index])) ?? 0) - 1);
      });
      return live;
    };
    try {
      const { editor } = await open();
      opened.splice(opened.indexOf(editor), 1);
      await editor.destroy();
      const window = attached(onWindow);
      // It did add some to the window (or this would prove nothing), and took every one of them off.
      expect([...window.keys()].some((name) => name.includes("|scroll|"))).toBe(true);
      expect([...window].filter(([, count]) => count !== 0)).toEqual([]);
      const nodes = attached(onNodes);
      expect([...nodes.keys()].some((name) => name.startsWith("DIV|blur|"))).toBe(true);
      expect([...nodes].filter(([name, count]) => name.startsWith("DIV|") && count !== 0)).toEqual([]);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("removes the list, the listeners and the attributes when the editor is destroyed", async () => {
    const { editor } = await open();
    focusAtEnd(editor);
    typeText(editor, "[[");
    await flush();
    const dom = domOf(editor);
    opened.splice(opened.indexOf(editor), 1);
    await editor.destroy();
    expect(popup()).toBeNull();
    dom.dispatchEvent(new FocusEvent("blur", { relatedTarget: null }));
    window.dispatchEvent(new Event("resize"));
  });

  it("does not let a list that arrives after the editor is gone touch anything", async () => {
    let arrive!: (result: LinkTargetsResult) => void;
    const { editor } = await open({ loadTargets: () => new Promise<LinkTargetsResult>((resolve) => { arrive = resolve; }) });
    focusAtEnd(editor);
    typeText(editor, "[[");
    opened.splice(opened.indexOf(editor), 1);
    await editor.destroy();
    arrive({ targets: CATALOG, truncated: false });
    await flush();
    expect(popup()).toBeNull();
  });

  it("keeps two editors' lists apart", async () => {
    const first = await open();
    const second = await open({ targets: [target("Only in the second", "2026-09-01T00:00:00.000Z")] });
    focusAtEnd(second.editor);
    typeText(second.editor, "[[");
    await flush();
    expect(titles()).toEqual(["Only in the second"]);
    expect(document.querySelectorAll(".kh-wikilink-suggest")).toHaveLength(2);
    expect(domOf(first.editor).hasAttribute("aria-expanded")).toBe(false);
  });
});
