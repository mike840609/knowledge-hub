// @vitest-environment jsdom
import { editorViewCtx } from "@milkdown/kit/core";
import { undo } from "@milkdown/kit/prose/history";
import { NodeSelection, TextSelection } from "@milkdown/kit/prose/state";
import { afterEach, expect, it, vi } from "vitest";
import { createMarkdownEditor, type MarkdownEditor } from "@/components/knowledge/editor/editor-core";
import { blockGutter, gutterFits } from "@/components/knowledge/editor/block-gutter";
import { slashCommands } from "@/components/knowledge/editor/slash-commands";

const rect = (top: number, bottom: number) => ({ x: 20, y: top, left: 20, right: 600, top, bottom, width: 580, height: bottom - top, toJSON: () => ({}) }) as DOMRect;
// jsdom has no layout or native scrolling; an unowned drop has no hit target.
document.elementFromPoint = () => null;
window.scrollBy = () => {};
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => rect(0, 0);
const opened: MarkdownEditor[] = [];
afterEach(async () => { for (const editor of opened.splice(0)) await editor.destroy(); document.body.innerHTML = ""; vi.unstubAllGlobals(); });
async function open(reveal = true, mount?: HTMLElement) {
  return openWith('First\n\nSecond\n\nThird', reveal, undefined, undefined, mount);
}
async function openWith(markdown: string, reveal = true, comment?: Parameters<typeof blockGutter>[0], linkTo?: () => string, mount = document.body) {
  const root = mount.appendChild(document.createElement('div'));
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

async function openWithList(markdown = 'First\n\nSecond', at?: string) {
  const root = document.body.appendChild(document.createElement('div'));
  const slash = slashCommands();
  const editor = await createMarkdownEditor({ root, markdown, className: 'kh-editor', ariaLabel: 'Content', editable: true, onUserEdit: () => {}, onMarkdown: () => {}, allowImage: () => false, extraPlugins: [...slash.plugins, blockGutter()], configure: slash.configure });
  opened.push(editor);
  const view = editor.action(ctx => ctx.get(editorViewCtx));
  view.dom.getBoundingClientRect = () => rect(40, 300);
  [...view.dom.children].forEach((child, index) => { child.getBoundingClientRect = () => rect(40 + index * 60, 80 + index * 60); });
  view.focus();
  if (at) caretAfter(view, at);
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

// List commands spec, decision 4: + on an item adds an empty item below and opens the "/" list on it, as on a paragraph.
it("plus on an item writes a slash", async () => {
  const { view, list } = await openWithList("- a\n- b\n- c\n", "b");
  const items = view.state.doc.firstChild!;
  expect(items.childCount).toBe(4);
  expect(items.child(2).textContent).toBe("/");
  expect(view.state.selection.$from.node(-1)).toBe(items.child(2));
  expect(list.hidden).toBe(false);
});

it("dismissing takes the slash back", async () => {
  const { editor, view, list, press } = await openWithList("- a\n- b\n- c\n", "b");
  press("Escape");
  expect(list.hidden).toBe(true);
  expect(view.state.doc.firstChild!.child(2).textContent).toBe("");
  expect(view.state.selection.$from.node(-1)).toBe(view.state.doc.firstChild!.child(2));
  // This editor writes an empty item as `- <br />`, the brief's `- `.
  expect(editor.getMarkdown()).toBe("- a\n- b\n- <br />\n- c\n");
});

it("plus on a task item", async () => {
  const { editor, list, press } = await openWithList("- [ ] a\n", "a");
  expect(list.hidden).toBe(false);
  press("Escape");
  // An empty to-do is written `- [ ] <br />`, the brief's `- [ ] `.
  expect(editor.getMarkdown()).toBe("- [ ] a\n- [ ] <br />\n");
});

it("choosing from plus turns the new item", async () => {
  const { editor, view, list, press } = await openWithList("- a\n- b\n- c\n", "b");
  view.dispatch(view.state.tr.insertText("quo"));
  press("Enter");
  expect(list.hidden).toBe(true);
  view.dispatch(view.state.tr.insertText("Q"));
  expect(editor.getMarkdown()).toBe("- a\n- b\n\n> Q\n\n- c\n");
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

// 2026-11-21 block-unit spec, decisions 5 and 6: the grip of a block inside the range acts on the range.
const shiftKey = (view: import("@milkdown/kit/prose/view").EditorView, key: string) => view.dom.dispatchEvent(new KeyboardEvent("keydown", { key, shiftKey: true, bubbles: true, cancelable: true }));
/** `Two`, `Three` chosen as a range whose anchor is `Three`, so the controls stand at `Three`. */
function rangeTwoThree(view: import("@milkdown/kit/prose/view").EditorView, index = 2) {
  let pos = 0;
  for (let at = 0; at < index; at++) pos += view.state.doc.child(at).nodeSize;
  view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
  shiftKey(view, "ArrowUp");
  expect([...view.dom.querySelectorAll(".kh-block-in-range")].length).toBe(2);
}
const live = () => [...document.querySelectorAll<HTMLElement>('[aria-live="polite"]')].map(region => region.textContent);
async function openRange() {
  const opened = await openWith("One\n\nTwo\n\nThree", false);
  rangeTwoThree(opened.view);
  reveal(opened.view);
  return opened;
}

it("Duplicate acts on the range", async () => {
  const { editor, view } = await openRange();
  button("Move block").click();
  menuItem("Duplicate").click();
  expect(editor.getMarkdown()).toBe("One\n\nTwo\n\nThree\n\nTwo\n\nThree\n");
  expect(live()).toContain("2 blocks duplicated");
  // The copies become the range.
  expect([...view.dom.querySelectorAll(".kh-block-in-range")].map(node => node.textContent)).toEqual(["Two", "Three"]);
  // In its direction: the copy of `Three`, the anchor, is the block chosen.
  expect(view.state.selection).toBeInstanceOf(NodeSelection);
  expect((view.state.selection as NodeSelection).node.textContent).toBe("Three");
  expect(view.state.selection.from).toBe([0, 1, 2, 3].reduce((size, at) => size + view.state.doc.child(at).nodeSize, 0));
});

it("the menu names the count", async () => {
  await openRange();
  button("Move block").click();
  expect(document.querySelector<HTMLElement>('[role="menu"]')!.getAttribute("aria-label")).toBe("Block actions, 2 blocks");
});

it("Delete, Move up, Turn into Heading 2 act on the range", async () => {
  const { editor, view } = await openRange();
  const original = editor.getMarkdown();
  const restore = () => { undo(view.state, view.dispatch); expect(editor.getMarkdown()).toBe(original); rangeTwoThree(view); };
  button("Move block").click();
  menuItem("Delete").click();
  expect(editor.getMarkdown()).toBe("One\n");
  expect(live()).toContain("2 blocks deleted");
  restore();
  button("Move block").click();
  menuItem("Move up").click();
  expect(editor.getMarkdown()).toBe("Two\n\nThree\n\nOne\n");
  expect(live()).toContain("2 blocks moved");
  expect([...view.dom.querySelectorAll(".kh-block-in-range")].map(node => node.textContent)).toEqual(["Two", "Three"]);
  restore();
  button("Move block").click();
  menuItem("Turn into").click();
  menuItem("Heading 2").click();
  expect(editor.getMarkdown()).toBe("One\n\n## Two\n\n## Three\n");
  expect(live()).toContain("2 blocks turned into heading 2");
  restore();
});

it("Turn into is disabled when one block cannot take it", async () => {
  const { view } = await openWith("| a | b |\n| --- | --- |\n| 1 | 2 |\n\nPara", false);
  // The anchor is the paragraph, which alone could become a toggle.
  rangeTwoThree(view, 1);
  reveal(view);
  button("Move block").click();
  menuItem("Turn into").click();
  expect(menuItem("Toggle").disabled).toBe(true);
});

it.each([
  ["a paragraph and a heading 2", "One\n\nPara\n\n## H\n", "Heading 2", false],
  ["two headings 2", "One\n\n## G\n\n## H\n", "Heading 2", true],
  ["a code block and a paragraph", "One\n\n```\ncode\n```\n\nPara\n", "Toggle", true],
  ["a code block and a paragraph", "One\n\n```\ncode\n```\n\nPara\n", "Text", false],
])("Turn into on %s: %s disabled is %s", async (_name, markdown, label, disabled) => {
  const { view } = await openWith(markdown, false);
  rangeTwoThree(view);
  reveal(view);
  button("Move block").click();
  menuItem("Turn into").click();
  expect(menuItem(label).disabled).toBe(disabled);
});

it("the range's menu entries and a range move do nothing once the editor is read-only", async () => {
  for (const label of ["Duplicate", "Delete", "Move up"]) {
    const { editor, view } = await openRange();
    const original = editor.getMarkdown();
    button("Move block").click();
    const item = menuItem(label);
    view.setProps({ editable: () => false });
    item.click();
    expect(editor.getMarkdown()).toBe(original);
    view.setProps({ editable: () => true });
  }
  const { editor, view } = await openRange();
  const original = editor.getMarkdown();
  button("Move block").click();
  menuItem("Turn into").click();
  const heading = menuItem("Heading 2");
  view.setProps({ editable: () => false });
  heading.click();
  expect(editor.getMarkdown()).toBe(original);
});

it.each([
  ["a quote", "> - a\n\nAfter\n", ">\n\nAfter\n"],
  ["a callout", "> [!NOTE]\n> - a\n\nAfter\n", null],
])("the grip's Delete on the last item of a list in %s writes no <br />", async (_name, markdown, expected) => {
  const { editor, view } = await openWith(markdown, false);
  caretAfter(view, "a");
  reveal(view);
  button("Move block").click();
  menuItem("Delete").click();
  expect(editor.getMarkdown()).not.toContain("<br");
  expect(editor.getMarkdown()).not.toContain("- a");
  if (expected) expect(editor.getMarkdown()).toBe(expected);
});

it("no Copy link to heading on a range", async () => {
  const { view } = await openWith("One\n\n## Two\n\n## Three", false);
  rangeTwoThree(view);
  reveal(view);
  button("Move block").click();
  expect(menuItem("Copy link to heading")).toBeUndefined();
  expect(menuItem("Duplicate")).toBeDefined();
});

it("opening the menu keeps the range", async () => {
  const { view } = await openRange();
  button("Move block").dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  button("Move block").click();
  expect(document.querySelector<HTMLElement>(".kh-block-move-menu")!.hidden).toBe(false);
  expect([...view.dom.querySelectorAll(".kh-block-in-range")].map(node => node.textContent)).toEqual(["Two", "Three"]);
});

it("the grip of a block outside the range ends it", async () => {
  const { editor, view } = await openRange();
  view.dom.dispatchEvent(new MouseEvent("mousemove", { clientX: 25, clientY: 60, bubbles: true }));
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  button("Move block").dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  expect(view.dom.querySelectorAll(".kh-block-in-range").length).toBe(0);
  button("Move block").click();
  expect(document.querySelector<HTMLElement>('[role="menu"]')!.getAttribute("aria-label")).toBe("Block actions");
  menuItem("Duplicate").click();
  expect(editor.getMarkdown()).toBe("One\n\nOne\n\nTwo\n\nThree\n");
});

it("dragging a grip inside the range moves the range", async () => {
  const { editor, view } = await openRange();
  drag("dragstart", button("Move block"));
  expect([...view.dom.querySelectorAll(".kh-block-drag-source")].map(node => node.textContent)).toEqual(["Two", "Three"]);
  drag("dragover", view.dom, 50);
  drag("drop", view.dom, 50);
  expect(editor.getMarkdown()).toBe("Two\n\nThree\n\nOne\n");
  expect(view.dom.querySelector(".kh-block-drag-source")).toBeNull();
  expect(live()).toContain("2 blocks moved");
});

// Controller ruling: the menu and a single block's drag move by the sequence rule, as the keys do.
it("Move down on a paragraph above a list passes one item, not the whole list", async () => {
  const { editor, view } = await openWith("Para\n\n- a\n- b\n", false);
  caretAfter(view, "Para");
  reveal(view);
  button("Move block").click();
  menuItem("Move down").click();
  expect(editor.getMarkdown()).toBe("- a\n\nPara\n\n- b\n");
});

it("Move down on a list's last item takes it out of the list", async () => {
  const { editor, view } = await openWith("- a\n- b\n\nPara\n", false);
  caretAfter(view, "b");
  reveal(view);
  button("Move block").click();
  expect(menuItem("Move down").disabled).toBe(false);
  menuItem("Move down").click();
  expect(editor.getMarkdown()).toBe("- a\n\nPara\n\n- b\n");
});

// Block-unit spec decision 7: the pointer anywhere on a block's line shows its controls.
const wideEditorRect = () => ({ ...rect(40, 300), left: 100, x: 100, width: 500 });
const narrowEditorRect = () => ({ ...rect(40, 300), right: 420, width: 400 });
async function openWide(mount?: HTMLElement) {
  const opened = await open(false, mount);
  // Room for a gutter left of the text: the editor starts 100px in.
  opened.view.dom.getBoundingClientRect = wideEditorRect;
  return opened;
}
const move = async (view: import("@milkdown/kit/prose/view").EditorView, x: number, y = 60) => {
  view.dom.dispatchEvent(new MouseEvent("mousemove", { clientX: x, clientY: y, bubbles: true }));
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
};
const gutterToolbar = () => document.querySelector<HTMLElement>(".kh-block-gutter")!;

function observeEditorResize() {
  let notify: ResizeObserverCallback | undefined;
  const observed = new Set<Element>();
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: ResizeObserverCallback) { notify = callback; }
    observe(target: Element) { observed.add(target); }
    unobserve(target: Element) { observed.delete(target); }
    disconnect() { observed.clear(); }
  });
  return (target: Element) => { if (observed.has(target)) notify?.([], {} as ResizeObserver); };
}

it("pointer over the text shows the controls", async () => {
  const { view } = await openWide();
  await move(view, 300, 130);
  expect(gutterToolbar().hidden).toBe(false);
  expect(gutterToolbar().style.top).toBe("100px");
});

it("typing hides them until the pointer moves", async () => {
  const { view } = await openWide();
  await move(view, 300);
  expect(gutterToolbar().hidden).toBe(false);
  view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
  expect(gutterToolbar().hidden).toBe(true);
  await move(view, 300);
  expect(gutterToolbar().hidden).toBe(true);
  await move(view, 310);
  expect(gutterToolbar().hidden).toBe(false);
});

it("a pure modifier key does not hide them", async () => {
  const { view } = await openWide();
  await move(view, 300);
  view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: "Shift", bubbles: true }));
  expect(gutterToolbar().hidden).toBe(false);
});

