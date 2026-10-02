// @vitest-environment jsdom
import { act } from "react";
import { renderToString } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RememberedFolderRow } from "@/components/sources/remembered-folder-row";

const store = vi.hoisted(() => ({
  meta: null as { rootName: string; lastSyncAt: string } | null,
  getRememberedFolderMeta: vi.fn(() => store.meta),
}));

vi.mock("@/components/imports/folder-handle-store", () => ({
  getRememberedFolderMeta: store.getRememberedFolderMeta,
}));

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  store.meta = null;
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function renderRow() {
  await act(async () => {
    root.render(<RememberedFolderRow sourceId="src-1" />);
  });
}

it("renders nothing when no folder is remembered", async () => {
  store.meta = null;
  await renderRow();
  expect(container.innerHTML).toBe("");
});

it("shows the remembered rootName after mount with memory", async () => {
  store.meta = { rootName: "notes", lastSyncAt: "2026-10-02T00:00:00.000Z" };
  await renderRow();
  const dt = container.querySelector("dt");
  const dd = container.querySelector("dd");
  expect(dt?.textContent).toBe("Last folder");
  expect(dt?.className).toContain("w-24");
  expect(dt?.className).toContain("text-kh-text-muted");
  expect(dd?.textContent).toBe("notes");
  expect(dd?.className).toContain("text-kh-text");
  expect(container.textContent).not.toContain("2026-10-02");
});

it("server render outputs nothing and reads no browser storage", () => {
  const html = renderToString(<RememberedFolderRow sourceId="src-1" />);
  expect(html).toBe("");
  expect(store.getRememberedFolderMeta).not.toHaveBeenCalled();
});
