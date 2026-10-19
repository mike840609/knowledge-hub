// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { Schema, type Node as ProseNode } from "@milkdown/kit/prose/model";
import { EditorState, TextSelection } from "@milkdown/kit/prose/state";
import { EditorView } from "@milkdown/kit/prose/view";
import { joinBackward, joinForward } from "@milkdown/kit/prose/commands";
import { handleDetailsBackspace, handleDetailsForwardDelete } from "@/components/knowledge/editor/details-toggle";

// Mirrors the node specs in details-node.ts (group/content/defining/attrs): the deletion
// barrier behavior under test comes from the real ProseMirror libraries, not this replica.
const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*", toDOM: () => ["p", 0], parseDOM: [{ tag: "p" }] },
    text: { group: "inline" },
    details: {
      group: "block", content: "details_summary details_body", defining: true, attrs: { open: { default: false } },
      toDOM: () => ["details", 0], parseDOM: [{ tag: "details" }],
    },
    details_summary: {
      content: "text*", marks: "", defining: true,
      toDOM: () => ["summary", 0], parseDOM: [{ tag: "summary" }],
    },
    details_body: {
      content: "block+", defining: true,
      toDOM: () => ["div", 0], parseDOM: [{ tag: "div" }],
    },
  },
});

function toggleDoc(summaryText: string, bodyTexts: string[]) {
  const summary = summaryText
    ? schema.nodes.details_summary.create(null, schema.text(summaryText))
    : schema.nodes.details_summary.create();
  const body = schema.nodes.details_body.create(
    null,
    bodyTexts.map(text => schema.nodes.paragraph.create(null, text ? schema.text(text) : undefined)),
  );
  const details = schema.nodes.details.create({ open: true }, [summary, body]);
  return schema.nodes.doc.create(null, [
    schema.nodes.paragraph.create(null, schema.text("Before")),
    details,
    schema.nodes.paragraph.create(null, schema.text("After")),
  ]);
}

function findDetails(doc: ProseNode): { pos: number; node: ProseNode } {
  let found: { pos: number; node: ProseNode } | null = null;
  doc.descendants((node, pos) => {
    if (!found && node.type.name === "details") found = { pos, node };
    return !found;
  });
  if (!found) throw new Error("toggle missing from test document");
  return found;
}

function viewAt(doc: ProseNode, pos: number) {
  const state = EditorState.create({ schema, doc, selection: TextSelection.create(doc, pos) });
  return new EditorView(document.createElement("div"), { state });
}

function summaryStart(doc: ProseNode) {
  const { pos } = findDetails(doc);
  return pos + 2;
}

function summaryEnd(doc: ProseNode) {
  const { pos, node } = findDetails(doc);
  return pos + 1 + node.firstChild!.nodeSize - 1;
}

function firstBodyParaStart(doc: ProseNode) {
  const { pos, node } = findDetails(doc);
  return pos + 1 + node.firstChild!.nodeSize + 2;
}

function lastBodyParaEnd(doc: ProseNode) {
  const { pos, node } = findDetails(doc);
  const body = node.lastChild!;
  let end = pos + 1 + node.firstChild!.nodeSize + 1;
  body.forEach(child => { end += child.nodeSize; });
  return end - 1;
}

function hasDetails(doc: ProseNode) {
  let found = false;
  doc.descendants(node => { if (node.type.name === "details") found = true; });
  return found;
}

let views: EditorView[] = [];
afterEach(() => { views.forEach(view => view.destroy()); views = []; vi.unstubAllGlobals(); });
function mount(doc: ProseNode, pos: number) {
  const view = viewAt(doc, pos);
  views.push(view);
  return view;
}

// The trap itself, with the real ProseMirror commands: nothing may change.
test("Backspace at the start of an empty summary is swallowed today", () => {
  const doc = toggleDoc("", [""]);
  const view = mount(doc, summaryStart(doc));
  let changed: unknown = null;
  const applied = joinBackward(view.state, tr => { changed = tr.doc; });
  expect(applied).toBe(false);
  expect(changed).toBeNull();
  expect(view.state.doc.eq(doc)).toBe(true);
});

test("Backspace at the start of a sole empty body paragraph is swallowed today", () => {
  const doc = toggleDoc("Title", [""]);
  const view = mount(doc, firstBodyParaStart(doc));
  let changed: unknown = null;
  const applied = joinBackward(view.state, tr => { changed = tr.doc; });
  expect(applied).toBe(false);
  expect(changed).toBeNull();
  expect(view.state.doc.eq(doc)).toBe(true);
});

test("forward Delete at the end of a summary is swallowed today", () => {
  const summaryDoc = toggleDoc("Title", ["Body"]);
  const summaryView = mount(summaryDoc, summaryEnd(summaryDoc));
  expect(joinForward(summaryView.state, () => {})).toBe(false);
  expect(summaryView.state.doc.eq(summaryDoc)).toBe(true);
});

test("forward Delete at the end of a body already pulls the next line in", () => {
  const bodyDoc = toggleDoc("Title", ["Body"]);
  const bodyView = mount(bodyDoc, lastBodyParaEnd(bodyDoc));
  let next: typeof bodyDoc | null = null;
  expect(joinForward(bodyView.state, tr => { next = tr.doc; })).toBe(true);
  expect(next!.textContent).toBe("BeforeTitleBodyAfter");
  expect(handleDetailsForwardDelete(bodyView)).toBe(false);
});

// The fix: Backspace dissolves the toggle and keeps every word.
test("Backspace at the start of an empty summary removes the toggle", () => {
  const doc = toggleDoc("", [""]);
  const view = mount(doc, summaryStart(doc));
  expect(handleDetailsBackspace(view)).toBe(true);
  expect(hasDetails(view.state.doc)).toBe(false);
  expect(view.state.doc.textContent).toBe("BeforeAfter");
});

test("Backspace at the start of a sole empty body paragraph keeps the summary as text", () => {
  const doc = toggleDoc("Title", [""]);
  const view = mount(doc, firstBodyParaStart(doc));
  expect(handleDetailsBackspace(view)).toBe(true);
  expect(hasDetails(view.state.doc)).toBe(false);
  expect(view.state.doc.textContent).toBe("BeforeTitleAfter");
});

test("Backspace at the start of a non-empty first body paragraph keeps every word", () => {
  const doc = toggleDoc("Title", ["abc", "def"]);
  const view = mount(doc, firstBodyParaStart(doc));
  expect(handleDetailsBackspace(view)).toBe(true);
  expect(hasDetails(view.state.doc)).toBe(false);
  expect(view.state.doc.textContent).toBe("BeforeTitleabcdefAfter");
});

test("Backspace in an ordinary paragraph is left alone", () => {
  const doc = toggleDoc("Title", ["Body"]);
  const view = mount(doc, 2);
  expect(handleDetailsBackspace(view)).toBe(false);
  expect(view.state.doc.eq(doc)).toBe(true);
});

test("forward Delete at the end of a summary dissolves the toggle", () => {
  const summaryDoc = toggleDoc("Title", ["Body"]);
  const summaryView = mount(summaryDoc, summaryEnd(summaryDoc));
  expect(handleDetailsForwardDelete(summaryView)).toBe(true);
  expect(hasDetails(summaryView.state.doc)).toBe(false);
  expect(summaryView.state.doc.textContent).toBe("BeforeTitleBodyAfter");
});
