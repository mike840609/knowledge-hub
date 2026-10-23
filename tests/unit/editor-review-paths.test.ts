// @vitest-environment jsdom
import { expect, test } from "vitest";
import { stampEditorReviewPaths, createEditorReviewPathsPlugin, updateEditorReviewPaths } from "@/components/knowledge/editor/review-paths";
import { readReviewSelection, reviewBlockAnchor } from "@/components/knowledge/review-selection";

function editor(html: string) {
  const root = document.createElement("div");
  root.innerHTML = html;
  return root;
}

test("duplicate editor paragraphs keep their canonical paths and UTF-16 offsets", () => {
  const markdown = "A 😀 **bold** passage.\n\nA 😀 **bold** passage.";
  const root = editor("<p>A 😀 <strong>bold</strong> passage.</p><p>A 😀 <strong>bold</strong> passage.</p>");
  document.body.replaceChildren(root);
  expect(stampEditorReviewPaths(root, markdown)).toBe(true);
  expect([...root.querySelectorAll("p")].map(p => p.dataset.reviewPath)).toEqual(["0", "1"]);
  const paragraph = root.querySelectorAll("p")[1];
  const range = document.createRange();
  range.setStart(paragraph.firstChild!, 2);
  range.setEnd(paragraph.querySelector("strong")!.firstChild!, 4);
  const selection = window.getSelection()!;
  selection.removeAllRanges(); selection.addRange(range);
  expect(readReviewSelection(root, markdown, selection).anchor).toMatchObject({ blockPath: [1], exact: "😀 bold", startUtf16: 2, endUtf16: 9 });
});

test("nested list and table leaves receive original AST paths", () => {
  const root = editor("<ul><li><p>Parent</p><ul><li><p>Child</p></li></ul></li></ul><table><tbody><tr><th>Head</th></tr><tr><td>Cell</td></tr></tbody></table>");
  expect(stampEditorReviewPaths(root, "- Parent\n  - Child\n\n| Head |\n| --- |\n| Cell |")).toBe(true);
  expect([...root.querySelectorAll("p,th,td")].map(p => p.getAttribute("data-review-path"))).toEqual(["0.0.0", "0.0.1.0.0", "1.0.0", "1.1.0"]);
});

test("lossy editor projection cannot reassign duplicate paths, and clears stale stamps", () => {
  const root = editor("<p data-review-path='0'>Same</p><p data-review-path='1'>Same</p>");
  expect(stampEditorReviewPaths(root, "Same\n\nRemoved\n\nSame")).toBe(false);
  expect(root.querySelectorAll("[data-review-path]")).toHaveLength(0);
  expect(stampEditorReviewPaths(root, "Same\n\nDifferent")).toBe(false);
});


test("an HTML block leaves its neighbours stamped instead of clearing the document", () => {
  const markdown = "Before\n\n<div>raw</div>\n\nAfter\n";
  const root = editor("<p>Before</p><p>&lt;div&gt;raw&lt;/div&gt;</p><p>After</p>");
  document.body.replaceChildren(root);
  expect(stampEditorReviewPaths(root, markdown)).toBe(true);
  expect([...root.querySelectorAll("p")].map(p => p.getAttribute("data-review-path"))).toEqual(["0", null, "2"]);
  const range = document.createRange();
  range.setStart(root.querySelectorAll("p")[0].firstChild!, 0);
  range.setEnd(root.querySelectorAll("p")[0].firstChild!, 6);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  expect(readReviewSelection(root, markdown, selection).anchor).toMatchObject({ blockPath: [0], exact: "Before" });
});

test("a changed sentence disables only its own paragraph", () => {
  const root = editor("<p>Same</p><p>Changed</p>");
  document.body.replaceChildren(root);
  expect(stampEditorReviewPaths(root, "Same\n\nDifferent")).toBe(true);
  expect([...root.querySelectorAll("p")].map(p => p.getAttribute("data-review-path"))).toEqual(["0", null]);
});

