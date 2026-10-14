// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MarkdownImage, LinkedImageScope } from "@/components/knowledge/markdown-image";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const render = async (node: ReactNode) => { await act(async () => root.render(node)); };
const click = async (element: Element | null) => {
  expect(element).not.toBeNull();
  await act(async () => (element as HTMLElement).click());
};

it("opens an allowed image, zooms it, closes and restores focus", async () => {
  await render(<MarkdownImage src="/assets/test.png" alt="Setup screenshot" />);
  const trigger = container.querySelector("button")!;
  trigger.focus();
  await click(trigger);
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  await click(document.querySelector('[aria-label="Zoom in"]'));
  expect(document.querySelector('[aria-label="Reset zoom"]')?.textContent).toBe("150%");
  await click(document.querySelector('[aria-label="Reset zoom"]'));
  expect(document.querySelector('[aria-label="Reset zoom"]')?.textContent).toBe("100%");
  expect(document.querySelector('a')?.getAttribute("href")).toBe("/assets/test.png");
  await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement).toBe(trigger);
});

it("never opens a blocked image and preserves explicitly linked images", async () => {
  await render(<MarkdownImage src="https://external.test/image.png" alt="Blocked" />);
  expect(container.querySelector("img")).toBeNull();
  expect(container.querySelector("button")).toBeNull();
  await render(<LinkedImageScope><a href="/destination"><MarkdownImage src="/assets/test.png" alt="Linked" /></a></LinkedImageScope>);
  expect(container.querySelector("a img")).not.toBeNull();
  // It is still a block: the margin the enlarging button carries is on the image here.
  expect(container.querySelector("a img")!.className).toContain("my-4");
  expect(container.querySelector("button")).toBeNull();
});
