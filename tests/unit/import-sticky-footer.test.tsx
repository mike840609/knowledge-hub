// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImportStickyFooter } from "@/components/imports/import-sticky-footer";
import { adoptPendingHandle } from "@/components/imports/folder-handle-store";
import type { ImportPreview } from "@/modules/sources/application/reconcile-import-snapshot";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));
vi.mock("@/components/shell/use-workspace-authorization", () => ({
  requestWorkspaceAccessCheck: vi.fn(),
  useWorkspaceAuthorization: () => ({
    access: { actions: { canImport: true } },
    confirmed: true,
  }),
}));
vi.mock("@/components/imports/folder-handle-store", () => ({
  adoptPendingHandle: vi.fn(),
}));

function readyPreview(overrides: Partial<ImportPreview> = {}): ImportPreview {
  return {
    snapshotId: "snap-new",
    state: "READY",
    expired: false,
    workspaceId: "w1",
    workspaceName: "Team",
    sourceId: null,
    sourceName: null,
    proposedSourceName: "Notes",
    basedOnVersion: null,
    expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    hasBlockers: false,
    summary: {
      documents: { added: 1, updated: 0, moved: 0, renamed: 0, archived: 0, restored: 0, unchanged: 0 },
      folders: { added: 0, archived: 0, restored: 0 },
      assets: { added: 0, updated: 0, removed: 0, unchanged: 0 },
      warnings: 0,
      blockers: 0,
      affectedDocuments: 1,
      changed: true,
    },
    changes: [],
    ...overrides,
  };
}

let root: Root;
let container: HTMLElement;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  vi.mocked(adoptPendingHandle).mockResolvedValue(undefined);
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

function applyButton(): HTMLButtonElement {
  const button = [...container.querySelectorAll("button")].find((entry) => entry.textContent === "Apply changes");
  if (!button) throw new Error("Apply changes button not found");
  return button as HTMLButtonElement;
}

describe("import sticky footer pending-handle adoption", () => {
  it("adopts the stashed handle onto the applied source before navigating to the detail page", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ sourceId: "src-9" }));
    vi.stubGlobal("fetch", fetchMock);

    act(() => {
      root.render(createElement(ImportStickyFooter, { workspaceId: "w1", preview: readyPreview() }));
    });
    await act(async () => {
      applyButton().click();
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/source-imports/snap-new/apply", { method: "POST" });
    expect(adoptPendingHandle).toHaveBeenCalledWith("snap-new", "src-9");
    expect(push).toHaveBeenCalledWith("/w/w1/sources/src-9?import=success");
  });

  it("still navigates when adoption fails, so a storage failure never blocks the detail page", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ sourceId: "src-9" }));
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(adoptPendingHandle).mockRejectedValue(new Error("quota exceeded"));

    act(() => {
      root.render(createElement(ImportStickyFooter, { workspaceId: "w1", preview: readyPreview() }));
    });
    await act(async () => {
      applyButton().click();
    });

    expect(adoptPendingHandle).toHaveBeenCalledWith("snap-new", "src-9");
    expect(push).toHaveBeenCalledWith("/w/w1/sources/src-9?import=success");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
});

it("opens the recorded run and recovers a committed Apply after response loss",async()=>{
 const fetchMock=vi.fn<typeof fetch>().mockRejectedValueOnce(new TypeError("Network error")).mockResolvedValueOnce(Response.json({state:"APPLIED"})).mockResolvedValueOnce(Response.json({sourceId:"src-9",runId:"run-9"}));
 vi.stubGlobal("fetch",fetchMock);
 act(()=>root.render(createElement(ImportStickyFooter,{workspaceId:"w1",preview:readyPreview()})));
 await act(async()=>{applyButton().click();});
 expect(push).toHaveBeenCalledWith("/w/w1/sources/src-9/runs/run-9");
 expect(fetchMock.mock.calls[1][0]).toBe("/api/source-imports/snap-new");
});