test("unsupported HTML in its own paragraph does not disable unrelated passages", () => {
  const markdown = "Safe\n\nOther <kbd>Wiki</kbd> text.\n\nSafe";
  const root = editor("<p>Safe</p><p>Other <kbd>Wiki</kbd> text.</p><p>Safe</p>");
  expect(stampEditorReviewPaths(root, markdown)).toBe(true);
  // The stamp says which block an element is; it does not say the block may take a comment.
  expect([...root.querySelectorAll("p")].map(p => p.getAttribute("data-review-path"))).toEqual(["0", "1", "2"]);
  const paragraphs = root.querySelectorAll<HTMLElement>("p");
  expect(reviewBlockAnchor(paragraphs[1], markdown)).toBeNull();
  expect(reviewBlockAnchor(paragraphs[0], markdown)).toMatchObject({ blockPath: [0], exact: "Safe" });
});


test("code previews map the visible source and ignore editor raw code and diagram explanations", () => {
  const root = editor('<pre hidden><code>graph TD; A--&gt;B</code></pre><div data-inline-code-preview><p data-diagram-reason>Cannot render diagram</p><details><summary>Source</summary><pre><code>graph TD; A--&gt;B\n</code></pre></details></div><p>After</p>');
  expect(stampEditorReviewPaths(root, "```mermaid\ngraph TD; A-->B\n```\n\nAfter")).toBe(true);
  expect(root.querySelector("pre[hidden]")!.hasAttribute("data-review-path")).toBe(false);
  expect(root.querySelector("details pre")!.getAttribute("data-review-path")).toBe("0");
  expect(root.lastElementChild!.getAttribute("data-review-path")).toBe("1");
});


import { Schema } from "@milkdown/kit/prose/model";
import { EditorState } from "@milkdown/kit/prose/state";
import { EditorView } from "@milkdown/kit/prose/view";
import { focusReviewAnchor } from "@/components/knowledge/review-selection";

test("ProseMirror owns path decorations and explicitly focused review selections", () => {
  const schema = new Schema({ nodes: { doc: { content: "paragraph+" }, paragraph: { content: "text*", toDOM: () => ["p", 0], parseDOM: [{ tag: "p" }] }, text: {} } });
  const doc = schema.node("doc", null, [schema.node("paragraph", null, schema.text("A 😀 bold")), schema.node("paragraph", null, schema.text("A 😀 bold"))]);
  const host = document.createElement("div");
  document.body.replaceChildren(host);
  const view = new EditorView(host, { state: EditorState.create({ schema, doc, plugins: [createEditorReviewPathsPlugin()] }) });
  const markdown = "A 😀 bold\n\nA 😀 bold";
  expect(updateEditorReviewPaths(view, markdown)).toBe(true);
  expect([...view.dom.querySelectorAll("p")].map(p => p.dataset.reviewPath)).toEqual(["0", "1"]);
  view.dispatch(view.state.tr.setMeta("unrelated", true));
  expect(view.dom.querySelector("p")!.getAttribute("data-review-path")).toBe("0");
  view.dom.querySelectorAll("p").forEach(p => { p.scrollIntoView = () => {}; });
  focusReviewAnchor(view.dom, markdown, { schemaVersion: 1, blockPath: [1], blockKind: "paragraph", startUtf16: 2, endUtf16: 9, exact: "😀 bold", prefix: "A ", suffix: "" });
  expect(view.state.doc.textBetween(view.state.selection.from, view.state.selection.to)).toBe("😀 bold");
  expect(window.getSelection()!.toString()).toBe("😀 bold");
  view.dispatch(view.state.tr.insertText("changed", 1, 2));
  expect(view.dom.querySelectorAll("[data-review-path]")).toHaveLength(0);
  view.destroy();
});


