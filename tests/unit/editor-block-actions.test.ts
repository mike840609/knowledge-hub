// @vitest-environment jsdom
import { editorViewCtx } from "@milkdown/kit/core";
import { undo, redo } from "@milkdown/kit/prose/history";
import { afterEach, expect, it, vi } from "vitest";
import { createMarkdownEditor, type MarkdownEditor } from "@/components/knowledge/editor/editor-core";
import { insertBlockBelow, moveBlock, topLevelBlocks, turnBlockInto, duplicateBlock, deleteBlock, canTurnInto } from "@/components/knowledge/editor/block-actions";
import { extractDocumentLinks } from "@/modules/knowledge/domain/document-links";
import { LINK_MARKDOWN_FIXTURES } from "../fixtures/link-markdown";

const rect = { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 } as DOMRect;
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => rect;
const opened: MarkdownEditor[] = [];
afterEach(async () => { for (const editor of opened.splice(0)) await editor.destroy(); document.body.innerHTML = ""; });
async function open(markdown: string) {
  const root = document.body.appendChild(document.createElement("div"));
  const changed = vi.fn();
  const editor = await createMarkdownEditor({ root, markdown, className: "kh-editor", ariaLabel: "Content", editable: true, onUserEdit: changed, onMarkdown: () => {}, allowImage: () => false });
  opened.push(editor);
  return { editor, view: editor.action(ctx => ctx.get(editorViewCtx)), changed };
}

it("inserts a paragraph after a complete table and focuses it, as one undo step", async () => {
  const { editor, view } = await open('| A | B |\n| - | - |\n| one | two |\n\nTail');
  const original = view.state.doc;
  expect(insertBlockBelow(view, 0)).toBe(true);
  expect(view.state.doc.child(1).type.name).toBe('paragraph');
  expect(view.state.doc.child(1).textContent).toBe('');
  expect(view.state.selection.$from.index(0)).toBe(1);
  undo(view.state, view.dispatch);
  expect(view.state.doc.eq(original)).toBe(true);
  expect(editor.getMarkdown()).toContain('one');
});

it("moves a nested list intact, with undo and redo preserving the exact document", async () => {
  const { view } = await open('First\n\n- parent\n  - child\n\nLast');
  const original = view.state.doc;
  const list = original.child(1);
  expect(moveBlock(view, original.child(0).nodeSize, original.content.size)).toBe(true);
  expect(view.state.doc.lastChild?.eq(list)).toBe(true);
  const moved = view.state.doc;
  undo(view.state, view.dispatch);
  expect(view.state.doc.eq(original)).toBe(true);
  redo(view.state, view.dispatch);
  expect(view.state.doc.eq(moved)).toBe(true);
});

it("moves a code block upward without changing its content", async () => {
  const { view } = await open('First\n\n```js\nconst x = 1;\n```\n\nLast');
  const code = view.state.doc.child(1);
  moveBlock(view, view.state.doc.firstChild!.nodeSize, 0);
  expect(view.state.doc.firstChild?.eq(code)).toBe(true);
});

it("rejects invalid boundaries, no-op moves and read-only actions", async () => {
  const { editor, view, changed } = await open('First\n\nLast');
  const original = view.state.doc;
  expect(moveBlock(view, 0, 1)).toBe(false);
  expect(moveBlock(view, 0, original.firstChild!.nodeSize)).toBe(false);
  expect(insertBlockBelow(view, 1)).toBe(false);
  editor.setEditable(false);
  expect(moveBlock(view, 0, original.content.size)).toBe(false);
  expect(insertBlockBelow(view, 0)).toBe(false);
  expect(view.state.doc.eq(original)).toBe(true);
  expect(changed).not.toHaveBeenCalled();
});

it("turns a paragraph into a heading and back as one undo step", async () => {
  const { view } = await open('Title\n\nBody');
  const pos = topLevelBlocks(view.state.doc)[0].pos;
  expect(turnBlockInto(view, pos, 'h2')).toBe(true);
  expect(view.state.doc.firstChild?.type.name).toBe('heading');
  expect(view.state.doc.firstChild?.attrs.level).toBe(2);
  expect(view.state.doc.firstChild?.textContent).toBe('Title');
  undo(view.state, view.dispatch);
  expect(view.state.doc.firstChild?.type.name).toBe('paragraph');
});

