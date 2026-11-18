// @vitest-environment jsdom
import { editorViewCtx } from "@milkdown/kit/core";
import { TextSelection } from "@milkdown/kit/prose/state";
import { afterEach, expect, it, vi } from "vitest";
import { createMarkdownEditor, type MarkdownEditor } from "@/components/knowledge/editor/editor-core";
import { blockGutter } from "@/components/knowledge/editor/block-gutter";
import { slashCommands } from "@/components/knowledge/editor/slash-commands";

const rect = (top: number, bottom: number) => ({ x: 20, y: top, left: 20, right: 600, top, bottom, width: 580, height: bottom - top, toJSON: () => ({}) }) as DOMRect;
// jsdom has no layout or native scrolling; an unowned drop has no hit target.
document.elementFromPoint = () => null;
window.scrollBy = () => {};
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => rect(0, 0);
const opened: MarkdownEditor[] = [];
afterEach(async () => { for (const editor of opened.splice(0)) await editor.destroy(); document.body.innerHTML = ""; });
async function open(reveal = true) {
  return openWith('First\n\nSecond\n\nThird', reveal);
}
async function openWith(markdown: string, reveal = true, comment?: Parameters<typeof blockGutter>[0], linkTo?: () => string) {
  const root = document.body.appendChild(document.createElement('div'));
  const editor = await createMarkdownEditor({ root, markdown, className: 'kh-editor', ariaLabel: 'Content', editable: true, onUserEdit: () => {}, onMarkdown: () => {}, allowImage: () => false, extraPlugins: [blockGutter(comment, linkTo)] });
  opened.push(editor);
  const view = editor.action(ctx => ctx.get(editorViewCtx));
  view.dom.getBoundingClientRect = () => rect(40, 300);
  [...view.dom.children].forEach((child, index) => { child.getBoundingClientRect = () => rect(40 + index * 60, 80 + index * 60); });
  view.focus();
  if (reveal) view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', altKey: true, bubbles: true, cancelable: true }));
  return { editor, view };
}
const caretAfter = (view: import("@milkdown/kit/prose/view").EditorView, text: string) => {
  let found = -1;
  view.state.doc.descendants((node, pos) => {
    if (node.isText && node.text!.includes(text)) found = pos + node.text!.indexOf(text) + text.length;
  });
  expect(found).toBeGreaterThanOrEqual(0);
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, found)));
};
const button = (name: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!;
function drag(type: string, target: Element, y = 220, x = 150) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
  Object.defineProperty(event, 'dataTransfer', { value: { setData() {}, getData() { return ""; }, files: [], types: ["application/x-kh-editor-block"], setDragImage() {}, effectAllowed: '', dropEffect: '' } });
  target.dispatchEvent(event);
}

it('offers + for the focused block, inserts below, and does not put controls into Markdown', async () => {
  const { editor, view } = await open();
  expect(document.querySelector<HTMLElement>('.kh-block-gutter')!.hidden).toBe(false);
  button('Add block below').click();
  expect(view.state.doc.child(1).textContent).toBe('');
  expect(view.state.selection.$from.index(0)).toBe(1);
  expect(editor.getMarkdown()).not.toMatch(/Add paragraph|Move block/);
});

it('offers bounded move actions and moves the selected block down', async () => {
  const { editor } = await open();
  button('Move block').click();
  const items = document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
  expect([...items].map((item) => item.textContent)).toEqual(['Turn into', 'Duplicate', 'Delete', 'Move up', 'Move down']);
  const up = [...items].find((item) => item.textContent === 'Move up')!;
  const down = [...items].find((item) => item.textContent === 'Move down')!;
  expect(up.disabled).toBe(true);
  expect(down.disabled).toBe(false);
  down.click();
  expect(editor.getMarkdown()).toMatch(/Second[\s\S]*First[\s\S]*Third/);
});