test("review decorations preserve a native selection before ProseMirror selectionchange", () => {
  const schema = new Schema({ nodes: { doc: { content: "paragraph+" }, paragraph: { content: "text*", toDOM: () => ["p", 0], parseDOM: [{ tag: "p" }] }, text: {} } });
  const doc = schema.node("doc", null, schema.node("paragraph", null, schema.text("A 😀 bold passage")));
  const host = document.createElement("div");
  document.body.replaceChildren(host);
  const view = new EditorView(host, { state: EditorState.create({ schema, doc, plugins: [createEditorReviewPathsPlugin()] }) });
  view.focus();
  const text = view.dom.querySelector("p")!.firstChild!;
  const native = window.getSelection()!;
  native.setBaseAndExtent(text, 9, text, 2);
  expect(view.state.selection.empty).toBe(true);
  expect(updateEditorReviewPaths(view, "A 😀 bold passage")).toBe(true);
  expect(native.toString()).toBe("😀 bold");
  expect(view.state.doc.textBetween(view.state.selection.from, view.state.selection.to)).toBe("😀 bold");
  expect(view.state.selection.anchor).toBeGreaterThan(view.state.selection.head);
  expect(view.dom.querySelector("p")!.getAttribute("data-review-path")).toBe("0");
  view.destroy();
});

import { setReviewBlockSelected } from "@/components/knowledge/review-block-comment";

test("selected paragraph styling remains a decoration and cleanup retains every path", () => {
  const schema = new Schema({ nodes: { doc: { content: "paragraph+" }, paragraph: { content: "text*", toDOM: () => ["p", 0], parseDOM: [{ tag: "p" }] }, text: {} } });
  const doc = schema.node("doc", null, [schema.node("paragraph", null, schema.text("First")), schema.node("paragraph", null, schema.text("Second"))]);
  const host = document.createElement("div");
  document.body.replaceChildren(host);
  const view = new EditorView(host, { state: EditorState.create({ schema, doc, plugins: [createEditorReviewPathsPlugin()] }) });
  const markdown = "First\n\nSecond";
  updateEditorReviewPaths(view, markdown);
  const paragraph = view.dom.querySelectorAll("p")[1];
  setReviewBlockSelected(paragraph, true);
  view.dispatch(view.state.tr.setMeta("unrelated", true));
  expect(paragraph.classList.contains("kh-comment-block-selected")).toBe(true);
  updateEditorReviewPaths(view, markdown);
  expect(paragraph.classList.contains("kh-comment-block-selected")).toBe(true);
  setReviewBlockSelected(paragraph, false);
  expect(paragraph.classList.contains("kh-comment-block-selected")).toBe(false);
  expect([...view.dom.querySelectorAll("p")].map(p => p.dataset.reviewPath)).toEqual(["0", "1"]);
  const reader = document.createElement("p");
  setReviewBlockSelected(reader, true);
  expect(reader.classList.contains("kh-comment-block-selected")).toBe(true);
  setReviewBlockSelected(reader, false);
  expect(reader.classList.contains("kh-comment-block-selected")).toBe(false);
  view.destroy();
});

// The editor's own markup (Milkdown's `footnote_reference` and `html` nodes): a footnote reference
// is drawn as its label, inline HTML as its raw source with the value in `data-value`.
const footnoteRef = (label: string) => `<sup data-label="${label}" data-type="footnote_reference">${label}</sup>`;
const inlineHtml = (value: string) => `<span data-value="${value.replace(/</g, "&lt;").replace(/>/g, "&gt;")}" data-type="html">${value.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</span>`;

