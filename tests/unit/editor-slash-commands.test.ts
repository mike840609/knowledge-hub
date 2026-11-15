// @vitest-environment jsdom
import { editorViewCtx } from "@milkdown/kit/core";
import { undo } from "@milkdown/kit/prose/history";
import { TextSelection } from "@milkdown/kit/prose/state";
import type { Blockquote } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { afterEach, expect, it, vi } from "vitest";
import { createMarkdownEditor, type MarkdownEditor } from "@/components/knowledge/editor/editor-core";
import { matchingCommands, openBlockList, slashCommands } from "@/components/knowledge/editor/slash-commands";
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

it('inserts an empty toggle with the caret in its summary', async () => {
  const { editor, view } = await open();
  view.dispatch(view.state.tr.insertText('/toggle'));
  key(view.dom, 'Enter');
  expect(view.dom.querySelector('details')?.open).toBe(true);
  expect(view.dom.querySelector('summary')).not.toBeNull();
  expect(view.state.selection.$from.parent.type.name).toBe('details_summary');
  view.dispatch(view.state.tr.insertText('New title'));
  expect(editor.getMarkdown()).toContain('<summary>New title</summary>');
  key(view.dom, 'Enter');
  expect(view.state.selection.$from.parent.type.name).toBe('paragraph');
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

// Decision 16: aliases match by prefix, case-insensitively, beside the label and words.
it.each([
  ['h1', 'heading', { level: 1 }], ['H2', 'heading', { level: 2 }], ['h3', 'heading', { level: 3 }],
  ['p', 'paragraph', {}], ['todo', 'bullet_list', {}], ['check', 'bullet_list', {}], ['ul', 'bullet_list', {}], ['bul', 'bullet_list', {}],
  ['ol', 'ordered_list', {}], ['num', 'ordered_list', {}], ['hr', 'hr', {}], ['LINE', 'hr', {}], ['quo', 'blockquote', {}],
  ['co', 'code_block', {}], ['tab', 'table', {}], ['tog', 'details', {}], ['call', 'blockquote', {}],
])('/%s picks its block first, by alias', async (query, type, attrs) => {
  const { view } = await open();
  view.dispatch(view.state.tr.insertText('/' + query));
  key(view.dom, 'Enter');
  const first = view.state.doc.firstChild!;
  expect(first.type.name).toBe(type);
  expect(first.attrs).toMatchObject(attrs);
  if (query === 'todo' || query === 'check') expect(first.firstChild?.attrs.checked).toBe(false);
  if (query === 'call') expect(first.textContent).toBe('[!NOTE]');
});

it('matches aliases by prefix only, and label or words anywhere, aliases first', () => {
  expect(matchingCommands('ol').map(command => command.id)).toEqual(['ordered', 'toggle']);
  expect(matchingCommands('co').map(command => command.id)).toEqual(['code', 'toggle']);
  expect(matchingCommands('CA').map(command => command.id)).toEqual(['callout']);
  expect(matchingCommands('odo').map(command => command.id)).toEqual([]);
  expect(matchingCommands('').length).toBe(13);
});

it('puts an exact alias, then a label prefix, before an alias prefix', () => {
  expect(matchingCommands('t')[0].id).toBe('text');
  expect(matchingCommands('c')[0].id).toBe('code');
  expect(matchingCommands('h2')[0].id).toBe('h2');
  expect(matchingCommands('todo')[0].id).toBe('task');
  expect(matchingCommands('li').slice(0, 2).map(command => command.id)).toEqual(['bullet', 'ordered']);
});

it('draws a 16px Lucide icon, hidden from assistive technology, at the left of every row', async () => {
  const { view } = await open();
  view.dispatch(view.state.tr.insertText('/'));
  const rows = [...menu().querySelectorAll<HTMLElement>('[role="option"]')];
  expect(rows).toHaveLength(13);
  for (const row of rows) {
    const icon = row.firstElementChild!;
    expect(icon.tagName.toLowerCase()).toBe('svg');
    expect(icon.getAttribute('aria-hidden')).toBe('true');
    expect(icon.getAttribute('class')).toContain('lucide');
    expect(icon.getAttribute('class')).toContain('size-4');
    expect(icon.getAttribute('class')).toContain('text-kh-text-muted');
  }
  expect(rows[0].textContent).toBe('TextPlain paragraph');
});

// Decision 15 (deviation): `+` writes a visible "/" on its new line and opens the list a typed "/" opens.
async function plusLine(markdown = 'Opening line.') {
  const opened = await open(markdown);
  const { view } = opened;
  view.dispatch(view.state.tr.insert(view.state.doc.content.size, view.state.schema.nodes.paragraph.create()));
  view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)));
  expect(openBlockList(view)).toBe(true);
  return opened;
}
const optionLabels = () => [...menu().querySelectorAll('[role="option"]')].map(row => row.textContent);