it("a held mouse button keeps them hidden", async () => {
  const { view } = await openWide();
  await move(view, 300);
  view.dom.dispatchEvent(new MouseEvent("mousedown", { clientX: 300, clientY: 60, bubbles: true }));
  expect(gutterToolbar().hidden).toBe(true);
  await move(view, 320);
  expect(gutterToolbar().hidden).toBe(true);
  document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  await move(view, 330);
  expect(gutterToolbar().hidden).toBe(false);
});

it("a text drag that ends without a mouseup does not keep them hidden", async () => {
  const { view } = await openWide();
  await move(view, 300);
  view.dom.dispatchEvent(new MouseEvent("mousedown", { clientX: 300, clientY: 60, bubbles: true }));
  expect(gutterToolbar().hidden).toBe(true);
  // A native drag of selected text: the browser sends dragend, never mouseup.
  view.dom.dispatchEvent(new Event("dragend", { bubbles: true }));
  await move(view, 330);
  expect(gutterToolbar().hidden).toBe(false);
});

it("re-measures the gutter's room when the pane's box changes, without a window event", async () => {
  const { view } = await openWide();
  await move(view, 300);
  expect(gutterToolbar().hidden).toBe(false);
  // The reading column narrows for a layout reason (an inspector opens): no resize or scroll reaches the window.
  view.dom.getBoundingClientRect = narrowEditorRect;
  await move(view, 310);
  expect(gutterToolbar().hidden).toBe(true);
  // Widened again: the text trigger comes back after the next move.
  view.dom.getBoundingClientRect = wideEditorRect;
  await move(view, 330);
  expect(gutterToolbar().hidden).toBe(false);
});

