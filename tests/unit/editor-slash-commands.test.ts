// @vitest-environment jsdom
import { editorViewCtx } from "@milkdown/kit/core";
import { undo } from "@milkdown/kit/prose/history";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import type { Blockquote } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { afterEach, expect, it, vi } from "vitest";
import { createMarkdownEditor, type MarkdownEditor } from "@/components/knowledge/editor/editor-core";
import { matchingCommands, openBlockList, slashCommands } from "@/components/knowledge/editor/slash-commands";
import { extractDocumentLinks } from "@/modules/knowledge/domain/document-links";
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
  expect(matchingCommands('').length).toBe(16);
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
  expect(rows).toHaveLength(16);
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

// Launcher audit: the `/` list was one flat run of thirteen rows, and an internal page link had no
// entry at all (it was only reachable by knowing to type `[[`).
it("groups the list by kind", async () => {
  const { view } = await open();
  view.dispatch(view.state.tr.insertText("/"));
  expect([...menu().querySelectorAll("[data-slash-group]")].map((group) => group.textContent))
    .toEqual(["Basic blocks", "Lists", "Blocks", "Links"]);
});

it("offers a page link that hands off to the [[ list", async () => {
  const { view } = await open();
  view.dispatch(view.state.tr.insertText("/link"));
  key(view.dom, "Enter");
  expect(view.state.doc.firstChild?.textContent).toBe("[[");
  expect(view.state.selection.from).toBe(3);
});

it("keeps each group together for a filtered query", async () => {
  const { view } = await open();
  view.dispatch(view.state.tr.insertText("/t"));
  const groups = [...menu().querySelectorAll("[data-slash-group]")].map((group) => group.textContent);
  expect(groups).toEqual([...new Set(groups)]);
  expect(groups).toEqual(["Basic blocks", "Lists", "Blocks", "Links"]);
});

// 2026-11-21 list commands spec, decisions 1–3: the `/` list in a list item's first paragraph. Every result is read
// back from the saved Markdown, opened again in the editor.
function itemPositions(doc: ProseNode): number[] {
  const found: number[] = [];
  doc.descendants((node, pos) => { if (node.type.name === 'list_item') found.push(pos); });
  return found;
}
/** Puts the caret at the end of the `n`th item's first line (document order), its text first replaced by `text` when given. */
function inItem(view: EditorView, n: number, text?: string) {
  const pos = itemPositions(view.state.doc)[n];
  const line = view.state.doc.nodeAt(pos + 1)!;
  const from = pos + 2;
  const tr = view.state.tr;
  if (text !== undefined) { if (text) tr.replaceWith(from, from + line.content.size, view.state.schema.text(text)); else tr.delete(from, from + line.content.size); }
  tr.setSelection(TextSelection.create(tr.doc, from + (text ?? '\u0000'.repeat(line.content.size)).length));
  view.dispatch(tr);
}
async function typedInItem(markdown: string, n: number, text: string | undefined, typed: string) {
  const opened = await open(markdown);
  inItem(opened.view, n, text);
  opened.view.dispatch(opened.view.state.tr.insertText(typed));
  return opened;
}
const childTypes = (node: ProseNode) => { const types: string[] = []; node.forEach(child => types.push(child.type.name)); return types; };
const itemTexts = (list: ProseNode) => { const texts: string[] = []; list.forEach(item => texts.push(item.firstChild!.textContent)); return texts; };
/** The saved Markdown, and the document the editor makes of it when opened again. */
async function saved(editor: MarkdownEditor) {
  const markdown = editor.getMarkdown();
  const again = await open(markdown);
  return { markdown, doc: again.view.state.doc };
}

it('quote alone in an item splits the list, as one undoable step', async () => {
  const { editor, view } = await typedInItem('- a\n- b\n- c', 1, '', '/quo');
  expect(menu().hidden).toBe(false);
  key(view.dom, 'Enter');
  expect(menu().hidden).toBe(true);
  const before = view.state.doc;
  const { markdown, doc } = await saved(editor);
  expect(childTypes(doc)).toEqual(['bullet_list', 'blockquote', 'bullet_list']);
  expect(itemTexts(doc.child(0))).toEqual(['a']);
  expect(itemTexts(doc.child(2))).toEqual(['c']);
  expect(markdown).not.toContain('/quo');
  expect(childTypes(before)).toEqual(['bullet_list', 'blockquote', 'bullet_list']);
  undo(view.state, view.dispatch);
  expect(childTypes(view.state.doc)).toEqual(['bullet_list']);
  expect(itemTexts(view.state.doc.child(0))).toEqual(['a', '/quo', 'c']);
});

