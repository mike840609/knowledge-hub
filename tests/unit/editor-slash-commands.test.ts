// @vitest-environment jsdom
import { editorViewCtx } from "@milkdown/kit/core";
import { undo } from "@milkdown/kit/prose/history";
import { TextSelection } from "@milkdown/kit/prose/state";
import type { Blockquote } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { afterEach, expect, it, vi } from "vitest";
import { createMarkdownEditor, type MarkdownEditor } from "@/components/knowledge/editor/editor-core";
import { slashCommands } from "@/components/knowledge/editor/slash-commands";
import { calloutMarker } from "@/shared/markdown/remark-callouts";

const rect = { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 } as DOMRect;
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => rect;
const opened: MarkdownEditor[] = [];
afterEach(async () => { for (const editor of opened.splice(0)) await editor.destroy(); document.body.innerHTML = ""; });
async function open(markdown = "") {
  const root = document.body.appendChild(document.createElement("div"));
  const slash = slashCommands(); const changed = vi.fn();
  const editor = await createMarkdownEditor({ root, markdown, className: "kh-editor", ariaLabel: "Content", editable: true, onUserEdit: changed, onMarkdown: () => {}, allowImage: () => false, extraPlugins: slash.plugins, configure: slash.configure });
  opened.push(editor);
  const view = editor.action(ctx => ctx.get(editorViewCtx)); view.focus();
  return { editor, view, changed };
}
const menu = () => [...document.querySelectorAll<HTMLElement>('.kh-slash-menu')].at(-1)!;
function key(dom: HTMLElement, name: string, init: KeyboardEventInit = {}) { dom.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...init })); }

it('shows a presentation-only hint and opening the editor does not modify the document', async () => {
  const { view, changed } = await open();
  expect(view.dom.querySelector('p')?.getAttribute('data-placeholder')).toBe('Type "/" for commands');
  expect(changed).not.toHaveBeenCalled();
  expect(view.state.doc.textContent).toBe('');
  expect(menu().hidden).toBe(true);
});

it.each([
  ['heading 2', 'heading', '## New block'], ['bullet', 'bullet_list', '- New block'],
  ['numbered', 'ordered_list', '1. New block'], ['to-do', 'bullet_list', '- [ ] New block'],
  ['quote', 'blockquote', '> New block'], ['code', 'code_block', 'New block'],
  ['divider', 'hr', '---'], ['text', 'paragraph', 'New block'],
  ['table', 'table', 'New block'], ['toggle', 'details', '<summary>'], ['callout', 'blockquote', '[!NOTE]'],
])('converts /%s as one undoable command and saves valid Markdown', async (query, type, markdown) => {
  const { editor, view } = await open();
  view.dispatch(view.state.tr.insertText('/' + query));
  expect(menu().hidden).toBe(false);
  expect(view.dom.getAttribute('aria-controls')).toBe(menu().id);
  key(view.dom, 'Enter');
  expect(view.state.doc.firstChild?.type.name).toBe(type);
  expect(menu().hidden).toBe(true);
  const chosen = view.state.doc;
  undo(view.state, view.dispatch);
  expect(view.state.doc.textContent).toBe('/' + query);
  key(view.dom, 'Enter');
  expect(view.state.doc.eq(chosen)).toBe(true);
  view.dispatch(view.state.tr.insertText('New block'));
  expect(editor.getMarkdown()).toContain(markdown);
});

it.each(['quote', 'table', 'toggle', 'callout'])('keeps /%s when undoing typing that follows it at once', async (query) => {
  const { view } = await open();
  view.dispatch(view.state.tr.insertText('/' + query));
  key(view.dom, 'Enter');
  const chosen = view.state.doc;
  view.dispatch(view.state.tr.insertText('x'));
  undo(view.state, view.dispatch);
  expect(view.state.doc.eq(chosen)).toBe(true);
});

it('supports filtering, arrow navigation and Escape without leaving the editor', async () => {
  const { view } = await open();
  view.dispatch(view.state.tr.insertText('/heading'));
  key(view.dom, 'ArrowDown');
  expect(menu().querySelector('[aria-selected="true"]')?.textContent).toContain('Heading 2');
  key(view.dom, 'Tab');
  expect(view.state.doc.firstChild?.attrs.level).toBe(2);
  const other = await open();
  other.view.dispatch(other.view.state.tr.insertText('/'));
  const bubbled = vi.fn(); document.body.addEventListener('keydown', bubbled);
  key(other.view.dom, 'Escape');
  expect(bubbled).not.toHaveBeenCalled();
  expect(other.view.state.doc.textContent).toBe('/');
  expect(menu().hidden).toBe(true);
  document.body.removeEventListener('keydown', bubbled);
});

it('builds a 2x2 table with the caret in the first cell', async () => {
  const { editor, view } = await open();
  view.dispatch(view.state.tr.insertText('/table'));
  key(view.dom, 'Enter');
  const table = view.state.doc.firstChild;
  expect(table?.type.name).toBe('table');
  expect(table?.childCount).toBe(2);
  expect(table?.firstChild?.type.name).toBe('table_header_row');
  expect(table?.lastChild?.type.name).toBe('table_row');
  view.dispatch(view.state.tr.insertText('New block'));
  expect(editor.getMarkdown()).toContain('| New block');
});

it('inserts an empty toggle with the caret in its body', async () => {
  const { editor, view } = await open();
  view.dispatch(view.state.tr.insertText('/toggle'));
  key(view.dom, 'Enter');
  expect(view.dom.querySelector('details')?.open).toBe(true);
  expect(view.dom.querySelector('summary')).not.toBeNull();
  view.dispatch(view.state.tr.insertText('New block'));
  expect(editor.getMarkdown()).toContain('</summary>\n\nNew block\n\n</details>');
});

it('inserts a callout that stays one after the user types and saves', async () => {
  const { editor, view } = await open();
  view.dispatch(view.state.tr.insertText('/callout'));
  key(view.dom, 'Enter');
  view.dispatch(view.state.tr.insertText('New block'));
  expect(view.dom.querySelector('blockquote')?.getAttribute('data-callout')).toBe('note');
  const quote = fromMarkdown(editor.getMarkdown()).children[0] as Blockquote;
  expect(quote.type).toBe('blockquote');
  expect(calloutMarker(quote)?.kind).toBe('note');
  expect(editor.getMarkdown()).toContain('New block');
});

it('leaves slash text in code and nested paragraphs alone, and hides when read-only', async () => {
  for (const markdown of ['```\ncode\n```', '- item', '| A |\n| - |\n| B |']) {
    const { view } = await open(markdown);
    view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)).insertText('/code'));
    expect(menu().hidden).toBe(true);
  }
  const { editor, view } = await open();
  view.dispatch(view.state.tr.insertText('/'));
  editor.setEditable(false);
  expect([...document.querySelectorAll<HTMLElement>('.kh-slash-menu')].every(element => element.hidden)).toBe(true);
});

it('does not intercept IME Enter or modifier-save keys', async () => {
  const { view } = await open();
  view.dispatch(view.state.tr.insertText('/code'));
  key(view.dom, 'Enter', { isComposing: true, keyCode: 229 });
  expect(view.state.doc.firstChild?.type.name).toBe('paragraph');
  key(view.dom, 'Enter', { ctrlKey: true });
  expect(view.state.doc.textContent).toBe('/code');
});
