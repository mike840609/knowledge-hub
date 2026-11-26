// @vitest-environment jsdom
import { editorViewCtx } from "@milkdown/kit/core";
import { NodeSelection, TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { afterEach, expect, it } from "vitest";
import { marqueeRange } from "@/components/knowledge/editor/block-pointer";
import { extendRangeTo } from "@/components/knowledge/editor/block-range";
import { createMarkdownEditor, type MarkdownEditor } from "@/components/knowledge/editor/editor-core";
import { extractDocumentLinks } from "@/modules/knowledge/domain/document-links";

// docs/superpowers/specs/2026-11-26-mouse-block-range-design.md, through the rendered editor.
const flat = { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 } as DOMRect;
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => flat;
// ProseMirror's own press handler asks the page what is under the pointer; jsdom has no layout to answer.
document.elementFromPoint = () => null;
const opened: MarkdownEditor[] = [];
afterEach(async () => { for (const editor of opened.splice(0)) await editor.destroy(); document.body.innerHTML = ""; });

async function open(markdown: string) {
  const root = document.body.appendChild(document.createElement("div"));
  const editor = await createMarkdownEditor({ root, markdown, className: "kh-editor", ariaLabel: "Content", editable: true, onUserEdit: () => {}, onMarkdown: () => {}, allowImage: () => false });
  opened.push(editor);
  const view = editor.action(ctx => ctx.get(editorViewCtx));
  view.focus();
  return { editor, view };
}
const CODES: Record<string, number> = { Backspace: 8, Escape: 27, Delete: 46 };
function press(view: EditorView, key: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  Object.defineProperty(event, "keyCode", { value: CODES[key] ?? key.toUpperCase().charCodeAt(0) });
  view.dom.dispatchEvent(event);
  return event;
}
const inRange = (view: EditorView) => [...view.dom.querySelectorAll(".kh-block-in-range")].map(node => node.textContent);
const live = (view: EditorView) => view.dom.parentElement!.querySelector('[aria-live="polite"]')?.textContent;
const posOf = (view: EditorView, text: string) => {
  let at = -1;
  view.state.doc.descendants((node, pos) => {
    if (at < 0 && (node.type.name === "list_item" || node.type.name === "paragraph" || node.type.name === "heading") && node.textContent === text) at = pos;
    return at < 0;
  });
  expect(at).toBeGreaterThanOrEqual(0);
  return at;
};
function escapeOn(view: EditorView, text: string) {
  const at = posOf(view, text);
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at + (view.state.doc.nodeAt(at)!.type.name === "list_item" ? 2 : 1))));
  expect(press(view, "Escape").defaultPrevented).toBe(true);
  expect(view.state.selection).toBeInstanceOf(NodeSelection);
}
/** A press of the left button on `target`, as the browser sends it. */
function mouse(target: Element | Document, type: string, init: MouseEventInit = {}) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: type === "mousemove" ? 1 : 0, ...init });
  target.dispatchEvent(event);
  return event;
}
const shiftClick = (view: EditorView, text: string) => mouse(view.nodeDOM(posOf(view, text)) as Element, "mousedown", { shiftKey: true });

it("Shift-click on another block extends a block chosen with Escape, and Delete acts on all of them", async () => {
  const { editor, view } = await open("one\n\ntwo\n\nthree\n\nfour\n");
  escapeOn(view, "one");
  const down = shiftClick(view, "three");
  // The browser's own shift-extension of the text selection is suppressed.
  expect(down.defaultPrevented).toBe(true);
  expect(inRange(view)).toEqual(["one", "two", "three"]);
  expect(live(view)).toBe("3 blocks selected");
  // Clicking another head narrows or widens; the anchor stays the block Escape chose.
  shiftClick(view, "two");
  expect(inRange(view)).toEqual(["one", "two"]);
  shiftClick(view, "four");
  expect(inRange(view)).toEqual(["one", "two", "three", "four"]);
  shiftClick(view, "one");
  expect(inRange(view)).toEqual([]);
  shiftClick(view, "three");
  press(view, "Delete");
  expect(editor.getMarkdown()).toBe("four\n");
});

