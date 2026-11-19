// @vitest-environment jsdom
import { editorViewCtx } from "@milkdown/kit/core";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { afterEach, describe, expect, it } from "vitest";
import { blockGutter } from "@/components/knowledge/editor/block-gutter";
import { createMarkdownEditor, type MarkdownEditor } from "@/components/knowledge/editor/editor-core";
import { selectionToolbar } from "@/components/knowledge/editor/selection-toolbar";
import { slashCommands } from "@/components/knowledge/editor/slash-commands";
import { extractDocumentLinks } from "@/modules/knowledge/domain/document-links";

// 2026-11-21 list commands spec, decision 7: every entry point turns the same item the same way. The same item of the
// same list is turned through the grip menu, the selection toolbar's Turn into, the `/` list and the turn key, each on a
// fresh editor holding the page's own plugins, and the saved Markdown is compared. The `/` path has to empty the item
// first (a `/query` alone in it), so it is compared by the top-level node types and list kinds instead.
// Excluded, by the spec's Deviations: an item with a nested list, where `/` puts the block below the item.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const rect = (top: number, bottom: number) => ({ x: 20, y: top, left: 20, right: 600, top, bottom, width: 580, height: bottom - top, toJSON: () => ({}) }) as DOMRect;
document.elementFromPoint = () => null;
window.scrollBy = () => {};
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => rect(0, 0);

const opened: MarkdownEditor[] = [];
afterEach(async () => { for (const editor of opened.splice(0)) await editor.destroy(); document.body.innerHTML = ""; });

/** A fresh editor, alone on the page: the previous one's toolbar and menus are gone, so a query finds this one's. */
async function open(markdown: string) {
  for (const editor of opened.splice(0)) await editor.destroy();
  document.body.innerHTML = "";
  const root = document.body.appendChild(document.createElement("div"));
  root.setAttribute("data-tab-stays", "");
  const toolbar = selectionToolbar();
  const slash = slashCommands();
  const editor = await createMarkdownEditor({
    root, markdown, className: "kh-editor", ariaLabel: "Content", editable: true, onUserEdit: () => {}, onMarkdown: () => {}, allowImage: () => false,
    extraPlugins: [...toolbar.plugins, ...slash.plugins, blockGutter()],
    configure: (ctx) => { toolbar.configure(ctx); slash.configure(ctx); },
  });
  opened.push(editor);
  const view = editor.action((ctx) => ctx.get(editorViewCtx));
  view.dom.getBoundingClientRect = () => rect(40, 300);
  view.focus();
  return { editor, view };
}

/** The position of `text`'s first character, and its end. */
function find(view: EditorView, text: string) {
  let at = -1;
  view.state.doc.descendants((node, pos) => {
    if (at >= 0 || !node.isText) return at < 0;
    const index = node.text!.indexOf(text);
    if (index >= 0) at = pos + index;
    return false;
  });
  expect(at, `"${text}" is in the document`).toBeGreaterThanOrEqual(0);
  return { from: at, to: at + text.length };
}
const caretIn = (view: EditorView, text: string) => view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, find(view, text).to)));
const press = (view: EditorView, key: string, init: KeyboardEventInit & { keyCode?: number } = {}) => {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  // A modified digit is matched by its key code (jsdom leaves it 0).
  if (init.keyCode) Object.defineProperty(event, "keyCode", { value: init.keyCode });
  view.dom.dispatchEvent(event);
  return event;
};
const items = (role: string) => [...document.querySelectorAll<HTMLButtonElement>(`[role="${role}"]`)];
const pick = (role: string, label: string) => {
  const found = items(role).find((item) => item.textContent === label);
  expect(found, `${label} is offered`).toBeDefined();
  expect(found!.disabled, `${label} is enabled`).toBe(false);
  return found!;
};

type Kind = { id: string; label: string; alias: string; keys: { key: string; init: KeyboardEventInit & { keyCode: number } }[] };
// Mod is Ctrl here (jsdom is not a Mac). Quote has no turn key; Mod-Alt-0…3 turn an item from its first line.
const KINDS: Kind[] = [
  { id: "paragraph", label: "Text", alias: "p", keys: [{ key: "0", init: { ctrlKey: true, altKey: true, keyCode: 48 } }] },
  { id: "h1", label: "Heading 1", alias: "h1", keys: [{ key: "1", init: { ctrlKey: true, altKey: true, keyCode: 49 } }] },
  { id: "h3", label: "Heading 3", alias: "h3", keys: [{ key: "3", init: { ctrlKey: true, altKey: true, keyCode: 51 } }] },
  { id: "quote", label: "Quote", alias: "quote", keys: [] },
  { id: "h2", label: "Heading 2", alias: "h2", keys: [{ key: "2", init: { ctrlKey: true, altKey: true, keyCode: 50 } }] },
  { id: "task", label: "To-do list", alias: "todo", keys: [{ key: "4", init: { ctrlKey: true, altKey: true, keyCode: 52 } }, { key: "(", init: { ctrlKey: true, shiftKey: true, keyCode: 57 } }] },
  { id: "ordered", label: "Numbered list", alias: "number", keys: [{ key: "6", init: { ctrlKey: true, altKey: true, keyCode: 54 } }, { key: "&", init: { ctrlKey: true, shiftKey: true, keyCode: 55 } }] },
  { id: "code", label: "Code", alias: "code", keys: [{ key: "8", init: { ctrlKey: true, altKey: true, keyCode: 56 } }] },
];

