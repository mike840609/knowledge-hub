// @vitest-environment jsdom
import { editorViewCtx } from '@milkdown/kit/core';
import { TextSelection } from '@milkdown/kit/prose/state';
import { afterEach, expect, it } from 'vitest';
import { createMarkdownEditor, type MarkdownEditor } from '@/components/knowledge/editor/editor-core';
const editors: MarkdownEditor[] = [];
afterEach(async () => { for (const editor of editors.splice(0)) await editor.destroy(); document.body.innerHTML = ''; });
async function open(markdown: string) {
  const root = document.body.appendChild(document.createElement('div'));
  const editor = await createMarkdownEditor({ root, markdown, className: 'kh-editor', ariaLabel: 'Content', editable: true, onUserEdit() {}, onMarkdown() {}, allowImage: () => false });
  editors.push(editor);
  return { root, editor, view: editor.action(ctx => ctx.get(editorViewCtx)) };
}
it('renders a disclosure with an editable summary and keeps edits on reopen', async () => {
  const { root, editor, view } = await open('<details open>\n<summary>More</summary>\n\nbody\n\n</details>\n');
  expect(root.querySelector('details summary')?.textContent).toBe('More');
  expect(root.querySelector('details')?.open).toBe(true);
  let summary = -1;
  view.state.doc.descendants((node, pos) => { if (node.type.name === 'details_summary') summary = pos + 1; });
  expect(summary).toBeGreaterThan(0);
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, summary)).insertText('Read '));
  expect(editor.getMarkdown()).toContain('<summary>Read More</summary>');
  expect((await open(editor.getMarkdown())).root.querySelector('summary')?.textContent).toBe('Read More');
});
it('leaves unrecognized or unbalanced details as inert text', async () => {
  for (const markdown of ['<details onclick="alert(1)">\n\nbody\n\n</details>', '<details>\n\nbody']) {
    const { root, editor } = await open(markdown);
    expect(root.querySelector('details')).toBeNull();
    expect(editor.getMarkdown()).toContain('body');
  }
});
it('renders the callout title and hides the source marker while keeping its Markdown', async () => {
  const { root, editor } = await open('> [!NOTE]\n>\n> body\n');
  expect(root.querySelector('.kh-callout-title')?.textContent).toBe('Note');
  expect(root.querySelector('.kh-callout-marker')?.textContent).toBe('[!NOTE]');
  expect(editor.getMarkdown()).toContain('[!NOTE]');
});
it('puts editable tables in a scroll container', async () => {
  const { root } = await open('| A | B |\n| - | - |\n| one | two |');
  expect(root.querySelector('.kh-markdown-table table')).not.toBeNull();
});
it('keeps a blank summary blank and does not double escape summary text', async () => {
  for (const title of ['', 'A &amp; B &lt; C']) {
    const markdown = `<details open>\n<summary>${title}</summary>\n\nbody\n\n</details>\n`;
    const { editor } = await open(markdown);
    expect(editor.getMarkdown()).toBe(markdown);
  }
});
it('keeps nested disclosures and wikilinks in their bodies', async () => {
  const markdown = '<details open>\n<summary>Outer</summary>\n\n<details>\n<summary>Inner</summary>\n\n[[Target]]\n\n</details>\n\n</details>\n';
  const { root, editor } = await open(markdown);
  expect(root.querySelectorAll('details')).toHaveLength(2);
  expect(editor.getMarkdown()).toContain('[[Target]]');
  expect((await open(editor.getMarkdown())).root.querySelectorAll('details')).toHaveLength(2);
});
it('toggles repeatedly from its chevron and records the state in Markdown', async () => {
  const { root, editor } = await open('<details open>\n<summary>Title</summary>\n\nbody\n\n</details>\n');
  for (const expected of [false, true, false, true]) {
    root.querySelector('summary')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, clientX: 5 }));
    expect(root.querySelector('details')?.open).toBe(expected);
    expect(editor.getMarkdown().startsWith(expected ? '<details open>' : '<details>')).toBe(true);
  }
});
it('puts the caret in the visible callout body when focusing the document', async () => {
  const { editor, view } = await open('> [!NOTE]\n>\n> body\n');
  editor.focusStart();
  expect(view.state.selection.$from.parent.textContent).toBe('body');
  view.dispatch(view.state.tr.insertText('New '));
  expect(editor.getMarkdown()).toContain('New body');
  expect(editor.getMarkdown()).toContain('[!NOTE]');
});
it('starts a body when typing in an empty callout without changing its marker', async () => {
  const { editor, view, root } = await open('> [!NOTE]\n');
  editor.focusStart();
  const { from, to } = view.state.selection;
  expect(view.someProp('handleTextInput', handler => handler(view, from, to, 'Hello', () => view.state.tr.insertText('Hello', from, to)))).toBe(true);
  expect(root.querySelector('blockquote')?.getAttribute('data-callout')).toBe('note');
  expect(editor.getMarkdown()).toContain('[!NOTE]');
  expect(editor.getMarkdown()).toContain('Hello');
});