it("hides the controls when the pane changes size while the pointer stands still", async () => {
  const notify = observeEditorResize();
  const { view } = await openWide();
  await move(view, 300);
  expect(gutterToolbar().hidden).toBe(false);
  // The first delivery and a height-only change leave the hover trigger valid.
  notify(view.dom);
  expect(gutterToolbar().hidden).toBe(false);
  const before = view.dom.getBoundingClientRect();
  view.dom.getBoundingClientRect = () => ({ ...before, bottom: 400, height: 360 });
  notify(view.dom);
  expect(gutterToolbar().hidden).toBe(false);
  view.dom.getBoundingClientRect = narrowEditorRect;
  notify(view.dom);
  expect(gutterToolbar().hidden).toBe(true);
});

it("hides hover controls when the document pane shrinks before the capped editor moves", async () => {
  const notify = observeEditorResize();
  const pane = document.body.appendChild(document.createElement("div"));
  pane.className = "kh-document-pane";
  pane.getBoundingClientRect = () => ({ ...rect(0, 900), left: 0, x: 0, right: 1000, width: 1000 });
  const { view } = await openWide(pane);
  await move(view, 300);
  expect(gutterToolbar().hidden).toBe(false);
  pane.getBoundingClientRect = () => ({ ...rect(0, 900), left: 0, x: 0, right: 680, width: 680 });
  notify(pane);
  expect(gutterToolbar().hidden).toBe(true);
});

