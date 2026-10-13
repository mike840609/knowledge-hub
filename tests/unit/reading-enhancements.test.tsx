// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MarkdownImage, LinkedImageScope } from "@/components/knowledge/markdown-image";
import { ReadingWidthToggle } from "@/components/knowledge/reading-width-toggle";
import { DocumentPreviewLink } from "@/components/knowledge/document-preview-link";

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
  expect(container.querySelector("button")).toBeNull();
});

it("toggles wide reading without changing document content", async () => {
  await render(<ReadingWidthToggle />);
  const button = container.querySelector("button")!;
  expect(button.getAttribute("aria-pressed")).toBe("false");
  await click(button);
  expect(button.getAttribute("data-reading-wide")).toBe("true");
  await click(button);
  expect(button.getAttribute("aria-pressed")).toBe("false");
});

it("loads a preview only on focus, keeps navigation, and handles revoked access on reopening", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ title: "Target", excerpt: "A short summary" })));
  vi.stubGlobal("fetch", fetcher);
  await render(<DocumentPreviewLink documentId="d1" href="/w/w1/knowledge/s1/d1#setup" title="Target" className="">Read setup</DocumentPreviewLink>);
  expect(fetcher).not.toHaveBeenCalled();
  const link = container.querySelector("a")!;
  expect(link.textContent).toBe("Read setup");
  await act(async () => { link.focus(); });
  expect(fetcher).toHaveBeenCalledWith("/api/documents/d1/preview", expect.objectContaining({ cache: "no-store" }));
  expect(document.body.textContent).toContain("A short summary");
  expect(link.getAttribute("href")).toBe("/w/w1/knowledge/s1/d1#setup");
  await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  await act(async () => { link.blur(); });
  fetcher.mockResolvedValue(new Response("{}", { status: 404 }));
  await act(async () => { link.focus(); });
  expect(document.body.textContent).toContain("Preview unavailable");
  expect(document.body.textContent).not.toContain("A short summary");
});