it('numbered from a bulleted item moves it into a numbered list of its own', async () => {
  const { editor, view } = await typedInItem('- a\n- b\n- c', 1, '', '/num');
  key(view.dom, 'Enter');
  view.dispatch(view.state.tr.insertText('B'));
  const { doc } = await saved(editor);
  expect(childTypes(doc)).toEqual(['bullet_list', 'ordered_list', 'bullet_list']);
  expect(itemTexts(doc.child(1))).toEqual(['B']);
});

it('same kind keeps the item, and the slash is gone', async () => {
  const { editor, view } = await typedInItem('- a\n- b\n- c', 1, '', '/bul');
  key(view.dom, 'Enter');
  expect(menu().hidden).toBe(true);
  const { markdown, doc } = await saved(editor);
  // An empty item is written `- <br />`, as Milkdown writes every empty paragraph; the "/bul" is gone.
  expect(markdown).toBe('- a\n- <br />\n- c\n');
  expect(childTypes(doc)).toEqual(['bullet_list']);
  expect(itemTexts(doc.child(0))).toEqual(['a', '', 'c']);
  expect(view.state.selection.$from.parent.type.name).toBe('paragraph');
  expect(view.state.selection.$from.node(-1).type.name).toBe('list_item');
});

it('only item turned: the list goes', async () => {
  const { editor, view } = await typedInItem('- x', 0, '', '/code');
  key(view.dom, 'Enter');
  view.dispatch(view.state.tr.insertText('let x'));
  const { doc } = await saved(editor);
  expect(childTypes(doc)).toEqual(['code_block']);
  expect(doc.firstChild!.textContent).toBe('let x');
});

it('an ordered list split by a turned item goes on with its numbers', async () => {
  const { editor, view } = await typedInItem('1. a\n2. b\n3. c', 1, '', '/quo');
  key(view.dom, 'Enter');
  const { doc } = await saved(editor);
  expect(childTypes(doc)).toEqual(['ordered_list', 'blockquote', 'ordered_list']);
  expect(doc.child(0).attrs.order).toBe(1);
  expect(doc.child(2).attrs.order).toBe(3);
});

it('page link stays inline in the item', async () => {
  const { view } = await typedInItem('- a\n- b\n- c', 1, '', '/page');
  key(view.dom, 'Enter');
  const item = view.state.doc.nodeAt(itemPositions(view.state.doc)[1])!;
  expect(item.type.name).toBe('list_item');
  expect(item.textContent).toBe('[[');
  expect(childTypes(view.state.doc)).toEqual(['bullet_list']);
});