it('opens with a visible "/" on the new line, filters by what is typed, and picks a block', async () => {
  const { editor, view } = await plusLine();
  expect(menu().hidden).toBe(false);
  expect(view.dom.getAttribute('role')).toBe('combobox');
  expect(view.state.doc.child(1).textContent).toBe('/');
  view.dispatch(view.state.tr.insertText('h2'));
  expect(optionLabels()).toEqual(['Heading 2Section heading']);
  key(view.dom, 'Enter');
  expect(view.state.doc.child(1).type.name).toBe('heading');
  expect(view.state.doc.child(1).attrs.level).toBe(2);
  expect(view.state.doc.child(1).textContent).toBe('');
  view.dispatch(view.state.tr.insertText('Picked'));
  expect(editor.getMarkdown()).toBe('Opening line.\n\n## Picked\n');
});

it('never drops a word typed after +: it is in sight as the "/" query and stays when the list is dismissed', async () => {
  const { editor, view } = await plusLine();
  view.dispatch(view.state.tr.insertText('Title'));
  expect(view.dom.querySelectorAll('p')[1].textContent).toBe('/Title');
  expect(menu().hidden).toBe(false);
  key(view.dom, 'Escape');
  expect(menu().hidden).toBe(true);
  key(view.dom, 'Enter');
  expect(view.state.doc.textContent).toContain('/Title');
  expect(editor.getMarkdown()).toContain('/Title');
});

it('a word after + is the same query a typed "/word" is', async () => {
  const plus = await plusLine();
  plus.view.dispatch(plus.view.state.tr.insertText('Title'));
  const fromPlus = { hidden: menu().hidden, rows: optionLabels() };
  const typed = await open('Opening line.');
  typed.view.dispatch(typed.view.state.tr.insert(typed.view.state.doc.content.size, typed.view.state.schema.nodes.paragraph.create()));
  typed.view.dispatch(typed.view.state.tr.setSelection(TextSelection.atEnd(typed.view.state.doc)));
  typed.view.dispatch(typed.view.state.tr.insertText('/Title'));
  expect({ hidden: menu().hidden, rows: optionLabels() }).toEqual(fromPlus);
  expect(plus.editor.getMarkdown()).toBe(typed.editor.getMarkdown());
});

it('a list + opened, dismissed by Escape or by leaving with the "/" alone, takes the "/" back', async () => {
  const { view } = await plusLine('');
  expect(menu().hidden).toBe(false);
  const bubbled = vi.fn(); document.body.addEventListener('keydown', bubbled);
  key(view.dom, 'Escape');
  document.body.removeEventListener('keydown', bubbled);
  expect(bubbled).not.toHaveBeenCalled();
  expect(menu().hidden).toBe(true);
  expect(view.state.doc.child(1).textContent).toBe('');
  expect(view.state.selection.$from.parent).toBe(view.state.doc.child(1));
  expect(view.dom.querySelectorAll('p')[1].getAttribute('data-placeholder')).toBe('Type "/" for commands');
  // Typing after Escape is writing, not searching.
  view.dispatch(view.state.tr.insertText('h'));
  expect(menu().hidden).toBe(true);
  expect(view.state.doc.child(1).textContent).toBe('h');

  const other = await plusLine();
  expect(menu().hidden).toBe(false);
  other.view.dom.blur(); other.view.dom.dispatchEvent(new FocusEvent('blur'));
  expect(menu().hidden).toBe(true);
  expect(other.view.state.doc.child(1).textContent).toBe('');
  other.view.focus(); other.view.dom.dispatchEvent(new FocusEvent('focus'));
  expect(menu().hidden).toBe(true);
  expect(other.editor.getMarkdown()).toBe('Opening line.\n');

  // The caret leaving the line lets it go as well.
  const third = await plusLine();
  third.view.dispatch(third.view.state.tr.setSelection(TextSelection.atStart(third.view.state.doc)));
  expect(menu().hidden).toBe(true);
  expect(third.view.state.doc.child(1).textContent).toBe('');
});

it('a list + opened keeps what follows its "/" when dismissed, and a typed "/" is never taken back', async () => {
  const { view } = await plusLine();
  view.dispatch(view.state.tr.insertText('quo'));
  key(view.dom, 'Escape');
  expect(menu().hidden).toBe(true);
  expect(view.state.doc.child(1).textContent).toBe('/quo');
  // Typed by hand, a lone "/" stays when its list is dismissed.
  const typed = await open();
  typed.view.dispatch(typed.view.state.tr.insertText('/'));
  key(typed.view.dom, 'Escape');
  expect(typed.view.state.doc.textContent).toBe('/');
  // Without the "/" list installed, + writes nothing.
  expect(openBlockList(typed.view)).toBe(false);
});
