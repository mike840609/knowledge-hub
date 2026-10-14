// @vitest-environment jsdom
import { editorViewCtx } from "@milkdown/kit/core";
import { afterEach, expect, it } from "vitest";
import { createMarkdownEditor, type MarkdownEditor } from "@/components/knowledge/editor/editor-core";
import { blockGutter } from "@/components/knowledge/editor/block-gutter";

const rect = (top: number, bottom: number) => ({ x: 20, y: top, left: 20, right: 600, top, bottom, width: 580, height: bottom - top, toJSON: () => ({}) }) as DOMRect;
// jsdom has no layout or native scrolling; an unowned drop has no hit target.
document.elementFromPoint = () => null;
window.scrollBy = () => {};
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => rect(0, 0);
const opened: MarkdownEditor[] = [];
afterEach(async () => { for (const editor of opened.splice(0)) await editor.destroy(); document.body.innerHTML = ""; });
async function open(reveal = true) {
  const root = document.body.appendChild(document.createElement('div'));
  const editor = await createMarkdownEditor({ root, markdown: 'First\n\nSecond\n\nThird', className: 'kh-editor', ariaLabel: 'Content', editable: true, onUserEdit: () => {}, onMarkdown: () => {}, allowImage: () => false, extraPlugins: [blockGutter()] });
  opened.push(editor);
  const view = editor.action(ctx => ctx.get(editorViewCtx));
  view.dom.getBoundingClientRect = () => rect(40, 300);
  [...view.dom.children].forEach((child, index) => { child.getBoundingClientRect = () => rect(40 + index * 60, 80 + index * 60); });
  view.focus();
  if (reveal) view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', altKey: true, bubbles: true, cancelable: true }));
  return { editor, view };
}
const button = (name: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!;
function drag(type: string, target: Element, y = 220, x = 150) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
  Object.defineProperty(event, 'dataTransfer', { value: { setData() {}, getData() { return ""; }, files: [], types: ["application/x-kh-editor-block"], setDragImage() {}, effectAllowed: '', dropEffect: '' } });
  target.dispatchEvent(event);
}

it('offers + for the focused block, inserts below, and does not put controls into Markdown', async () => {
  const { editor, view } = await open();
  expect(document.querySelector<HTMLElement>('.kh-block-gutter')!.hidden).toBe(false);
  button('Add paragraph below').click();
  expect(view.state.doc.child(1).textContent).toBe('');
  expect(view.state.selection.$from.index(0)).toBe(1);
  expect(editor.getMarkdown()).not.toMatch(/Add paragraph|Move block/);
});

it('offers bounded move actions and moves the selected block down', async () => {
  const { editor } = await open();
  button('Move block').click();
  const items = document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
  expect(items[0].disabled).toBe(true);
  expect(items[1].disabled).toBe(false);
  items[1].click();
  expect(editor.getMarkdown()).toMatch(/Second[\s\S]*First[\s\S]*Third/);
});

it('moves only on an in-editor drop and cancels when the document changes during a drag', async () => {
  const { editor, view } = await open();
  const original = editor.getMarkdown();
  drag('dragstart', button('Move block'));
  expect(view.dom.querySelector('.kh-block-drag-source')).not.toBeNull();
  drag('dragover', view.dom);
  expect(document.querySelector<HTMLElement>('.kh-block-drop-line')!.hidden).toBe(false);
  drag('drop', view.dom);
  expect(view.dom.querySelector('.kh-block-drag-source')).toBeNull();
  expect(editor.getMarkdown()).toMatch(/Second[\s\S]*Third[\s\S]*First/);
  editor.replaceMarkdown(original);
  editor.focusStart();
  drag('dragstart', button('Move block'));
  drag('dragover', view.dom);
  drag('drop', document.body, 220, 1000);
  expect(view.dom.querySelector('.kh-block-drag-source')).toBeNull();
  expect(editor.getMarkdown()).toBe(original);
  drag('dragstart', button('Move block'));
  drag('dragover', view.dom);
  editor.replaceMarkdown('Replacement');
  drag('drop', view.dom);
  expect(editor.getMarkdown()).toBe('Replacement\n');
});

it('hides controls when made read-only and removes all overlays on destruction', async () => {
  const { editor } = await open();
  editor.setEditable(false);
  expect(document.querySelector<HTMLElement>('.kh-block-gutter')!.hidden).toBe(true);
  const original = editor.getMarkdown();
  button('Add paragraph below').click();
  expect(editor.getMarkdown()).toBe(original);
  await editor.destroy(); opened.splice(opened.indexOf(editor), 1);
  expect(document.querySelector('.kh-block-gutter')).toBeNull();
  expect(document.querySelector('.kh-block-move-menu')).toBeNull();
  expect(document.querySelector('.kh-block-drop-line')).toBeNull();
});

it('reaches block actions directly by keyboard and returns to the editor with Escape', async () => {
  const { view } = await open();
  view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', altKey: true, bubbles: true, cancelable: true }));
  expect(document.activeElement).toBe(button('Add paragraph below'));
  button('Move block').focus();
  button('Move block').click();
  const down = document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')[1];
  expect(document.activeElement).toBe(down);
  down.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  expect(document.activeElement).toBe(button('Move block'));
  button('Move block').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  expect(document.activeElement).toBe(view.dom);
});

it('reveals controls only in the left gutter, not on focus, typing or prose hover', async () => {
  const { view } = await open(false);
  const toolbar = document.querySelector<HTMLElement>('.kh-block-gutter')!;
  expect(toolbar.hidden).toBe(true);
  const hover = async (x: number) => {
    view.dom.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: 60, bubbles: true }));
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  };
  await hover(200);
  expect(toolbar.hidden).toBe(true);
  await hover(25);
  expect(toolbar.hidden).toBe(false);
  await hover(200);
  expect(toolbar.hidden).toBe(true);
  view.dispatch(view.state.tr.insertText('Text'));
  expect(toolbar.hidden).toBe(true);
});
