// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReviewAnchor } from "@/modules/knowledge/domain/document-review";
import { ReviewBlockComment } from "@/components/knowledge/review-block-comment";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const markdown = "First paragraph here.\n\nSecond paragraph here.";
let reading: HTMLDivElement;
let host: HTMLDivElement;
let root: Root | null = null;

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  reading = document.createElement("div");
  reading.innerHTML = `<article data-review-document><p data-review-path="0">First paragraph here.</p><p data-review-path="1">Second paragraph here.</p></article>`;
  document.body.appendChild(reading);
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  reading.remove();
  host.remove();
  vi.unstubAllGlobals();
});

function buttons(onChoose: (anchor: ReviewAnchor) => boolean) {
  act(() => {
    root = createRoot(host);
    root.render(createElement(ReviewBlockComment, { readingRef: { current: reading }, markdown, chosen: null, onChoose }));
  });
  const found = host.querySelectorAll<HTMLButtonElement>("button");
  expect(found).toHaveLength(2);
  return found;
}

const paragraphs = () => Array.from(reading.querySelectorAll("p"));

test("paints the whole paragraph when the comment stays about the whole paragraph", () => {
  const [first, second] = buttons(() => true);
  act(() => first.click());
  expect(paragraphs()[0].classList.contains("kh-comment-block-selected")).toBe(true);
  expect(paragraphs()[1].classList.contains("kh-comment-block-selected")).toBe(false);
  act(() => second.click());
  expect(paragraphs()[0].classList.contains("kh-comment-block-selected")).toBe(false);
  expect(paragraphs()[1].classList.contains("kh-comment-block-selected")).toBe(true);
});

test("leaves a narrowed selection as the only highlight", () => {
  const seen: string[] = [];
  const [first] = buttons(anchor => { seen.push(anchor.exact); return false; });
  act(() => first.click());
  expect(seen).toEqual(["First paragraph here."]);
  for (const paragraph of paragraphs()) expect(paragraph.classList.contains("kh-comment-block-selected")).toBe(false);
});

test("pressing the button keeps the selection it narrows to", () => {
  const [first] = buttons(() => false);
  const range = document.createRange();
  range.setStart(paragraphs()[0].firstChild!, 0);
  range.setEnd(paragraphs()[0].firstChild!, 5);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  const press = new PointerEvent("pointerdown", { bubbles: true, cancelable: true });
  act(() => { first.dispatchEvent(press); });
  expect(press.defaultPrevented).toBe(true);
  expect(selection.toString()).toBe("First");
});

test("a completed tap reveals its paragraph action without intercepting the touch or creating a comment", async () => {
  const choose = vi.fn(() => true);
  const [first, second] = buttons(choose);
  act(() => { paragraphs()[0].dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "touch", pointerId: 1 })); });
  expect(first.parentElement!.hasAttribute("data-hovered")).toBe(false);
  const touch = new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerType: "touch", pointerId: 1 });
  act(() => { paragraphs()[0].dispatchEvent(touch); });
  expect(touch.defaultPrevented).toBe(false);
  expect(first.parentElement!.hasAttribute("data-hovered")).toBe(false);
  act(() => { window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerType: "touch", pointerId: 1 })); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  expect(first.parentElement!.hasAttribute("data-hovered")).toBe(true);
  expect(second.parentElement!.hasAttribute("data-hovered")).toBe(false);
  expect(choose).not.toHaveBeenCalled();

  act(() => { paragraphs()[1].dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "touch", pointerId: 2 })); });
  act(() => { window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerType: "touch", pointerId: 2 })); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  expect(first.parentElement!.hasAttribute("data-hovered")).toBe(false);
  expect(second.parentElement!.hasAttribute("data-hovered")).toBe(true);
  expect(choose).not.toHaveBeenCalled();
});

test("scrolling a touch over a paragraph does not reveal its comment action", async () => {
  const [first] = buttons(() => true);
  act(() => { paragraphs()[0].dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "touch", pointerId: 1, clientY: 10 })); });
  act(() => { window.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerType: "touch", pointerId: 1, clientY: 40 })); });
  act(() => { window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerType: "touch", pointerId: 1, clientY: 40 })); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  expect(first.parentElement!.hasAttribute("data-hovered")).toBe(false);
});

test("a pointer crossing from its paragraph to the button beside it keeps the button shown, until it leaves the reading box", () => {
  const [first] = buttons(() => true);
  const article = reading.querySelector("article")!;
  act(() => { paragraphs()[0].dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" })); });
  expect(first.parentElement!.hasAttribute("data-hovered")).toBe(true);
  // The gap between paragraph and button is the article's own box.
  act(() => { article.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" })); });
  expect(first.parentElement!.hasAttribute("data-hovered")).toBe(true);
  act(() => { reading.dispatchEvent(new PointerEvent("pointerleave", { pointerType: "mouse" })); });
  expect(first.parentElement!.hasAttribute("data-hovered")).toBe(false);
});

test("the paragraph buttons are one tab stop in a named vertical toolbar, and the arrows move between them", () => {
  reading.querySelector("article")!.insertAdjacentHTML("beforeend", `<p data-review-path="2">Third paragraph here.</p>`);
  act(() => {
    root = createRoot(host);
    root.render(createElement(ReviewBlockComment, { readingRef: { current: reading }, markdown: `${markdown}\n\nThird paragraph here.`, chosen: null, onChoose: () => true }));
  });
  const toolbar = host.querySelector('[role="toolbar"]')!;
  expect(toolbar.getAttribute("aria-label")).toBe("Paragraph comments");
  expect(toolbar.getAttribute("aria-orientation")).toBe("vertical");
  const all = Array.from(host.querySelectorAll<HTMLButtonElement>("button"));
  const stops = () => all.map(button => button.tabIndex);
  expect(stops()).toEqual([0, -1, -1]);
  const press = (key: string) => act(() => { document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })); });
  act(() => all[0].focus());
  press("ArrowDown");
  expect(document.activeElement).toBe(all[1]);
  expect(stops()).toEqual([-1, 0, -1]);
  press("End");
  expect(document.activeElement).toBe(all[2]);
  press("ArrowDown");
  expect(document.activeElement).toBe(all[2]);
  press("Home");
  expect(document.activeElement).toBe(all[0]);
  press("ArrowUp");
  expect(document.activeElement).toBe(all[0]);
  // Tab leaves from the last one focused, and comes back to it.
  act(() => all[1].focus());
  act(() => all[1].blur());
  expect(stops()).toEqual([-1, 0, -1]);
});

test("while a paragraph's comment is open, the tab stop is that paragraph's button", () => {
  const anchors: ReviewAnchor[] = [];
  const [first] = buttons(anchor => { anchors.push(anchor); return true; });
  act(() => first.click());
  act(() => root!.render(createElement(ReviewBlockComment, { readingRef: { current: reading }, markdown, chosen: { ...anchors[0], blockPath: [1] }, onChoose: () => true })));
  const all = Array.from(host.querySelectorAll<HTMLButtonElement>("button"));
  expect(all.map(button => [button.disabled, button.tabIndex])).toEqual([[true, -1], [false, 0]]);
});