it("repositions focused keyboard controls and keeps the block menu open across a resize", async () => {
  const notify = observeEditorResize();
  const { view } = await openWide();
  reveal(view);
  const add = button("Add block below");
  expect(document.activeElement).toBe(add);
  view.dom.getBoundingClientRect = narrowEditorRect;
  notify(view.dom);
  expect(gutterToolbar().hidden).toBe(false);
  expect(document.activeElement).toBe(add);
  expect(gutterToolbar().style.left).toBe("24px");
  const grip = button("Move block");
  grip.click();
  const first = menuItem("Turn into");
  expect(document.activeElement).toBe(first);
  view.dom.getBoundingClientRect = wideEditorRect;
  notify(view.dom);
  expect(grip.getAttribute("aria-expanded")).toBe("true");
  expect(document.activeElement).toBe(first);
  expect(gutterToolbar().style.left).toBe("104px");
});

it("repositions touch controls while focus stays in the editor during a resize", async () => {
  const notify = observeEditorResize();
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(hover: none) and (pointer: coarse)" }));
  const { view } = await open(false);
  expect(gutterToolbar().hidden).toBe(false);
  expect(document.activeElement).toBe(view.dom);
  view.dom.getBoundingClientRect = () => ({ ...narrowEditorRect(), left: 30, x: 30, width: 390 });
  notify(view.dom);
  expect(gutterToolbar().hidden).toBe(false);
  expect(gutterToolbar().style.left).toBe("34px");
});