it('offers Comment for the current block without a text selection when review is available', async () => {
  let available = false;
  const run = vi.fn();
  const { view } = await openWith('First\n\nSecond', true, { available: () => available, run });
  button('Move block').click();
  expect(menuItem('Comment')).toBeUndefined();
  button('Move block').click();
  available = true;
  button('Move block').click();
  expect(view.state.selection.empty).toBe(true);
  menuItem('Comment')!.click();
  expect(run).toHaveBeenCalledWith(view, 0);
  expect(document.querySelector<HTMLElement>('.kh-block-move-menu')!.hidden).toBe(true);
});

it('turns a block into a heading from the gutter menu', async () => {
  const { editor } = await open();
  button('Move block').click();
  const turn = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((item) => item.textContent === 'Turn into')!;
  turn.click();
  expect(document.querySelector<HTMLElement>('[role="menu"]')!.getAttribute('aria-label')).toBe('Turn block into');
  const heading = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((item) => item.textContent === 'Heading 2')!;
  expect(heading.disabled).toBe(false);
  heading.click();
  expect(editor.getMarkdown()).toMatch(/^## First/m);
});

it('duplicates and deletes a block from the gutter menu', async () => {
  const { editor } = await open();
  button('Move block').click();
  const duplicate = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((item) => item.textContent === 'Duplicate')!;
  duplicate.click();
  expect(editor.getMarkdown()).toMatch(/First\n\nFirst\n\nSecond/);
  button('Move block').click();
  const remove = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((item) => item.textContent === 'Delete')!;
  remove.click();
  expect(editor.getMarkdown()).toMatch(/^First\n\nSecond/m);
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
  button('Add block below').click();
  expect(editor.getMarkdown()).toBe(original);
  await editor.destroy(); opened.splice(opened.indexOf(editor), 1);
  expect(document.querySelector('.kh-block-gutter')).toBeNull();
  expect(document.querySelector('.kh-block-move-menu')).toBeNull();
  expect(document.querySelector('.kh-block-drop-line')).toBeNull();
});

it('reaches block actions directly by keyboard and returns to the editor with Escape', async () => {
  const { view } = await open();
  view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', altKey: true, bubbles: true, cancelable: true }));
  expect(document.activeElement).toBe(button('Add block below'));
  button('Move block').focus();
  button('Move block').click();
  const turn = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((item) => item.textContent === 'Turn into')!;
  expect(document.activeElement).toBe(turn);
  // Escape in the submenu comes back to the block menu, not all the way out.
  turn.click();
  const back = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((item) => item.textContent === 'Back')!;
  expect(document.activeElement).toBe(back);
  back.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  expect(document.activeElement?.textContent).toBe('Turn into');
  document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  expect(document.activeElement).toBe(button('Move block'));
  expect(document.querySelector<HTMLElement>('.kh-block-move-menu')!.hidden).toBe(true);
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

it('keeps the controls inside the pane when the gutter hangs past its left edge', async () => {
  const pane = document.body.appendChild(document.createElement('div'));
  pane.className = 'kh-document-pane';
  pane.getBoundingClientRect = () => ({ ...rect(0, 900), left: 100, x: 100 });
  const root = pane.appendChild(document.createElement('div'));
  const editor = await createMarkdownEditor({ root, markdown: 'First', className: 'kh-editor', ariaLabel: 'Content', editable: true, onUserEdit: () => {}, onMarkdown: () => {}, allowImage: () => false, extraPlugins: [blockGutter()] });
  opened.push(editor);
  const view = editor.action(ctx => ctx.get(editorViewCtx));
  // The text starts 24px inside the pane; the 56px gutter begins 32px before the pane does.
  view.dom.getBoundingClientRect = () => ({ ...rect(40, 300), left: 68, x: 68 });
  (view.dom.firstElementChild as HTMLElement).getBoundingClientRect = () => rect(40, 80);
  view.focus();
  view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', altKey: true, bubbles: true, cancelable: true }));
  expect(document.querySelector<HTMLElement>('.kh-block-gutter')!.style.left).toBe('104px');
});

async function openWithList() {
  const root = document.body.appendChild(document.createElement('div'));
  const slash = slashCommands();
  const editor = await createMarkdownEditor({ root, markdown: 'First\n\nSecond', className: 'kh-editor', ariaLabel: 'Content', editable: true, onUserEdit: () => {}, onMarkdown: () => {}, allowImage: () => false, extraPlugins: [...slash.plugins, blockGutter()], configure: slash.configure });
  opened.push(editor);
  const view = editor.action(ctx => ctx.get(editorViewCtx));
  view.dom.getBoundingClientRect = () => rect(40, 300);
  [...view.dom.children].forEach((child, index) => { child.getBoundingClientRect = () => rect(40 + index * 60, 80 + index * 60); });
  view.focus();
  view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', altKey: true, bubbles: true, cancelable: true }));
  button('Add block below').click();
  const list = document.querySelector<HTMLElement>('.kh-slash-menu')!;
  const press = (name: string) => view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
  return { editor, view, list, press };
}

// Decision 15 (deviation): + writes a visible "/" on the new line; the list it opens is a typed "/"'s.
it('+ opens the "/" list on a new line holding a "/", and Escape takes back the lone "/" leaving the caret there', async () => {
  const { editor, view, list, press } = await openWithList();
  expect(list.hidden).toBe(false);
  expect(view.state.doc.child(1).textContent).toBe('/');
  press('Escape');
  expect(list.hidden).toBe(true);
  expect(view.state.doc.childCount).toBe(3);
  expect(view.state.selection.$from.index(0)).toBe(1);
  expect(view.state.doc.child(1).textContent).toBe('');
  expect(editor.getMarkdown()).not.toMatch(/^\/|\n\/\n/);
});

it('+ then "Title" keeps "Title" in sight as the "/Title" query, and Escape keeps it as text', async () => {
  const { editor, view, list, press } = await openWithList();
  view.dispatch(view.state.tr.insertText('Title'));
  // The query is on the page, as a typed "/Title" is: what Enter would pick is in the list beside it.
  expect(view.dom.children[1].textContent).toBe('/Title');
  expect(list.hidden).toBe(false);
  expect([...list.querySelectorAll('[role="option"]')].map(row => row.textContent)).toEqual(['Heading 1Large heading', 'Heading 2Section heading', 'Heading 3Small heading']);
  press('Escape');
  expect(list.hidden).toBe(true);
  expect(view.state.doc.child(1).textContent).toBe('/Title');
  expect(editor.getMarkdown()).toBe('First\n\n/Title\n\nSecond\n');
});

it('+ then "h2" and Enter makes a Heading 2', async () => {
  const { editor, view, list, press } = await openWithList();
  view.dispatch(view.state.tr.insertText('h2'));
  press('Enter');
  expect(list.hidden).toBe(true);
  expect(view.state.doc.child(1).type.name).toBe('heading');
  expect(view.state.doc.child(1).attrs.level).toBe(2);
  view.dispatch(view.state.tr.insertText('Picked'));
  expect(editor.getMarkdown()).toBe('First\n\n## Picked\n\nSecond\n');
});

// Launcher audit: every block action went through `topLevelBlocks`, so on a list item the
// Duplicate/Delete/Turn into/Move actions and Cmd+D all acted on the whole list. Notion gives each
// item its own handle. These actions now resolve the nearest list item under the caret.
const menuItem = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(item => item.textContent === label)!;
const reveal = (view: import("@milkdown/kit/prose/view").EditorView) => view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: "F10", altKey: true, bubbles: true, cancelable: true }));

