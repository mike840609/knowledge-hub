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