it("repositions focused controls when the reading column finishes sliding without a resize", async () => {
  const column = document.body.appendChild(document.createElement("div"));
  column.className = "kh-reading-column";
  const { view } = await openWide(column);
  reveal(view);
  const add = button("Add block below");
  expect(gutterToolbar().style.left).toBe("104px");
  view.dom.getBoundingClientRect = () => ({ ...wideEditorRect(), left: 80, x: 80, right: 580 });
  const finished = new Event("transitionend", { bubbles: true });
  Object.defineProperty(finished, "propertyName", { value: "margin-left" });
  column.dispatchEvent(finished);
  expect(gutterToolbar().style.left).toBe("84px");
  expect(document.activeElement).toBe(add);
});

it("a narrow gutter keeps the gutter-only trigger", async () => {
  const { view } = await open(false);
  expect(gutterFits(view.dom)).toBe(false);
  await move(view, 200);
  expect(gutterToolbar().hidden).toBe(true);
  await move(view, 25);
  expect(gutterToolbar().hidden).toBe(false);
});

it("gutterFits measures against the nearest clipping ancestor", async () => {
  const { view } = await openWide();
  expect(gutterFits(view.dom)).toBe(true);
  const clip = document.body.appendChild(document.createElement("div"));
  clip.style.overflowX = "auto";
  clip.appendChild(view.dom.parentElement!);
  clip.getBoundingClientRect = () => ({ ...rect(0, 900), left: 80, x: 80 });
  expect(gutterFits(view.dom)).toBe(false);
  clip.getBoundingClientRect = () => ({ ...rect(0, 900), left: 40, x: 40 });
  expect(gutterFits(view.dom)).toBe(true);
});