test("a footnote reference keeps every block stamped, the duplicates included", () => {
  const markdown = "Safe\n\nA note[^1] here.\n\nSafe\n\n[^1]: The note.\n";
  const root = editor(`<p>Safe</p><p>A note${footnoteRef("1")} here.</p><p>Safe</p><dl data-label="1" data-type="footnote_definition"><dt>1</dt><dd><p>The note.</p></dd></dl>`);
  document.body.replaceChildren(root);
  expect(stampEditorReviewPaths(root, markdown)).toBe(true);
  expect([...root.querySelectorAll("p")].map(p => p.getAttribute("data-review-path"))).toEqual(["0", "1", "2", "3.0"]);
  const paragraph = root.querySelectorAll<HTMLElement>("p")[1];
  expect(reviewBlockAnchor(paragraph, markdown)).toMatchObject({ blockPath: [1], exact: "A note here." });
  const range = document.createRange();
  range.setStart(paragraph.firstChild!, 2);
  range.setEnd(paragraph.lastChild!, 5);
  const selection = window.getSelection()!;
  selection.removeAllRanges(); selection.addRange(range);
  expect(readReviewSelection(root, markdown, selection).anchor).toMatchObject({ blockPath: [1], exact: "note here", startUtf16: 2, endUtf16: 11 });
});

test("an HTML comment keeps every block stamped and its paragraph takes a comment", () => {
  const markdown = "Safe\n\nOne <!-- c --> two.\n\nSafe";
  const root = editor(`<p>Safe</p><p>One ${inlineHtml("<!-- c -->")} two.</p><p>Safe</p>`);
  document.body.replaceChildren(root);
  expect(stampEditorReviewPaths(root, markdown)).toBe(true);
  expect([...root.querySelectorAll("p")].map(p => p.getAttribute("data-review-path"))).toEqual(["0", "1", "2"]);
  const paragraph = root.querySelectorAll<HTMLElement>("p")[1];
  expect(reviewBlockAnchor(paragraph, markdown)).toMatchObject({ blockPath: [1], exact: "One two." });
  const range = document.createRange();
  range.setStart(paragraph.firstChild!, 0);
  range.setEnd(paragraph.lastChild!, 4);
  const selection = window.getSelection()!;
  selection.removeAllRanges(); selection.addRange(range);
  expect(readReviewSelection(root, markdown, selection).anchor).toMatchObject({ blockPath: [1], exact: "One two", startUtf16: 0, endUtf16: 7 });
});

test("a <br> keeps its paragraph stamped but, drawn raw in the editor, it takes no comment there", () => {
  const markdown = "Safe\n\nOne<br>two.\n\nSafe";
  const root = editor(`<p>Safe</p><p>One${inlineHtml("<br>")}two.</p><p>Safe</p>`);
  document.body.replaceChildren(root);
  expect(stampEditorReviewPaths(root, markdown)).toBe(true);
  expect([...root.querySelectorAll("p")].map(p => p.getAttribute("data-review-path"))).toEqual(["0", "1", "2"]);
  const paragraph = root.querySelectorAll<HTMLElement>("p")[1];
  expect(reviewBlockAnchor(paragraph, markdown)).toBeNull();
  const range = document.createRange();
  range.setStart(paragraph.firstChild!, 0);
  range.setEnd(paragraph.lastChild!, 3);
  const selection = window.getSelection()!;
  selection.removeAllRanges(); selection.addRange(range);
  expect(readReviewSelection(root, markdown, selection).problem).toBe("unsupported");
});

test("duplicate cells stay stamped beside a footnote reference elsewhere", () => {
  const markdown = "| A | B |\n| --- | --- |\n| Same | Same |\n\nRef[^n] here.\n\n[^n]: Note.\n";
  const root = editor(`<table><tbody><tr><th><p>A</p></th><th><p>B</p></th></tr><tr><td><p>Same</p></td><td><p>Same</p></td></tr></tbody></table><p>Ref${footnoteRef("n")} here.</p><dl data-label="n" data-type="footnote_definition"><dt>n</dt><dd><p>Note.</p></dd></dl>`);
  expect(stampEditorReviewPaths(root, markdown)).toBe(true);
  expect([...root.querySelectorAll("th,td,body > p, div > p, dd > p")].map(p => p.getAttribute("data-review-path"))).toEqual(["0.0.0", "0.0.1", "0.1.0", "0.1.1", "1", "2.0"]);
});