it('date stays inline in the item', async () => {
  const { editor, view } = await typedInItem('- a\n- b\n- c', 1, '', '/date');
  key(view.dom, 'Enter');
  const { doc } = await saved(editor);
  expect(childTypes(doc)).toEqual(['bullet_list']);
  expect(itemTexts(doc.child(0))[1]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
});

it.each([['table', 'table'], ['tog', 'details'], ['call', 'blockquote'], ['mermaid', 'code_block']])('/%s alone in an item splits the list around a %s', async (query, type) => {
  const { editor, view } = await typedInItem('- a\n- b\n- c', 1, '', '/' + query);
  key(view.dom, 'Enter');
  const { doc } = await saved(editor);
  expect(childTypes(doc)).toEqual(['bullet_list', type, 'bullet_list']);
  expect(itemTexts(doc.child(0))).toEqual(['a']);
  expect(itemTexts(doc.child(2))).toEqual(['c']);
});

it('mid-line code goes below the item and splits the list after it', async () => {
  const { editor, view } = await typedInItem('- a\n- b\n- c', 1, 'b', ' /code');
  expect(menu().hidden).toBe(false);
  key(view.dom, 'Enter');
  view.dispatch(view.state.tr.insertText('run'));
  const { markdown, doc } = await saved(editor);
  expect(markdown).not.toContain('/code');
  expect(childTypes(doc)).toEqual(['bullet_list', 'code_block', 'bullet_list']);
  expect(itemTexts(doc.child(0)).map(text => text.trim())).toEqual(['a', 'b']);
  expect(doc.child(1).textContent).toBe('run');
  expect(itemTexts(doc.child(2))).toEqual(['c']);
});

it('mid-line bullet adds an item after it', async () => {
  const { editor, view } = await typedInItem('- a\n- b\n- c', 1, 'b', ' /bul');
  key(view.dom, 'Enter');
  view.dispatch(view.state.tr.insertText('new'));
  const { doc } = await saved(editor);
  expect(childTypes(doc)).toEqual(['bullet_list']);
  expect(itemTexts(doc.child(0)).map(text => text.trim())).toEqual(['a', 'b', 'new', 'c']);
});

it("a nested item's block becomes a child of the parent item", async () => {
  const { editor, view } = await typedInItem('- a\n  - n', 1, '', '/quo');
  key(view.dom, 'Enter');
  view.dispatch(view.state.tr.insertText('said'));
  const { doc } = await saved(editor);
  expect(childTypes(doc)).toEqual(['bullet_list']);
  const item = doc.child(0).child(0);
  expect(childTypes(item)).toEqual(['paragraph', 'blockquote']);
  expect(item.child(1).textContent).toBe('said');
});

it("a mid-line block in a nested item becomes a child of the parent item, after or splitting the nested list", async () => {
  const last = await typedInItem('- a\n  - n', 1, 'n', ' /code');
  key(last.view.dom, 'Enter');
  const after = (await saved(last.editor)).doc;
  expect(childTypes(after)).toEqual(['bullet_list']);
  expect(childTypes(after.child(0).child(0))).toEqual(['paragraph', 'bullet_list', 'code_block']);

  const middle = await typedInItem('- a\n  - n1\n  - n2', 1, 'n1', ' /code');
  key(middle.view.dom, 'Enter');
  middle.view.dispatch(middle.view.state.tr.insertText('x'));
  const split = (await saved(middle.editor)).doc;
  expect(childTypes(split)).toEqual(['bullet_list']);
  const item = split.child(0).child(0);
  expect(childTypes(item)).toEqual(['paragraph', 'bullet_list', 'code_block', 'bullet_list']);
  expect(itemTexts(item.child(1)).map(text => text.trim())).toEqual(['n1']);
  expect(item.child(2).textContent).toBe('x');
  expect(itemTexts(item.child(3))).toEqual(['n2']);
});

it('works in a list item inside a quote', async () => {
  const { editor, view } = await typedInItem('> - a\n> - b', 1, '', '/code');
  key(view.dom, 'Enter');
  view.dispatch(view.state.tr.insertText('x'));
  const { doc } = await saved(editor);
  expect(childTypes(doc)).toEqual(['blockquote']);
  expect(childTypes(doc.child(0))).toEqual(['bullet_list', 'code_block']);
});

it('inline code in an item keeps the slash: no list opens', async () => {
  const { view } = await open('- a\n- `ls`\n- c');
  const pos = itemPositions(view.state.doc)[1];
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos + 3)));
  view.dispatch(view.state.tr.insertText(' /co'));
  expect(menu().hidden).toBe(true);
});

it('an item holding a wikilink keeps it, and its edge, when a mid-line block goes below', async () => {
  const { editor, view } = await typedInItem('- a\n- [[T]]\n- c', 1, undefined, ' /code');
  expect(menu().hidden).toBe(false);
  key(view.dom, 'Enter');
  const { markdown, doc } = await saved(editor);
  expect(childTypes(doc)).toEqual(['bullet_list', 'code_block', 'bullet_list']);
  expect(markdown).toContain('[[T]]');
  expect(markdown).not.toContain('\\[');
  expect(extractDocumentLinks(markdown).map(link => link.target)).toEqual(['T']);
  let wiki = 0;
  doc.child(0).descendants(node => { if (node.type.name === 'wiki_link') wiki++; });
  expect(wiki).toBe(1);
});

// Fix round: a divider in an item is followed by an empty line, as at the top level, and the caret goes there, so the
// next key neither replaces the divider nor types into the next item.
it.each([
  ['the middle item', '- a\n- b\n- c', 1, '', ['bullet_list', 'hr', 'paragraph', 'bullet_list']],
  ['the last item', '- a\n- b', 1, '', ['bullet_list', 'hr', 'paragraph']],
  ['the only item', '- b', 0, '', ['hr', 'paragraph']],
  ['the last item, mid-line', '- a\n- b', 1, 'b', ['bullet_list', 'hr', 'paragraph']],
])('/hr in %s keeps the divider, and what is typed next goes on a line after it', async (_name, markdown, n, text, types) => {
  const { editor, view } = await typedInItem(markdown, n, text, text ? ' /hr' : '/hr');
  key(view.dom, 'Enter');
  view.dispatch(view.state.tr.insertText('Z'));
  const { doc } = await saved(editor);
  expect(childTypes(doc)).toEqual(types);
  const after = types.indexOf('hr') + 1;
  expect(doc.child(after).textContent).toBe('Z');
  if (types.at(-1) === 'bullet_list' && types.length > 3) expect(itemTexts(doc.child(after + 1))).toEqual(['c']);
});

