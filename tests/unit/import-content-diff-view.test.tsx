// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { ImportPreview } from "@/components/imports/import-preview";
import type { ImportPreview as PreviewModel } from "@/modules/sources/application/reconcile-import-snapshot";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/components/shell/use-workspace-authorization", () => ({
  useWorkspaceAuthorization: () => ({
    confirmed: true,
    access: { actions: { canImport: true } },
  }),
}));
let root: Root, container: HTMLDivElement;
const response = {
  titleChanges: null,
  metadataChanges: [],
  lines: [
    { kind: "removed", text: "old" },
    { kind: "added", text: "<script>new</script>" },
  ],
  truncated: true,
};
const fetcher = vi.fn(
  async () =>
    new Response(JSON.stringify(response), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
);
const preview: PreviewModel = {
  snapshotId: "snapshot",
  state: "READY",
  expired: false,
  workspaceId: "ws",
  workspaceName: "My Space",
  sourceId: "source",
  sourceName: "Reading",
  proposedSourceName: null,
  basedOnVersion: 1,
  expiresAt: new Date(Date.now() + 3600000),
  hasBlockers: false,
  summary: {
    documents: {
      added: 0,
      updated: 1,
      moved: 0,
      renamed: 0,
      archived: 0,
      restored: 0,
      unchanged: 0,
    },
    folders: { added: 0, archived: 0, restored: 0 },
    assets: { added: 0, updated: 0, removed: 0, unchanged: 0 },
    warnings: 0,
    blockers: 0,
    affectedDocuments: 1,
    changed: true,
  },
  changes: [
    {
      kind: "DOCUMENT",
      sourcePath: "docs/readme.md",
      previousPath: null,
      labels: ["UPDATED"],
      diagnostics: [],
    },
  ],
};
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", fetcher);
  fetcher.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
it("loads text only when expanded, escapes it, and warns when truncated", async () => {
  await act(async () =>
    root.render(<ImportPreview workspaceId="ws" preview={preview} />),
  );
  expect(fetcher).not.toHaveBeenCalled();
  const button = container.querySelector<HTMLButtonElement>(
    'button[aria-label="View changes: docs/readme.md"]',
  );
  expect(button).not.toBeNull();
  await act(async () => button!.click());
  expect(container.textContent).toContain("<script>new</script>");
  expect(container.querySelector("script")).toBeNull();
  expect(container.textContent).toContain("truncated");
  await act(async () => button!.click());
  await act(async () => button!.click());
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("offers retry when the lazy request fails", async () => {
  fetcher.mockResolvedValueOnce(
    new Response(
      JSON.stringify({ error: { message: "Preview unavailable" } }),
      { status: 503 },
    ),
  );
  await act(async () =>
    root.render(<ImportPreview workspaceId="ws" preview={preview} />),
  );
  const button = container.querySelector<HTMLButtonElement>(
    'button[aria-label="View changes: docs/readme.md"]',
  );
  expect(button).not.toBeNull();
  await act(async () => button!.click());
  const retry = [
    ...container.querySelectorAll<HTMLButtonElement>("button"),
  ].find((b) => b.textContent === "Retry");
  expect(retry).toBeDefined();
  await act(async () => retry!.click());
  expect(container.textContent).toContain("<script>new</script>");
});