it("Shift-click above the anchor keeps the anchor, and crosses into a list item by item", async () => {
  const { view } = await open("one\n\ntwo\n\n- a\n- b\n- c\n");
  escapeOn(view, "two");
  shiftClick(view, "b");
  expect(inRange(view)).toEqual(["two", "a", "b"]);
  shiftClick(view, "one");
  expect(inRange(view)).toEqual(["one", "two"]);
});

it("Shift-click on a block of another sequence chooses that block alone", async () => {
  const { view } = await open("one\n\n- a\n  - x\n  - y\n- b\n");
  escapeOn(view, "x");
  // `one` is a block of the top-level sequence; `x` belongs to its own nested list.
  shiftClick(view, "one");
  expect(inRange(view)).toEqual([]);
  expect(view.state.selection).toBeInstanceOf(NodeSelection);
  expect((view.state.selection as NodeSelection).from).toBe(posOf(view, "one"));
});

it("Shift-click with only a caret is left to the text selection", async () => {
  const { view } = await open("one\n\ntwo\n");
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, posOf(view, "one") + 1)));
  expect(shiftClick(view, "two").defaultPrevented).toBe(false);
  expect(inRange(view)).toEqual([]);
});

it("a grip's Shift-click, with the caret in a block, runs a range from the caret's block", async () => {
  const { view } = await open("one\n\ntwo\n\nthree\n");
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, posOf(view, "one") + 1)));
  expect(extendRangeTo(view, posOf(view, "three"), true)).toBe(true);
  expect(inRange(view)).toEqual(["one", "two", "three"]);
  // Without a caret fallback nothing is chosen to extend from.
  const second = await open("one\n\ntwo\n");
  expect(extendRangeTo(second.view, posOf(second.view, "two"), false)).toBe(false);
});

it("marqueeRange: the blocks a vertical span meets, anchored where the drag began", () => {
  const boxes = [0, 1, 2, 3].map(index => ({ pos: index * 10, top: index * 30, bottom: index * 30 + 20 }));
  expect(marqueeRange(boxes, 10, 70)).toEqual({ anchor: 0, head: 20 });
  expect(marqueeRange(boxes, 70, 10)).toEqual({ anchor: 20, head: 0 });
  // One block touched: anchor and head are the same block.
  expect(marqueeRange(boxes, 35, 40)).toEqual({ anchor: 10, head: 10 });
  // The gap between blocks, and outside them: none.
  expect(marqueeRange(boxes, 22, 28)).toBeNull();
  expect(marqueeRange(boxes, 200, 300)).toBeNull();
  // From below the last block upward.
  expect(marqueeRange(boxes, 500, 65)).toEqual({ anchor: 30, head: 20 });
});

/** jsdom has no layout: each top-level paragraph is 20px tall, 30px apart. */
function layout(view: EditorView) {
  const original = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    const index = this.parentElement === view.dom ? [...view.dom.children].indexOf(this) : -1;
    if (index < 0) return flat;
    return { ...flat, top: index * 30, bottom: index * 30 + 20, left: 56, right: 600, width: 544, height: 20 } as DOMRect;
  };
  return () => { HTMLElement.prototype.getBoundingClientRect = original; };
}

it("a press on the editor's margin and a drag over three paragraphs chooses them, and release keeps them", async () => {
  const { editor, view } = await open("one\n\ntwo\n\nthree\n\nfour\n");
  const restore = layout(view);
  try {
    const down = mouse(view.dom, "mousedown", { clientX: 10, clientY: 5 });
    expect(down.defaultPrevented).toBe(true);
    mouse(document, "mousemove", { clientX: 12, clientY: 75 });
    expect(inRange(view)).toEqual(["one", "two", "three"]);
    expect(live(view)).toBe("3 blocks selected");
    expect(document.querySelector(".kh-block-marquee")).not.toBeNull();
    mouse(document, "mouseup", { clientX: 12, clientY: 75 });
    expect(document.querySelector(".kh-block-marquee")).toBeNull();
    expect(inRange(view)).toEqual(["one", "two", "three"]);
    // The keys now act on the range, as for one made with the keyboard.
    press(view, "Delete");
    expect(editor.getMarkdown()).toBe("four\n");
  } finally { restore(); }
});