it("duplicates the list item under the caret, not the list around it", async () => {
  const { editor, view } = await openWith("- First\n- Second\n- Third\n", false);
  caretAfter(view, "Second");
  reveal(view);
  button("Move block").click();
  menuItem("Duplicate").click();
  const lines = editor.getMarkdown().trim().split("\n").filter(Boolean);
  expect(lines).toEqual(["- First", "- Second", "- Second", "- Third"]);
});

it("deletes the list item under the caret and keeps the rest of the list", async () => {
  const { editor, view } = await openWith("- First\n- Second\n- Third\n", false);
  caretAfter(view, "Second");
  reveal(view);
  button("Move block").click();
  menuItem("Delete").click();
  expect(editor.getMarkdown().trim()).toBe("- First\n- Third");
});

it("moves the list item up among its siblings", async () => {
  const { editor, view } = await openWith("- First\n- Second\n- Third\n", false);
  caretAfter(view, "Third");
  reveal(view);
  button("Move block").click();
  menuItem("Move up").click();
  expect(editor.getMarkdown().trim()).toBe("- First\n- Third\n- Second");
});

it.each([
  ["First\n\nSecond", "First", "p"],
  ["- First\n- Second", "First", "li"],
  ["- [x] First\n- [ ] Second", "First", "li"],
  ["```js\nFirst\n```\n\nSecond", "First", "pre"],
])("copies a persistent block link, keeping its target across a move and round trip in %s", async (markdown, text, tagName) => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  try {
    const { editor, view } = await openWith(markdown, false, undefined, () => "/w/workspace/knowledge/source/note");
    caretAfter(view, text);
    reveal(view);
    button("Move block").click();
    menuItem("Copy link to block").click();
    const href = new URL(writeText.mock.lastCall?.[0]);
    expect(href.pathname).toBe("/w/workspace/knowledge/source/note");
    expect(href.hash).toMatch(/^#kh-block-[0-9a-f-]{36}$/);
    const id = href.hash.slice(1);
    expect(view.dom.querySelector(`${tagName}[id="${id}"]`)?.textContent).toBe(text);
    reveal(view);
    button("Move block").click();
    menuItem("Move down").click();
    const moved = editor.getMarkdown();
    expect(moved.indexOf("Second")).toBeLessThan(moved.indexOf(text));
    expect(moved).toContain(id);
    const reopened = await openWith(moved, false);
    expect(reopened.view.dom.querySelector(`${tagName}[id="${id}"]`)?.textContent).toBe(text);
    expect(reopened.editor.getMarkdown()).toBe(moved);
    caretAfter(reopened.view, text);
    reveal(reopened.view);
    button("Move block").click();
    menuItem("Duplicate").click();
    expect(reopened.editor.getMarkdown().split(id)).toHaveLength(2);
  } finally {
    if (originalClipboard) Object.defineProperty(navigator, "clipboard", originalClipboard);
    else Reflect.deleteProperty(navigator, "clipboard");
  }
});

