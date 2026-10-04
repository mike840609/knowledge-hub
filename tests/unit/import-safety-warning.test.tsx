// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { ImportPreview } from "@/components/imports/import-preview";
import type { ImportPreview as Model } from "@/modules/sources/application/reconcile-import-snapshot";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/shell/use-workspace-authorization", () => ({
  useWorkspaceAuthorization: () => ({
    confirmed: true,
    access: { actions: { canImport: true } },
  }),
  requestWorkspaceAccessCheck: vi.fn(),
}));
vi.mock("@/components/imports/folder-handle-store", () => ({
  adoptPendingHandle: async () => {},
}));
let root: Root, container: HTMLDivElement;
const fetcher = vi.fn(
  async () =>
    new Response(JSON.stringify({ sourceId: "source" }), { status: 200 }),
);
const preview = {
  snapshotId: "snapshot",
  planHash: "exact-plan",
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
      updated: 0,
      moved: 0,
      renamed: 0,
      archived: 5,
      restored: 0,
      unchanged: 5,
    },
    folders: { added: 0, archived: 0, restored: 0 },
    assets: { added: 0, updated: 0, removed: 0, unchanged: 0 },
    warnings: 0,
    blockers: 0,
    affectedDocuments: 5,
    changed: true,
  },
  changes: [],
  safety: {
    previousDocuments: 10,
    incomingDocuments: 5,
    matchedDocuments: 5,
    archivedDocuments: 5,
    archiveRatio: 0.5,
    highRisk: true,
    reasons: ["MASS_ARCHIVE"],
  },
} as unknown as Model;
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
it("disables risky Apply until the source name matches and sends the exact plan acknowledgment", async () => {
  await act(async () =>
    root.render(<ImportPreview workspaceId="ws" preview={preview} />),
  );
  const apply = [
    ...container.querySelectorAll<HTMLButtonElement>("button"),
  ].find((b) => b.textContent === "Apply changes");
  expect(apply?.disabled).toBe(true);
  expect(container.textContent).toContain("50%");
  const input = container.querySelector<HTMLInputElement>(
    'input[aria-label="Confirm source name"]',
  );
  expect(input).not.toBeNull();
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!;
  await act(async () => {
    setter.call(input, "Wrong");
    input!.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(apply?.disabled).toBe(true);
  await act(async () => {
    setter.call(input, "Reading");
    input!.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(apply?.disabled).toBe(false);
  await act(async () => apply!.click());
  expect(fetcher).toHaveBeenCalledWith(
    "/api/source-imports/snapshot/apply",
    expect.objectContaining({
      body: JSON.stringify({
        riskAcknowledgment: { planHash: "exact-plan", sourceName: "Reading" },
      }),
    }),
  );
});