it("dragging up from below chooses from the last block touched, and one block is chosen alone", async () => {
  const { view } = await open("one\n\ntwo\n\nthree\n");
  const restore = layout(view);
  try {
    mouse(view.dom, "mousedown", { clientX: 10, clientY: 95 });
    mouse(document, "mousemove", { clientX: 10, clientY: 35 });
    expect(inRange(view)).toEqual(["two", "three"]);
    // Head back to the anchor's own block: that block alone.
    mouse(document, "mousemove", { clientX: 10, clientY: 62 });
    expect(inRange(view)).toEqual([]);
    expect(view.state.selection).toBeInstanceOf(NodeSelection);
    mouse(document, "mouseup", { clientX: 10, clientY: 62 });
  } finally { restore(); }
});

it("Escape during the drag cancels it and gives back the selection, without choosing a block", async () => {
  const { view } = await open("one\n\ntwo\n\nthree\n");
  const restore = layout(view);
  try {
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, posOf(view, "three") + 1)));
    const before = view.state.selection.from;
    mouse(view.dom, "mousedown", { clientX: 10, clientY: 5 });
    mouse(document, "mousemove", { clientX: 10, clientY: 55 });
    expect(inRange(view)).toEqual(["one", "two"]);
    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    document.body.dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(true);
    expect(inRange(view)).toEqual([]);
    expect(view.state.selection).toBeInstanceOf(TextSelection);
    expect(view.state.selection.from).toBe(before);
    expect(document.querySelector(".kh-block-marquee")).toBeNull();
    // The listeners are gone: moving and releasing change nothing.
    mouse(document, "mousemove", { clientX: 10, clientY: 85 });
    expect(inRange(view)).toEqual([]);
  } finally { restore(); }
});

it("a touch press starts no marquee, and a press on text is not one", async () => {
  const { view } = await open("one\n\ntwo\n");
  const restore = layout(view);
  try {
    view.dom.dispatchEvent(Object.assign(new MouseEvent("pointerdown", { bubbles: true }), { pointerType: "touch" }));
    expect(mouse(view.dom, "mousedown", { clientX: 10, clientY: 5 }).defaultPrevented).toBe(false);
    mouse(document, "mousemove", { clientX: 10, clientY: 55 });
    expect(inRange(view)).toEqual([]);
    expect(document.querySelector(".kh-block-marquee")).toBeNull();
    // A press whose target is a block (text) is the editor's own.
    expect(mouse(view.dom.firstElementChild!, "mousedown", { clientX: 100, clientY: 5 }).defaultPrevented).toBe(false);
  } finally { restore(); }
});

it("a range chosen with the mouse keeps its wikilinks as links through Mod-d", async () => {
  const links = (markdown: string) => extractDocumentLinks(markdown).map(({ kind, target }) => `${kind}:${target}`).sort();
  const { editor, view } = await open("see [[Target]] here\n\nplain\n\nlast\n");
  escapeOn(view, "see  here");
  shiftClick(view, "plain");
  expect(inRange(view)).toHaveLength(2);
  press(view, "d", { ctrlKey: true });
  expect(links(editor.getMarkdown())).toEqual(["WIKI:Target", "WIKI:Target"]);
  let nodes = 0;
  view.state.doc.descendants(node => { if (node.type.name === "wiki_link") nodes++; });
  expect(nodes).toBe(2);
});

it("a release outside the window (no mouseup) ends the drag at the next move", async () => {
  const { view } = await open("one\n\ntwo\n\nthree\n");
  const restore = layout(view);
  try {
    mouse(view.dom, "mousedown", { clientX: 10, clientY: 5 });
    mouse(document, "mousemove", { clientX: 10, clientY: 55 });
    expect(inRange(view)).toEqual(["one", "two"]);
    mouse(document, "mousemove", { clientX: 10, clientY: 85, buttons: 0 });
    expect(document.querySelector(".kh-block-marquee")).toBeNull();
    mouse(document, "mousemove", { clientX: 10, clientY: 85 });
    expect(inRange(view)).not.toContain("three");
  } finally { restore(); }
});