it('/table in the middle of a list puts the caret in its first cell, not in the next item', async () => {
  const { editor, view } = await typedInItem('- a\n- b\n- c', 1, '', '/table');
  key(view.dom, 'Enter');
  expect(view.state.selection.$from.node(-1).type.name).toBe('table_header');
  view.dispatch(view.state.tr.insertText('Z'));
  const { doc } = await saved(editor);
  expect(itemTexts(doc.child(2))).toEqual(['c']);
  expect(doc.child(1).firstChild!.firstChild!.textContent).toBe('Z');
});

// Deviation (list commands spec): an item with a nested list keeps it; a block that would replace the item goes below it.
it('a quote chosen alone in an item with a nested list goes after the item, keeping the nested list', async () => {
  const { editor, view } = await typedInItem('- a\n- p\n  - n\n- c', 1, '', '/quo');
  key(view.dom, 'Enter');
  view.dispatch(view.state.tr.insertText('said'));
  const { markdown, doc } = await saved(editor);
  expect(markdown).not.toContain('/quo');
  expect(childTypes(doc)).toEqual(['bullet_list', 'blockquote', 'bullet_list']);
  expect(itemTexts(doc.child(0))).toEqual(['a', '']);
  const parent = doc.child(0).child(1);
  expect(childTypes(parent)).toEqual(['paragraph', 'bullet_list']);
  expect(itemTexts(parent.child(1))).toEqual(['n']);
  expect(doc.child(1).textContent).toBe('said');
  expect(itemTexts(doc.child(2))).toEqual(['c']);
});

it('works in a list item inside a toggle body', async () => {
  const { editor, view } = await typedInItem('<details open>\n<summary>T</summary>\n\n- a\n- b\n\n</details>', 1, '', '/code');
  expect(menu().hidden).toBe(false);
  key(view.dom, 'Enter');
  view.dispatch(view.state.tr.insertText('x'));
  const { doc } = await saved(editor);
  expect(childTypes(doc)).toEqual(['details']);
  expect(childTypes(doc.child(0).lastChild!)).toEqual(['bullet_list', 'code_block']);
  expect(doc.child(0).lastChild!.lastChild!.textContent).toBe('x');
});

it('works in a list item inside a callout', async () => {
  const { editor, view } = await typedInItem('> [!NOTE]\n> - a\n> - b', 1, '', '/code');
  expect(menu().hidden).toBe(false);
  key(view.dom, 'Enter');
  view.dispatch(view.state.tr.insertText('x'));
  const { markdown, doc } = await saved(editor);
  expect(markdown).toContain('[!NOTE]');
  expect(childTypes(doc)).toEqual(['blockquote']);
  expect(childTypes(doc.child(0))).toEqual(['paragraph', 'bullet_list', 'code_block']);
  expect(doc.child(0).lastChild!.textContent).toBe('x');
});

it('a mid-line /todo in a to-do item adds an unchecked to-do after it', async () => {
  const { editor, view } = await typedInItem('- [x] a\n- [x] b', 1, 'b', ' /todo');
  key(view.dom, 'Enter');
  view.dispatch(view.state.tr.insertText('new'));
  const { doc } = await saved(editor);
  expect(childTypes(doc)).toEqual(['bullet_list']);
  expect(itemTexts(doc.child(0)).map(text => text.trim())).toEqual(['a', 'b', 'new']);
  const checked: unknown[] = []; doc.child(0).forEach(item => checked.push(item.attrs.checked));
  expect(checked).toEqual([true, true, false]);
});

it('a mid-line same-kind item in a numbered list takes no stale label', async () => {
  const { view } = await typedInItem('1. a\n2. b\n3. c', 1, 'b', ' /num');
  key(view.dom, 'Enter');
  const list = view.state.doc.child(0);
  expect(list.childCount).toBe(4);
  expect(list.child(2).attrs.label).not.toBe(list.child(1).attrs.label);
});

// An item whose first line is empty and which holds more is not written `- <br />`: the indented lines after a lone
// `<br />` read back as part of that HTML, and the nested list was lost on reopening.
it.each(['- a\n- p\n  - n\n- c', '1. a\n2. p\n   1. n\n3. c', '- [ ] a\n- [x] p\n  - [ ] n\n- [ ] c'])('an item with an empty first line keeps its nested list through save and reopen: %j', async (source) => {
  const { editor, view } = await open(source);
  inItem(view, 1, '');
  const { markdown, doc } = await saved(editor);
  if (!source.includes('[')) expect(markdown).not.toContain('<br />');
  expect(doc.toString()).toBe(view.state.doc.toString());
  const checked: unknown[] = []; doc.descendants(node => { if (node.type.name === 'list_item') checked.push(node.attrs.checked); });
  const before: unknown[] = []; view.state.doc.descendants(node => { if (node.type.name === 'list_item') before.push(node.attrs.checked); });
  expect(checked).toEqual(before);
});
