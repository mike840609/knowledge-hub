// @vitest-environment jsdom
import { editorViewCtx } from "@milkdown/kit/core";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { createMarkdownEditor, type MarkdownEditor } from "@/components/knowledge/editor/editor-core";
import { FindBar } from "@/components/knowledge/editor/find-bar";
import { findReplace } from "@/components/knowledge/editor/find-replace";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** The bar's roles, names and live count (2026-11-26 spec, decision 7); what it finds is `editor-find-replace.test.ts`. */
const opened: { editor: MarkdownEditor; root: Root }[] = [];
afterEach(async () => {
  while (opened.length) {
    const { editor, root } = opened.pop()!;
    act(() => root.unmount());
    await editor.destroy();
  }
  document.body.innerHTML = "";
});

async function open(markdown: string, editable = true) {
  const host = document.body.appendChild(document.createElement("div"));
  const find = findReplace();
  const editor = await createMarkdownEditor({ root: host, markdown, className: "kh-editor", ariaLabel: "Content", editable, onUserEdit() {}, onMarkdown() {}, allowImage: () => false, extraPlugins: [find.plugin] });
  const root = createRoot(find.controller.mount);
  act(() => root.render(<FindBar controller={find.controller} />));
  opened.push({ editor, root });
  return { editor, find: find.controller, view: editor.action((ctx) => ctx.get(editorViewCtx)), bar: () => find.controller.mount };
}
const field = (bar: HTMLElement, name: string) => bar.querySelector<HTMLInputElement>(`input[aria-label="${name}"]`)!;
const button = (bar: HTMLElement, name: string) => bar.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`) ?? [...bar.querySelectorAll("button")].find(item => item.textContent === name)!;
const type = (input: HTMLInputElement, value: string) => act(() => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
});

describe("the find bar", () => {
  it("is mounted at the top of the editor's host, and shown only while open", async () => {
    const { find, bar } = await open("one\n");
    expect(bar().parentElement?.firstElementChild).toBe(bar());
    expect(bar().hidden).toBe(true);
    act(() => find.open());
    expect(bar().hidden).toBe(false);
  });

  it("is a named search region with labelled fields and named buttons", async () => {
    const { find, bar } = await open("one\n");
    act(() => find.open());
    const region = bar().querySelector('[role="search"]');
    expect(region?.getAttribute("aria-label")).toBe("Find and replace");
    expect(field(bar(), "Find")).toBeTruthy();
    for (const name of ["Match case", "Previous match", "Next match", "Close find", "Show replace"]) expect(button(bar(), name), name).toBeTruthy();
    expect(button(bar(), "Match case").getAttribute("aria-pressed")).toBe("false");
    expect(bar().querySelector('[aria-live="polite"]')).toBeTruthy();
    expect(document.activeElement).toBe(field(bar(), "Find"));
  });

  it("says how many, which one, and when there are none", async () => {
    const { find, bar } = await open("Cat cat CAT\n");
    act(() => find.open());
    type(field(bar(), "Find"), "cat");
    const live = () => bar().querySelector('[aria-live="polite"]')!.textContent;
    expect(live()).toBe("1 of 3");
    act(() => button(bar(), "Next match").click());
    expect(live()).toBe("2 of 3");
    act(() => button(bar(), "Match case").click());
    expect(live()).toBe("1 of 1");
    type(field(bar(), "Find"), "dog");
    expect(live()).toBe("No results");
    expect(button(bar(), "Next match").disabled).toBe(true);
  });

  it("reveals the replace field, replaces one and all, and says what it did", async () => {
    const { find, bar, editor } = await open("cat cat cat\n");
    act(() => find.open());
    expect(field(bar(), "Replace with")).toBeNull();
    act(() => button(bar(), "Show replace").click());
    expect(button(bar(), "Hide replace").getAttribute("aria-expanded")).toBe("true");
    type(field(bar(), "Find"), "cat");
    type(field(bar(), "Replace with"), "dog");
    act(() => button(bar(), "Replace").click());
    expect(editor.getMarkdown()).toBe("dog cat cat\n");
    act(() => button(bar(), "Replace all").focus());
    act(() => button(bar(), "Replace all").click());
    expect(editor.getMarkdown()).toBe("dog dog dog\n");
    expect(bar().querySelector('[aria-live="polite"]')!.textContent).toBe("Replaced 2");
    // The button that did it is now disabled; focus stays in the bar rather than falling to the page.
    expect(document.activeElement).toBe(field(bar(), "Find"));
  });

  it("Enter in the query steps, Shift-Enter steps back, Escape closes and the editor has focus again", async () => {
    const { find, bar, view } = await open("a a a\n");
    act(() => find.open());
    const input = field(bar(), "Find");
    type(input, "a");
    const press = (init: KeyboardEventInit) => act(() => { input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init })); });
    press({ key: "Enter" });
    expect(find.getSnapshot().index).toBe(1);
    press({ key: "Enter", shiftKey: true });
    expect(find.getSnapshot().index).toBe(0);
    press({ key: "Escape" });
    expect(find.getSnapshot().open).toBe(false);
    expect(bar().hidden).toBe(true);
    expect(view.hasFocus()).toBe(true);
  });

  it("has no replace controls where the editor cannot be edited", async () => {
    const { find, bar } = await open("cat\n", false);
    act(() => find.open({ replace: true }));
    expect(button(bar(), "Show replace")).toBeUndefined();
    expect(field(bar(), "Replace with")).toBeNull();
  });
});
