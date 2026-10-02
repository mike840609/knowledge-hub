// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceAuthorizationRefresh } from "@/components/shell/use-workspace-authorization";
import type { WorkspaceAccessView, WorkspaceNavigationModel } from "@/server/workspace-admin";

const navigationMock = vi.hoisted(() => ({
  pathname: "/w/workspace/knowledge",
  router: { replace: vi.fn(), refresh: vi.fn() },
}));

vi.mock("next/navigation", () => ({
  usePathname: () => navigationMock.pathname,
  useRouter: () => navigationMock.router,
}));

const initialAccess = {
  workspace: { id: "workspace", name: "Workspace", type: "PERSONAL", lifecycleState: "ACTIVE" },
  effectiveCapabilities: ["source.manage"],
  actions: {
    canImport: true,
    canInspectSources: true,
    canOpenSettings: false,
    canRename: false,
    canArchive: false,
    canRestore: false,
    canManageBasicMembers: false,
    canManageAdminMembers: false,
    canManageOwners: false,
    canManageBasicGroups: false,
    canManageAdminGroups: false,
    canReadAudit: false,
    canSearch: true,
    canWrite: true,
  },
} satisfies WorkspaceAccessView;

const initialNavigation = {
  canCreateTeam: false,
  teamsOpen: false,
  items: [initialAccess.workspace],
} satisfies WorkspaceNavigationModel;

function Probe() {
  const { confirmed } = useWorkspaceAuthorizationRefresh(initialAccess, initialNavigation);
  return <span>{confirmed ? "confirmed" : "paused"}</span>;
}

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  navigationMock.router.replace.mockClear();
  navigationMock.router.refresh.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function renderWithFailedRefresh() {
  vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockRejectedValue(new Error("temporary network failure")));
  await act(async () => {
    root.render(<Probe />);
    await Promise.resolve();
  });
}

describe("workspace authorization refresh failures", () => {
  it("keeps the last confirmed access when an advisory refresh fails", async () => {
    await renderWithFailedRefresh();
    expect(container.textContent).toBe("confirmed");
  });

  it("stays paused when an access-denial signal cannot be verified", async () => {
    await renderWithFailedRefresh();
    await act(async () => {
      window.dispatchEvent(new Event("kh:workspace-access-check"));
      await Promise.resolve();
    });
    expect(container.textContent).toBe("paused");
  });
  it("verifies the current Workspace directly before treating a navigation omission as revocation", async () => {
    const personal = { id: "personal", name: "My Space", type: "PERSONAL", lifecycleState: "ACTIVE" } as const;
    const navWithoutCurrent = { canCreateTeam: false, teamsOpen: true, items: [personal] } satisfies WorkspaceNavigationModel;
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(navWithoutCurrent))
      .mockResolvedValueOnce(Response.json(initialAccess));
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(<Probe />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      "/api/workspaces",
      "/api/workspaces/workspace",
    ]);
    expect(container.textContent).toBe("confirmed");
  });

});
