// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MarkdownEditor } from "@/components/knowledge/editor/editor-core";
import { RenderedEditor } from "@/components/knowledge/editor/rendered-editor";
import { DocumentMetaContext } from "@/components/knowledge/document-meta";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const noRect = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) } as DOMRect;
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => noRect;

const mounted: Root[] = [];
afterEach(() => {
  for (const root of mounted.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

const context = { meta: { status: "ACTIVE" as const, updatedAt: new Date("2026-10-01T00:00:00.000Z"), readOnly: false, syncHref: null }, outline: { entries: [], activeSlug: null } };

async function open(markdown: string, value: typeof context | null = context) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push(root);
  const onReady = vi.fn();
  act(() => root.render(createElement(DocumentMetaContext.Provider, { value }, createElement(RenderedEditor, { workspaceId: "00000000-0000-4000-8000-000000000001", markdown, editable: true, titleMeta: true, onReady, onFail: () => {}, onUserEdit: () => {}, onMarkdown: () => {} }))));
  await vi.waitFor(() => expect(onReady).toHaveBeenCalledOnce());
  return { container, editor: onReady.mock.calls[0][0] as MarkdownEditor };
}
const metaLines = (container: HTMLElement) => container.querySelectorAll("[data-document-meta]").length;
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });

describe("the title's meta line in the editor", () => {
  it("is drawn under the opening # title", async () => {
    const { container } = await open("# Alpha\n\nBody\n");
    await settle();
    expect(metaLines(container)).toBe(1);
  });

  it("survives a whole-document replace that changes the title (the new widget is created before the old is destroyed)", async () => {
    const { container, editor } = await open("# Alpha\n\nBody\n");
    await settle();
    act(() => editor.replaceMarkdown("# Beta\n\nOther body\n"));
    await settle();
    expect(container.querySelector("h1")?.textContent).toBe("Beta");
    expect(metaLines(container)).toBe(1);
  });

  it("survives a replace that keeps the title", async () => {
    const { container, editor } = await open("# Alpha\n\nBody\n");
    await settle();
    act(() => editor.replaceMarkdown("# Alpha\n\nChanged body\n"));
    await settle();
    expect(metaLines(container)).toBe(1);
  });

  it("goes when the document no longer opens with a # title", async () => {
    const { container, editor } = await open("# Alpha\n\nBody\n");
    await settle();
    act(() => editor.replaceMarkdown("Just text\n"));
    await settle();
    expect(metaLines(container)).toBe(0);
  });

  it("draws nothing where the page keeps the line in its header (no context provided)", async () => {
    const { container } = await open("# Alpha\n\nBody\n", null);
    await settle();
    expect(metaLines(container)).toBe(0);
  });
});