/** Grip → Turn into → the kind, with the caret in the item. */
async function byGrip(markdown: string, text: string, kind: Kind) {
  const { editor, view } = await open(markdown);
  caretIn(view, text);
  press(view, "F10", { altKey: true });
  document.querySelector<HTMLButtonElement>('.kh-block-gutter button[aria-label="Move block"]')!.click();
  pick("menuitem", "Turn into").click();
  pick("menuitem", kind.label).click();
  return editor.getMarkdown();
}
/** Select the item's text, open the toolbar's Turn into, choose the kind. */
async function byToolbar(markdown: string, text: string, kind: Kind) {
  const { editor, view } = await open(markdown);
  // The toolbar joins the document on the first ProseMirror update.
  view.dispatch(view.state.tr);
  const { from, to } = find(view, text);
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)));
  document.querySelector<HTMLButtonElement>('.kh-selection-toolbar button[aria-haspopup="menu"]')!.click();
  pick("menuitemradio", kind.label).click();
  return editor.getMarkdown();
}
/** The turn key with the caret in the item. */
async function byKey(markdown: string, text: string, key: Kind["keys"][number]) {
  const { editor, view } = await open(markdown);
  caretIn(view, text);
  expect(press(view, key.key, key.init).defaultPrevented).toBe(true);
  return editor.getMarkdown();
}
/** Empty the item, type `/` and the kind's alias, press Enter. */
async function bySlash(markdown: string, text: string, kind: Kind) {
  const { editor, view } = await open(markdown);
  const { from } = find(view, text);
  const $from = view.state.doc.resolve(from);
  const tr = view.state.tr.delete($from.start(), $from.end());
  tr.setSelection(TextSelection.create(tr.doc, $from.start()));
  view.dispatch(tr);
  view.dispatch(view.state.tr.insertText(`/${kind.alias}`));
  const list = [...document.querySelectorAll<HTMLElement>(".kh-slash-menu")].at(-1)!;
  expect(list.hidden, "the / list is open in the item").toBe(false);
  press(view, "Enter");
  expect(list.hidden).toBe(true);
  return editor.getMarkdown();
}

/** Top-level node types, a list named by its kind (a to-do list is a bullet_list whose items are checked or not). */
async function shape(markdown: string) {
  const { view } = await open(markdown);
  const kinds: string[] = [];
  view.state.doc.forEach((node: ProseNode) => {
    if (node.type.name === "heading") kinds.push(`heading${node.attrs.level}`);
    else if (node.type.name === "bullet_list" && node.firstChild?.attrs.checked != null) kinds.push("task_list");
    else kinds.push(node.type.name);
  });
  return kinds;
}
const links = (markdown: string) => extractDocumentLinks(markdown).map(({ kind, target }) => `${kind}:${target}`).sort();

const CASES = [
  { name: "a plain bulleted item", markdown: "- a\n- b\n- c\n", text: "b" },
  { name: "an item holding a [[link]]", markdown: "- a\n- see [[Target]] here\n- c\n", text: "see" },
];
// What each kind gives on either case, as top-level node types.
const SHAPES: Record<string, string[]> = {
  paragraph: ["bullet_list", "paragraph", "bullet_list"],
  h1: ["bullet_list", "heading1", "bullet_list"],
  h3: ["bullet_list", "heading3", "bullet_list"],
  quote: ["bullet_list", "blockquote", "bullet_list"],
  h2: ["bullet_list", "heading2", "bullet_list"],
  task: ["bullet_list", "task_list", "bullet_list"],
  ordered: ["bullet_list", "ordered_list", "bullet_list"],
  code: ["bullet_list", "code_block", "bullet_list"],
};

describe.each(CASES)("turning the middle item of $name", ({ markdown, text }) => {
  it.each(KINDS)("into $label gives the same result from the grip, the toolbar, the keys and the / list", async (kind) => {
    const grip = await byGrip(markdown, text, kind);
    expect(await shape(grip)).toEqual(SHAPES[kind.id]);
    expect(await byToolbar(markdown, text, kind), "toolbar = grip").toBe(grip);
    for (const key of kind.keys) expect(await byKey(markdown, text, key), `${JSON.stringify(key)} = grip`).toBe(grip);
    expect(await shape(await bySlash(markdown, text, kind)), "/ list: same node types").toEqual(SHAPES[kind.id]);

    if (markdown.includes("[[Target]]")) {
      // The wikilink invariant: the turned item still writes its link as it read it, so its edge survives the save.
      expect(grip).toContain("[[Target]]");
      // A code block's text is code, so it carries no edge; every other kind keeps it.
      expect(links(grip)).toEqual(kind.id === "code" ? [] : links(markdown));
    }
  });
});

it.each([
  ["- [ ] alpha\n- beta\n- gamma", "task", "To-do list", "4"],
  ["- alpha\n- [x] beta\n- gamma", "bullet", "Bulleted list", "5"],
])("splits the middle item even beside its new kind in %s", async (source, id, label, digit) => {
  const key = { key: digit, init: { ctrlKey: true, altKey: true, keyCode: digit.charCodeAt(0) } };
  const kind = { id, label, alias: id === "task" ? "todo" : "bullet", keys: [key] };
  const grip = await byGrip(source, "beta", kind);
  const expectedShape = await shape(grip);
  expect(expectedShape).toHaveLength(3);
  expect(await byToolbar(source, "beta", kind)).toBe(grip);
  expect(await byKey(source, "beta", key)).toBe(grip);
  expect(await shape(await bySlash(source, "beta", kind))).toEqual(expectedShape);
});
