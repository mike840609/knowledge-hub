// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

// The reader's renderer is a separate chunk; a page older than the latest deploy may fail to load it.
vi.mock("@/components/knowledge/markdown-renderer", () => {
  throw new Error("chunk failed to load");
});

import { SearchPreview } from "@/components/search/search-preview";

it("says the document cannot be previewed when the renderer fails to load, rather than loading forever", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ title: "Alpha", markdown: "Alpha body" }) })));
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  await act(async () => root.render(<SearchPreview documentId="doc-a" terms={["alpha"]} onLeave={() => {}} />));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 200)); });
  expect(container.textContent).toContain("cannot be previewed");
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});
