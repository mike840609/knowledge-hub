// @vitest-environment jsdom
import { editorViewCtx } from "@milkdown/kit/core";
import { TextSelection } from "@milkdown/kit/prose/state";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMarkdownEditor, type MarkdownEditor } from "@/components/knowledge/editor/editor-core";
import { RenderedEditor, type RenderedEditorProps } from "@/components/knowledge/editor/rendered-editor";
import { selectionToolbar } from "@/components/knowledge/editor/selection-toolbar";

// Layout (floating-ui positioning, where the toolbar lands) is not something jsdom has, so
// nothing here asserts a position; the browser run in Task 3 covers that. These pin the DOM
// contract: button types, key routing, the link address, the blur rule, the pressed state.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has no layout, and its Range lacks the two geometry methods that ProseMirror's
// scroll-into-view and the tooltip's positioning call. Zero-sized answers are enough here.
const noRect = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) } as DOMRect;
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => noRect;

const opened: MarkdownEditor[] = [];
const mounted: Root[] = [];
afterEach(async () => {
  for (const root of mounted.splice(0)) act(() => root.unmount());
  while (opened.length) await opened.pop()!.destroy();
  document.body.innerHTML = "";
});

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
// The tooltip provider is throttled at 200ms; a selection made after the first update shows after it.
const throttleWindow = () => wait(260);

async function open(markdown: string, editable = true): Promise<MarkdownEditor> {
  const root = document.createElement("div");
  document.body.appendChild(root);
  const toolbar = selectionToolbar();
  const editor = await createMarkdownEditor({
    root,
    markdown,
    className: "kh-editor",
    ariaLabel: "Content",
    editable,
    onUserEdit: () => {},
    onMarkdown: () => {},
    allowImage: () => false,
    extraPlugins: toolbar.plugins,
    configure: toolbar.configure,
  });
  opened.push(editor);
  return editor;
}

/** Focus the editor and select [from, to): the state in which the toolbar is meant to show. */
function select(editor: MarkdownEditor, from: number, to: number) {
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    view.dom.focus();
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)));
  });
}
function editorDom(editor: MarkdownEditor): HTMLElement {
  return editor.action((ctx) => ctx.get(editorViewCtx).dom as HTMLElement);
}

function toolbarElement(): HTMLElement {
  const element = document.querySelector<HTMLElement>(".kh-selection-toolbar");
  if (!element) throw new Error("the toolbar is not in the document");
  return element;
}
const button = (label: string) => toolbarElement().querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const linkBox = () => toolbarElement().querySelector<HTMLInputElement>("input")!;
const buttonRow = () => toolbarElement().children[0] as HTMLElement;

/** Mount the toolbar: it joins the document on the first ProseMirror update. */
function mountToolbar(editor: MarkdownEditor) {
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    view.dispatch(view.state.tr);
  });
}