it("turns a paragraph into a list, a quote and a code block without losing its text", async () => {
  const { view } = await open('A thought with **weight**');
  const pos = 0;
  expect(turnBlockInto(view, pos, 'bullet')).toBe(true);
  expect(view.state.doc.firstChild?.type.name).toBe('bullet_list');
  expect(view.state.doc.firstChild?.textContent).toBe('A thought with weight');
  expect(turnBlockInto(view, pos, 'quote')).toBe(true);
  expect(view.state.doc.firstChild?.type.name).toBe('blockquote');
  expect(turnBlockInto(view, pos, 'code')).toBe(true);
  expect(view.state.doc.firstChild?.type.name).toBe('code_block');
  expect(view.state.doc.firstChild?.textContent).toBe('A thought with weight');
});

it("turns a several-item list into one paragraph per item, and refuses a single heading", async () => {
  const { view } = await open('- one\n- two\n- three');
  const pos = 0;
  const list = view.state.doc.firstChild!;
  expect(canTurnInto(list, 'h2')).toBe(false);
  expect(turnBlockInto(view, pos, 'h2')).toBe(false);
  expect(turnBlockInto(view, pos, 'paragraph')).toBe(true);
  expect([...Array(view.state.doc.childCount)].map((_, index) => view.state.doc.child(index).textContent)).toEqual(['one', 'two', 'three']);
});

it("refuses to turn a table into text, which would drop its cells", async () => {
  const { view } = await open('| A | B |\n| - | - |\n| one | two |');
  const table = view.state.doc.firstChild!;
  expect(table.type.name).toBe('table');
  expect(canTurnInto(table, 'paragraph')).toBe(false);
  expect(turnBlockInto(view, 0, 'paragraph')).toBe(false);
});

it("duplicates the block below and deletes it as one undo step", async () => {
  const { view } = await open('Keep me\n\nRemove me');
  const second = topLevelBlocks(view.state.doc)[1];
  expect(duplicateBlock(view, second.pos)).toBe(true);
  expect(view.state.doc.childCount).toBe(3);
  expect(view.state.doc.child(2).textContent).toBe('Remove me');
  undo(view.state, view.dispatch);
  expect(view.state.doc.childCount).toBe(2);

  expect(deleteBlock(view, second.pos)).toBe(true);
  expect(view.state.doc.childCount).toBe(1);
  expect(view.state.doc.firstChild?.textContent).toBe('Keep me');
  undo(view.state, view.dispatch);
  expect(view.state.doc.childCount).toBe(2);
});

it("keeps an empty paragraph when the only block is deleted", async () => {
  const { view } = await open('Only');
  expect(deleteBlock(view, 0)).toBe(true);
  expect(view.state.doc.childCount).toBe(1);
  expect(view.state.doc.firstChild?.type.name).toBe('paragraph');
  expect(view.state.doc.firstChild?.textContent).toBe('');
});

it("refuses block changes in a read-only editor", async () => {
  const { editor, view } = await open('First');
  editor.setEditable(false);
  expect(turnBlockInto(view, 0, 'h2')).toBe(false);
  expect(duplicateBlock(view, 0)).toBe(false);
  expect(deleteBlock(view, 0)).toBe(false);
});

// What a saved document's link index would hold, in no order: a move changes the order, never the links.
const links = (markdown: string) => extractDocumentLinks(markdown)
  .map(({ kind, target, fragment, display }) => JSON.stringify({ kind, target, fragment, display })).sort();

it.each(LINK_MARKDOWN_FIXTURES)("keeps the links of a document when a block is added and one is moved: $name", async ({ markdown, links: expected }) => {
  const { editor, view } = await open(`${markdown}\n\nA paragraph after it.\n`);
  const wanted = expected.map(link => JSON.stringify(link)).sort();
  expect(links(editor.getMarkdown())).toEqual(wanted);
  expect(insertBlockBelow(view, 0)).toBe(true);
  expect(links(editor.getMarkdown())).toEqual(wanted);
  expect(moveBlock(view, 0, view.state.doc.content.size)).toBe(true);
  expect(links(editor.getMarkdown())).toEqual(wanted);
  undo(view.state, view.dispatch);
  expect(links(editor.getMarkdown())).toEqual(wanted);
});
