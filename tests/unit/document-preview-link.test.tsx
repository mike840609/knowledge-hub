// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
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

it("still says that other documents share the name, beside the preview", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ title: "Target", excerpt: "A short summary" }))));
  await render(<DocumentPreviewLink documentId="d1" href="/w/w1/knowledge/s1/d1" title="Target" note="2 other documents share this name" className="">Read setup</DocumentPreviewLink>);
  await act(async () => { container.querySelector("a")!.focus(); });
  expect(document.body.textContent).toContain("A short summary");
  expect(document.body.textContent).toContain("2 other documents share this name");
});