function key(target: HTMLElement, init: KeyboardEventInit) {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

describe("the selection toolbar's DOM contract", () => {
  it("makes every control a type=button, so pressing one cannot submit the composer's form", async () => {
    const editor = await open("some text\n");
    mountToolbar(editor);
    const buttons = [...toolbarElement().querySelectorAll("button")];
    expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual([
      "Bold",
      "Italic",
      "Link",
      "Heading 1",
      "Heading 2",
      "Bulleted list",
      "Numbered list",
    ]);
    for (const b of buttons) expect(b.getAttribute("type")).toBe("button");
    expect(toolbarElement().getAttribute("role")).toBe("toolbar");
  });

  it("cancels mousedown on the buttons and on the toolbar's own padding, but not on the link box", async () => {
    const editor = await open("some text\n");
    mountToolbar(editor);
    const down = (target: HTMLElement) => {
      const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
      target.dispatchEvent(event);
      return event.defaultPrevented;
    };
    for (const b of toolbarElement().querySelectorAll("button")) expect(down(b)).toBe(true);
    expect(down(toolbarElement())).toBe(true);
    expect(down(linkBox())).toBe(false);
  });

  it("styles the pressed state on every button, and marks the active toggle", async () => {
    const editor = await open("**bold** text\n");
    mountToolbar(editor);
    for (const b of toolbarElement().querySelectorAll("button")) {
      expect(b.className).toContain("aria-pressed:bg-kh-bg-selected");
      expect(b.className).toContain("aria-pressed:text-kh-text");
    }
    select(editor, 1, 5);
    expect(button("Bold").getAttribute("aria-pressed")).toBe("true");
    expect(button("Italic").getAttribute("aria-pressed")).toBe("false");
  });

  it("does nothing when a button is pressed while the view is not editable", async () => {
    const editor = await open("some text\n", false);
    mountToolbar(editor);
    select(editor, 1, 5);
    button("Bold").click();
    expect(editor.getMarkdown()).toBe("some text\n");
    editor.setEditable(true);
    button("Bold").click();
    expect(editor.getMarkdown()).toBe("**some** text\n");
  });

  it("takes the link address in a plain text box that cannot block the form's Save", async () => {
    const editor = await open("some text\n");
    mountToolbar(editor);
    const box = linkBox();
    expect(box.type).toBe("text");
    expect(box.getAttribute("inputmode")).toBe("url");
    expect(box.getAttribute("autocomplete")).toBe("off");
    expect(box.getAttribute("aria-label")).toBe("Link address");
  });

  it("stops Enter and Escape in the link box, and lets every other key, such as ⌘K, bubble", async () => {
    const editor = await open("some text\n");
    mountToolbar(editor);
    const reached: string[] = [];
    const listener = (event: KeyboardEvent) => reached.push(event.key);
    document.addEventListener("keydown", listener);
    try {
      key(linkBox(), { key: "Enter" });
      key(linkBox(), { key: "Escape" });
      expect(reached).toEqual([]);
      key(linkBox(), { key: "k", metaKey: true });
      key(linkBox(), { key: "a" });
      expect(reached).toEqual(["k", "a"]);
    } finally {
      document.removeEventListener("keydown", listener);
    }
  });

  it("ignores Enter while an input method is composing", async () => {
    const editor = await open("some text\n");
    mountToolbar(editor);
    select(editor, 1, 5);
    button("Link").click();
    const box = linkBox();
    box.value = "example.com";
    // Chrome flags the composing keydown; Safari reports it as keyCode 229 after compositionend.
    key(box, { key: "Enter", isComposing: true });
    key(box, { key: "Enter", keyCode: 229 });
    expect(editor.getMarkdown()).toBe("some text\n");
    expect(box.value).toBe("example.com");
    expect(buttonRow().className).toBe("hidden");
  });

  it("gives the link box focus and the buttons back on Escape without linking", async () => {
    const editor = await open("some text\n");
    mountToolbar(editor);
    select(editor, 1, 5);
    button("Link").click();
    expect(document.activeElement).toBe(linkBox());
    expect(buttonRow().className).toBe("hidden");
    linkBox().value = "example.com";
    key(linkBox(), { key: "Escape" });
    expect(buttonRow().className).not.toContain("hidden");
    expect(linkBox().value).toBe("");
    expect(editor.getMarkdown()).toBe("some text\n");
  });

  it.each([
    ["example.com", "https://example.com"],
    ["  example.com/a?b=1  ", "https://example.com/a?b=1"],
    ["https://example.com", "https://example.com"],
    ["http://example.com", "http://example.com"],
    ["/docs/a", "/docs/a"],
    ["#top", "#top"],
    ["mailto:me@example.com", "mailto:me@example.com"],
  ])("links %j to %j", async (typed, href) => {
    const editor = await open("some text\n");
    mountToolbar(editor);
    select(editor, 1, 5);
    button("Link").click();
    linkBox().value = typed;
    key(linkBox(), { key: "Enter" });
    expect(editor.getMarkdown()).toBe(`[some](${href}) text\n`);
  });

  it("links nothing for an empty address", async () => {
    const editor = await open("some text\n");
    mountToolbar(editor);
    select(editor, 1, 5);
    button("Link").click();
    linkBox().value = "   ";
    key(linkBox(), { key: "Enter" });
    expect(editor.getMarkdown()).toBe("some text\n");
    expect(buttonRow().className).not.toContain("hidden");
  });
});


describe("the list buttons", () => {
  // Bulleted ⇄ numbered is not a conversion ProseMirror offers: a list cannot be the first
  // child of a list item, so the other type's button would do nothing. It says so instead.
  it.each([
    ["- item\n", "Numbered list", "Bulleted list"],
    ["1. item\n", "Bulleted list", "Numbered list"],
  ])("in %j, disables %s and leaves %s pressable", async (markdown, other, same) => {
    const editor = await open(markdown);
    mountToolbar(editor);
    select(editor, 3, 7);
    expect(button(other).disabled).toBe(true);
    expect(button(other).type).toBe("button");
    expect(button(same).disabled).toBe(false);
    expect(button(same).getAttribute("aria-pressed")).toBe("true");
    button(other).click();
    expect(editor.getMarkdown()).toBe(markdown);
  });

  it("disables neither outside a list, and enables them again on leaving one", async () => {
    const editor = await open("text\n\n- item\n");
    mountToolbar(editor);
    select(editor, 9, 13);
    expect(button("Numbered list").disabled).toBe(true);
    select(editor, 1, 5);
    expect(button("Bulleted list").disabled).toBe(false);
    expect(button("Numbered list").disabled).toBe(false);
  });
});

describe("hiding on blur", () => {
  async function shown() {
    const editor = await open("some text\n");
    mountToolbar(editor);
    await throttleWindow();
    select(editor, 1, 5);
    await throttleWindow();
    return editor;
  }

  it("shows over a focused selection", async () => {
    await shown();
    expect(toolbarElement().dataset.show).toBe("true");
  });

  it("hides when the editor loses focus to somewhere else", async () => {
    const editor = await shown();
    editorDom(editor).dispatchEvent(new FocusEvent("blur", { relatedTarget: null }));
    expect(toolbarElement().dataset.show).toBe("false");
  });

  it("stays when focus moves into the toolbar, as it does to the link box", async () => {
    const editor = await shown();
    editorDom(editor).dispatchEvent(new FocusEvent("blur", { relatedTarget: linkBox() }));
    expect(toolbarElement().dataset.show).toBe("true");
  });

  it("stays through pressing the link button, which moves focus into the box", async () => {
    await shown();
    button("Link").click();
    expect(document.activeElement).toBe(linkBox());
    expect(toolbarElement().dataset.show).toBe("true");
  });

  /** Moves focus out of the editor for real, to a field elsewhere on the page. */
  function focusElsewhere() {
    const field = document.createElement("input");
    document.body.appendChild(field);
    field.focus();
  }

  // Focus coming back (from the Markdown view, from the title field) dispatches no ProseMirror
  // update, so an unchanged selection would otherwise stay without its toolbar.
  it("comes back when focus returns to the editor with the selection unchanged", async () => {
    const editor = await shown();
    focusElsewhere();
    await throttleWindow();
    expect(toolbarElement().dataset.show).toBe("false");
    editorDom(editor).focus();
    await throttleWindow();
    expect(toolbarElement().dataset.show).toBe("true");
  });

  it("stays hidden when focus returns to a caret", async () => {
    const editor = await open("some text\n");
    mountToolbar(editor);
    await throttleWindow();
    select(editor, 3, 3);
    await throttleWindow();
    focusElsewhere();
    await throttleWindow();
    editorDom(editor).focus();
    await throttleWindow();
    expect(toolbarElement().dataset.show).toBe("false");
  });

  it("hides the link box when focus leaves it for anywhere but the editor or the toolbar", async () => {
    await shown();
    button("Link").click();
    expect(document.activeElement).toBe(linkBox());
    linkBox().value = "half-typed";
    focusElsewhere();
    expect(toolbarElement().dataset.show).toBe("false");
    expect(buttonRow().className).not.toContain("hidden");
    expect(linkBox().value).toBe("");
  });

  it("keeps the link box's toolbar when focus goes from the box back into the editor", async () => {
    const editor = await shown();
    button("Link").click();
    linkBox().dispatchEvent(new FocusEvent("blur", { relatedTarget: editorDom(editor) }));
    expect(toolbarElement().dataset.show).toBe("true");
  });

  it("leaves nothing behind when the editor is destroyed", async () => {
    const editor = await shown();
    const dom = editorDom(editor);
    opened.splice(opened.indexOf(editor), 1);
    await editor.destroy();
    expect(document.querySelector(".kh-selection-toolbar")).toBeNull();
    dom.dispatchEvent(new FocusEvent("blur", { relatedTarget: null }));
  });
});

describe("the React wrapper", () => {
  function props(overrides: Partial<RenderedEditorProps> = {}): RenderedEditorProps {
    return { markdown: "some text\n", editable: true, onReady: () => {}, onFail: () => {}, onUserEdit: () => {}, onMarkdown: () => {}, ...overrides };
  }
  function mount(initial: RenderedEditorProps) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mounted.push(root);
    // Synchronous on purpose: the build is a promise, so nothing of it has run when this returns.
    act(() => root.render(createElement(RenderedEditor, initial)));
    return {
      container,
      render: (next: RenderedEditorProps) => act(() => root.render(createElement(RenderedEditor, next))),
    };
  }
  function ready() {
    let onReady!: (editor: MarkdownEditor) => void;
    const promise = new Promise<MarkdownEditor>((resolve) => { onReady = resolve; });
    return { promise, onReady };
  }
  const isEditable = (editor: MarkdownEditor) => editor.action((ctx) => ctx.get(editorViewCtx).editable);

  it("applies an editable change that arrived while the editor was still building", async () => {
    const built = ready();
    const wrapper = mount(props({ editable: true, onReady: built.onReady }));
    wrapper.render(props({ editable: false, onReady: built.onReady }));
    const editor = await built.promise;
    expect(isEditable(editor)).toBe(false);
  });

  // The composer's sync base: if its Markdown moved on while the editor was building (a draft
  // discarded, a source edit), it must learn that the editor opened with the older text.
  it("reports the Markdown it opened with, even when the prop moved on while it was building", async () => {
    const onReady = vi.fn();
    const wrapper = mount(props({ markdown: "opened with\n", onReady }));
    wrapper.render(props({ markdown: "moved on\n", onReady }));
    await vi.waitFor(() => expect(onReady).toHaveBeenCalledOnce());
    const [editor, openedWith] = onReady.mock.calls[0] as [MarkdownEditor, string];
    expect(openedWith).toBe("opened with\n");
    expect(editor.getMarkdown()).toBe("opened with\n");
  });

  it("follows later editable changes", async () => {
    const built = ready();
    const wrapper = mount(props({ editable: false, onReady: built.onReady }));
    const editor = await built.promise;
    expect(isEditable(editor)).toBe(false);
    wrapper.render(props({ editable: true, onReady: built.onReady }));
    expect(isEditable(editor)).toBe(true);
  });

  describe.each([true, false])("clicking a link with editable=%s", (editable) => {
    async function withLink() {
      const built = ready();
      const wrapper = mount(props({ markdown: "[site](https://example.com)\n", editable, onReady: built.onReady }));
      await built.promise;
      const anchor = wrapper.container.querySelector("a")!;
      expect(anchor.getAttribute("href")).toBe("https://example.com");
      return { anchor, paragraph: wrapper.container.querySelector("p")! };
    }
    const click = (target: HTMLElement, init: MouseEventInit = {}) => {
      const event = new MouseEvent("click", { bubbles: true, cancelable: true, ...init });
      target.dispatchEvent(event);
      return event;
    };

    it("never navigates on a plain click", async () => {
      const open = vi.spyOn(window, "open").mockImplementation(() => null);
      const { anchor } = await withLink();
      expect(click(anchor).defaultPrevented).toBe(true);
      expect(open).not.toHaveBeenCalled();
    });

    it("opens a new tab on ⌘-click and on Ctrl-click", async () => {
      const open = vi.spyOn(window, "open").mockImplementation(() => null);
      const { anchor } = await withLink();
      expect(click(anchor, { metaKey: true }).defaultPrevented).toBe(true);
      expect(click(anchor, { ctrlKey: true }).defaultPrevented).toBe(true);
      expect(open).toHaveBeenCalledTimes(2);
      expect(open).toHaveBeenCalledWith("https://example.com", "_blank", "noopener,noreferrer");
    });

    it("leaves a click that is not on a link alone", async () => {
      const open = vi.spyOn(window, "open").mockImplementation(() => null);
      const { paragraph } = await withLink();
      expect(click(paragraph, { metaKey: true }).defaultPrevented).toBe(false);
      expect(open).not.toHaveBeenCalled();
    });
  });
});
