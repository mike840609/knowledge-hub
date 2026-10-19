// @vitest-environment jsdom
import { afterEach, expect, test } from "vitest";
import { Schema, type Node as ProseNode } from "@milkdown/kit/prose/model";
import { EditorState, TextSelection } from "@milkdown/kit/prose/state";
import { EditorView } from "@milkdown/kit/prose/view";
import { joinBackward } from "@milkdown/kit/prose/commands";
import { handleCalloutBackspace } from "@/components/knowledge/editor/reader-hints";

// A plain blockquote like the editor's: no defining boundary, so the trap below comes only
// from the invisible marker paragraph, not from the schema.
const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*", toDOM: () => ["p", 0], parseDOM: [{ tag: "p" }] },
    text: { group: "inline" },
    hardbreak: { inline: true, group: "inline", selectable: false, toDOM: () => ["br"], parseDOM: [{ tag: "br" }] },
    blockquote: { group: "block", content: "block+", toDOM: () => ["blockquote", 0], parseDOM: [{ tag: "blockquote" }] },
  },
});

function calloutDoc(markerText: string, bodyTexts: string[]) {
  const marker = schema.nodes.paragraph.create(null, markerText ? schema.text(markerText) : undefined);
  const quote = schema.nodes.blockquote.create(null, [
    marker,
    ...bodyTexts.map(text => schema.nodes.paragraph.create(null, text ? schema.text(text) : undefined)),
  ]);
  return schema.nodes.doc.create(null, [
    schema.nodes.paragraph.create(null, schema.text("Before")),
    quote,
    schema.nodes.paragraph.create(null, schema.text("After")),
  ]);
}

function findQuote(doc: ProseNode): { pos: number; node: ProseNode } {
  let found: { pos: number; node: ProseNode } | null = null;
  doc.descendants((node, pos) => {
    if (!found && node.type.name === "blockquote") found = { pos, node };
    return !found;
  });
  if (!found) throw new Error("quote missing from test document");
  return found;
}

/** Start of the paragraph right after the marker paragraph. */
function secondParaStart(doc: ProseNode) {
  const { pos, node } = findQuote(doc);
  return pos + 1 + node.firstChild!.nodeSize + 1;
}

let views: EditorView[] = [];
afterEach(() => { views.forEach(view => view.destroy()); views = []; });

function mount(doc: ProseNode, pos: number) {
  const state = EditorState.create({ schema, doc, selection: TextSelection.create(doc, pos) });
  const view = new EditorView(document.createElement("div"), { state });
  views.push(view);
  return view;
}

// The trap: native Backspace merges visible text into the invisible marker paragraph.
test("Backspace at the start of a callout body is swallowed into the hidden marker", () => {
  const doc = calloutDoc("[!NOTE]", ["Body"]);
  const view = mount(doc, secondParaStart(doc));
  let changed: ProseNode | null = null;
  expect(joinBackward(view.state, tr => { changed = tr.doc; })).toBe(true);
  expect(changed!.textContent).toBe("Before[!NOTE]BodyAfter");
});

// The fix: drop the marker paragraph instead, keeping every word visible.
test("Backspace at the start of a callout body removes the marker, not the words", () => {
  const doc = calloutDoc("[!NOTE]", ["Body"]);
  const view = mount(doc, secondParaStart(doc));
  expect(handleCalloutBackspace(view)).toBe(true);
  expect(view.state.doc.textContent).toBe("BeforeBodyAfter");
  const { node } = findQuote(view.state.doc);
  expect(node.childCount).toBe(1);
});

test("Backspace at the start of an empty callout body leaves a plain empty paragraph", () => {
  const doc = calloutDoc("[!NOTE]", [""]);
  const view = mount(doc, secondParaStart(doc));
  expect(handleCalloutBackspace(view)).toBe(true);
  expect(view.state.doc.textContent).toBe("BeforeAfter");
  const { node } = findQuote(view.state.doc);
  expect(node.childCount).toBe(1);
  expect(node.firstChild!.type.name).toBe("paragraph");
});

test("a quote without a marker is left to the default behavior", () => {
  const doc = calloutDoc("Just a quote", ["Body"]);
  const view = mount(doc, secondParaStart(doc));
  expect(handleCalloutBackspace(view)).toBe(false);
  expect(view.state.doc.eq(doc)).toBe(true);
});

test("Backspace inside body text and in ordinary paragraphs is left alone", () => {
  const doc = calloutDoc("[!NOTE]", ["Body"]);
  const mid = mount(doc, secondParaStart(doc) + 2);
  expect(handleCalloutBackspace(mid)).toBe(false);
  expect(mid.state.doc.eq(doc)).toBe(true);
  const plain = mount(doc, 3);
  expect(handleCalloutBackspace(plain)).toBe(false);
  expect(plain.state.doc.eq(doc)).toBe(true);
});

/** Callouts parsed from Markdown keep marker and body in one paragraph split by a break. */
function singleParaCalloutDoc() {
  const para = schema.nodes.paragraph.create(null, [
    schema.text("[!NOTE]"),
    schema.nodes.hardbreak.create(),
    schema.text("Body"),
  ]);
  const quote = schema.nodes.blockquote.create(null, [para]);
  return schema.nodes.doc.create(null, [
    schema.nodes.paragraph.create(null, schema.text("Before")),
    quote,
    schema.nodes.paragraph.create(null, schema.text("After")),
  ]);
}

function bodyStartAfterBreak(doc: ProseNode) {
  const { pos } = findQuote(doc);
  return pos + 1 + 1 + "[!NOTE]".length + 1;
}

test("Backspace at the start of the body after a break is unhandled today", () => {
  // No ProseMirror command claims it, so the browser default eats the break and the marker
  // text merges into visible garbage (verified in the editor: "[!NOTE]Callout body here.").
  const doc = singleParaCalloutDoc();
  const view = mount(doc, bodyStartAfterBreak(doc));
  expect(joinBackward(view.state, () => {})).toBe(false);
  expect(view.state.doc.eq(doc)).toBe(true);
});

test("Backspace after the break drops the marker and the break, keeping the body", () => {
  const doc = singleParaCalloutDoc();
  const view = mount(doc, bodyStartAfterBreak(doc));
  expect(handleCalloutBackspace(view)).toBe(true);
  expect(view.state.doc.textContent).toBe("BeforeBodyAfter");
  const { node } = findQuote(view.state.doc);
  expect(node.childCount).toBe(1);
  expect(node.firstChild!.textContent).toBe("Body");
});