it.each([
  ["a flat list, one item", "- A\n- B\n- C\n", false, "- A\n- C\n"],
  ["a flat list, a range", "- A\n- B\n- C\n", true, "- A\n"],
  ["a nested list, one item", "- Outer\n  - A\n  - B\n  - C\n", false, "- Outer\n  - A\n  - C\n"],
  ["a nested list, a range", "- Outer\n  - A\n  - B\n  - C\n", true, "- Outer\n  - A\n"],
] as const)("Alt+F10 targets the chosen item or range in %s (range %s)", async (_name, markdown, range, remaining) => {
  const { editor, view } = await openWith(markdown, false);
  caretAfter(view, "B");
  view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  if (range) shiftKey(view, "ArrowDown");
  reveal(view);
  expect(document.activeElement).toBe(button("Add block below"));
  button("Move block").focus();
  button("Move block").click();
  expect(document.querySelector('[role="menu"]')?.getAttribute("aria-label")).toBe(range ? "Block actions, 2 blocks" : "Block actions");
  menuItem("Delete").click();
  expect(editor.getMarkdown()).toBe(remaining);
  expect(undo(view.state, view.dispatch)).toBe(true);
  expect(editor.getMarkdown()).toBe(markdown);
});

it("marks the current kind aria-current in the grip's Turn into for a single block, and disables it", async () => {
  const { view } = await openWith("- First\n- Second\n", false);
  caretAfter(view, "Second");
  reveal(view);
  button("Move block").click();
  menuItem("Turn into").click();
  const current = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"][aria-current="true"]')];
  expect(current.map((item) => item.textContent)).toEqual(["Bulleted list"]);
  expect(current[0].disabled).toBe(true);
  expect(menuItem("Numbered list").disabled).toBe(false);
});

// List commands spec, decision 4, the cases Task 2 left untested: a nested item, an item with children, and leaving
// the line without choosing.
it("plus on a nested item adds an empty sibling in the nested list, with the / list open on it", async () => {
  const { editor, view, list, press } = await openWithList("- a\n  - b\n  - c\n- d\n", "b");
  const nested = view.state.doc.firstChild!.child(0).child(1);
  expect(nested.childCount).toBe(3);
  expect(nested.child(1).textContent).toBe("/");
  expect(view.state.selection.$from.node(-1)).toBe(nested.child(1));
  expect(list.hidden).toBe(false);
  press("Escape");
  expect(editor.getMarkdown()).toBe("- a\n  - b\n  - <br />\n  - c\n- d\n");
});

it("plus on an item with children adds the new item after the item and its nested list", async () => {
  const { editor, view, list, press } = await openWithList("- a\n  - b\n- c\n", "a");
  const items = view.state.doc.firstChild!;
  expect(items.childCount).toBe(3);
  expect(items.child(0).childCount).toBe(2);
  expect(items.child(1).textContent).toBe("/");
  expect(list.hidden).toBe(false);
  view.dispatch(view.state.tr.insertText("h2"));
  press("Enter");
  view.dispatch(view.state.tr.insertText("H"));
  expect(editor.getMarkdown()).toBe("- a\n  - b\n\n## H\n\n- c\n");
});

it("clicking away after plus on an item takes the lone / back and leaves the empty item", async () => {
  const { editor, view, list } = await openWithList("- a\n- b\n", "a");
  expect(list.hidden).toBe(false);
  view.dom.blur();
  view.dom.dispatchEvent(new FocusEvent("blur"));
  expect(list.hidden).toBe(true);
  expect(view.state.doc.firstChild!.child(1).textContent).toBe("");
  expect(editor.getMarkdown()).toBe("- a\n- <br />\n- b\n");
});

it("moving the caret out after plus on an item takes the lone / back too", async () => {
  const { editor, view, list } = await openWithList("- a\n- b\n", "a");
  caretAfter(view, "b");
  expect(list.hidden).toBe(true);
  expect(editor.getMarkdown()).toBe("- a\n- <br />\n- b\n");
});