it("turns one list item into a heading, splitting the list around it", async () => {
  const { editor, view } = await openWith("- First\n- Second\n- Third\n", false);
  caretAfter(view, "Second");
  reveal(view);
  button("Move block").click();
  menuItem("Turn into").click();
  menuItem("Heading 2").click();
  const markdown = editor.getMarkdown();
  expect(markdown).toMatch(/## Second/);
  expect(markdown).toMatch(/- First/);
  expect(markdown).toMatch(/- Third/);
  expect(markdown).not.toMatch(/## First|## Third/);
});

it("inserts a new sibling item below a list item", async () => {
  const { editor, view } = await openWith("- First\n- Second\n", false);
  caretAfter(view, "First");
  reveal(view);
  button("Add block below").click();
  const list = view.state.doc.firstChild!;
  expect(list.childCount).toBe(3);
  expect(list.child(1).textContent).toBe("");
  expect(editor.getMarkdown()).toMatch(/- First/);
  expect(editor.getMarkdown()).toMatch(/- Second/);
});

// Launcher audit: the block menu's Turn into offered no Toggle and no Callout, so a paragraph had
// to be re-created from `/` to change its type.
it("turns a paragraph into a toggle, keeping its text as the summary", async () => {
  const { editor, view } = await openWith("Body text", false);
  caretAfter(view, "Body text");
  reveal(view);
  button("Move block").click();
  menuItem("Turn into").click();
  menuItem("Toggle").click();
  expect(editor.getMarkdown()).toMatch(/<summary>Body text<\/summary>/);
});

it("turns a paragraph into a callout", async () => {
  const { editor, view } = await openWith("Body text", false);
  caretAfter(view, "Body text");
  reveal(view);
  button("Move block").click();
  menuItem("Turn into").click();
  menuItem("Callout").click();
  // The editor writes the marker escaped (as `> \[!NOTE]`); the reader recognises both.
  expect(editor.getMarkdown()).toContain("[!NOTE]");
  expect(editor.getMarkdown()).toMatch(/Body text/);
});

it("keeps an item's nested list when the item becomes another list kind", async () => {
  const { editor, view } = await openWith("- a\n  - b\n- c\n", false);
  caretAfter(view, "a");
  reveal(view);
  button("Move block").click();
  menuItem("Turn into").click();
  menuItem("Numbered list").click();
  const markdown = editor.getMarkdown();
  expect(markdown).toMatch(/1\. a/);
  expect(markdown).toMatch(/^\s+- b/m);
  expect(markdown).toMatch(/^- c/m);
});

// The toggle summary is plain text (details_summary accepts text only). A wikilink there would
// keep its words and lose its edge (review, 2026-11-17), so Toggle is offered only for plain text;
// the callout body keeps its inline marks.
it("offers Toggle only for plain words, never a wikilink it would unlink", async () => {
  const markdown = "See [[Target]] and **bold**";
  const first = await openWith(markdown, false);
  caretAfter(first.view, "bold");
  reveal(first.view);
  button("Move block").click();
  menuItem("Turn into").click();
  expect(menuItem("Toggle").disabled).toBe(true);
  menuItem("Toggle").click();
  expect(first.editor.getMarkdown()).toBe(`${markdown}\n`);
});

it("keeps a paragraph's marks and wikilinks when it becomes a callout", async () => {
  const markdown = "See [[Target]] and **bold**";
  const second = await openWith(markdown, false);
  caretAfter(second.view, "bold");
  reveal(second.view);
  button("Move block").click();
  menuItem("Turn into").click();
  menuItem("Callout").click();
  expect(second.editor.getMarkdown()).toContain("[[Target]]");
  expect(second.editor.getMarkdown()).toContain("**bold**");
});

it("acts on a nested list item, not on its parent item", async () => {
  const { editor, view } = await openWith("- a\n  - b\n  - c\n", false);
  caretAfter(view, "c");
  reveal(view);
  button("Move block").click();
  menuItem("Delete").click();
  const markdown = editor.getMarkdown();
  expect(markdown).toMatch(/^\s+- b/m);
  expect(markdown).not.toMatch(/^\s+- c/m);
  expect(markdown).toMatch(/^- a/m);
});

it("splits an ordered list around the item and keeps the numbers after it", async () => {
  const { editor, view } = await openWith("1. a\n2. b\n3. c\n", false);
  caretAfter(view, "b");
  reveal(view);
  button("Move block").click();
  menuItem("Turn into").click();
  menuItem("Heading 2").click();
  const markdown = editor.getMarkdown();
  expect(markdown).toMatch(/1\. a/);
  expect(markdown).toMatch(/## b/);
  expect(markdown).toMatch(/3\. c/);
});

it("keeps a wikilink's written form when a paragraph becomes code", async () => {
  const markdown = "See [[Target]] now";
  const { editor, view } = await openWith(markdown, false);
  caretAfter(view, "now");
  reveal(view);
  button("Move block").click();
  menuItem("Turn into").click();
  menuItem("Code").click();
  expect(editor.getMarkdown()).toContain("[[Target]]");
});

it("joins the lines of a paragraph with a space when it becomes a toggle", async () => {
  const { editor, view } = await openWith("First line  \nsecond line", false);
  caretAfter(view, "second line");
  reveal(view);
  button("Move block").click();
  menuItem("Turn into").click();
  menuItem("Toggle").click();
  expect(editor.getMarkdown()).toContain("<summary>First line second line</summary>");
});

// Review (2026-11-17): deleting a list's only item left an empty paragraph, saved as `<br />`.
it("removes the whole list when its only item is deleted among other blocks", async () => {
  const { editor, view } = await openWith("Before\n\n- only\n\nAfter\n", false);
  caretAfter(view, "only");
  reveal(view);
  button("Move block").click();
  menuItem("Delete").click();
  expect(editor.getMarkdown().trim()).toBe("Before\n\nAfter");
});
