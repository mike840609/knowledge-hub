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
  isPersonalOwner: true,
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

const personal = { id: "personal", name: "My Space", type: "PERSONAL", lifecycleState: "ACTIVE" } as const;
const navigationWithPersonal = {
  canCreateTeam: false,
  teamsOpen: true,
  items: [personal],
} satisfies WorkspaceNavigationModel;

function Probe() {
  const { access, confirmed, navigation, revoked } = useWorkspaceAuthorizationRefresh(initialAccess, initialNavigation);
  return (
    <span>{`${confirmed ? "confirmed" : "paused"} ${revoked ? "revoked" : "active"} ${access.workspace.name} ${navigation.teamsOpen ? "teams-open" : "teams-closed"}`}</span>
  );
}

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  navigationMock.router.replace.mockClear();
  navigationMock.router.refresh.mockClear();
  window.sessionStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

type Responder = () => Response | Promise<Response>;

function stubFetch(responders: Record<string, Responder>) {
  const fetchMock = vi.fn<typeof fetch>(async (input) => {
    const responder = responders[String(input)];
    if (!responder) throw new Error(`Unexpected fetch: ${String(input)}`);
    return responder();
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function render() {
  await act(async () => {
    root.render(<Probe />);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function renderWithFailedRefresh() {
  vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockRejectedValue(new Error("temporary network failure")));
  await render();
}

describe("workspace authorization refresh failures", () => {
  it("keeps the last confirmed access when an advisory refresh fails", async () => {
    await renderWithFailedRefresh();
    expect(container.textContent).toBe("confirmed active Workspace teams-closed");
  });

  it("stays paused when an access-denial signal cannot be verified", async () => {
    await renderWithFailedRefresh();
    await act(async () => {
      window.dispatchEvent(new Event("kh:workspace-access-check"));
      await Promise.resolve();
    });
    expect(container.textContent).toBe("paused active Workspace teams-closed");
  });

  it("verifies the current Workspace directly before treating a navigation omission as revocation", async () => {
    const navWithoutCurrent: WorkspaceNavigationModel = { canCreateTeam: false, teamsOpen: true, items: [personal] };
    const fetchMock = stubFetch({
      "/api/workspaces": () => Response.json(navWithoutCurrent),
      "/api/workspaces/workspace": () => Response.json(initialAccess),
    });

    await render();

    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      "/api/workspaces",
      "/api/workspaces/workspace",
    ]);
    expect(container.textContent).toBe("confirmed active Workspace teams-open");
  });

  it("applies the navigation and access views when both reads succeed", async () => {
    const renamed = {
      ...initialAccess,
      workspace: { ...initialAccess.workspace, name: "Renamed" },
    } satisfies WorkspaceAccessView;
    stubFetch({
      "/api/workspaces": () => Response.json(navigationWithPersonal),
      "/api/workspaces/workspace": () => Response.json(renamed),
    });

    await render();

    expect(container.textContent).toBe("confirmed active Renamed teams-open");
  });

  it("revokes and stores the notice when the access read is 404", async () => {
    stubFetch({
      "/api/workspaces": () => Response.json(navigationWithPersonal),
      "/api/workspaces/workspace": () => new Response("{}", { status: 404 }),
    });

    await render();

    expect(container.textContent).toBe("paused revoked Workspace teams-open");
    expect(window.sessionStorage.getItem("kh:workspace-access-notice")).toBe("1");
  });

  it("keeps the last confirmed access when the access read fails with 500", async () => {
    stubFetch({
      "/api/workspaces": () => Response.json(initialNavigation),
      "/api/workspaces/workspace": () => new Response("{}", { status: 500 }),
    });

    await render();

    expect(container.textContent).toBe("confirmed active Workspace teams-closed");
    expect(window.sessionStorage.getItem("kh:workspace-access-notice")).toBeNull();
    expect(navigationMock.router.replace).not.toHaveBeenCalled();
  });

  it("keeps the last confirmed access when the navigation read fails, even if access is 404", async () => {
    stubFetch({
      "/api/workspaces": () => new Response("{}", { status: 500 }),
      "/api/workspaces/workspace": () => new Response("{}", { status: 404 }),
    });

    await render();

    expect(container.textContent).toBe("confirmed active Workspace teams-closed");
    expect(window.sessionStorage.getItem("kh:workspace-access-notice")).toBeNull();
    expect(navigationMock.router.replace).not.toHaveBeenCalled();
  });

  it("keeps the last confirmed access when the navigation request rejects and access succeeds", async () => {
    stubFetch({
      "/api/workspaces": () => Promise.reject(new Error("temporary network failure")),
      "/api/workspaces/workspace": () => Response.json(initialAccess),
    });

    await render();

    expect(container.textContent).toBe("confirmed active Workspace teams-closed");
  });

  it("keeps access without an unhandled rejection when the access request rejects and navigation succeeds", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    stubFetch({
      "/api/workspaces": () => Response.json(initialNavigation),
      "/api/workspaces/workspace": () => Promise.reject(new Error("temporary network failure")),
    });

    try {
      await render();
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }

    expect(container.textContent).toBe("confirmed active Workspace teams-closed");
    expect(unhandled).toEqual([]);
  });

  it("ignores a stale refresh that resolves after a newer one", async () => {
    const navDeferreds = [deferred<Response>(), deferred<Response>()];
    const accessDeferreds = [deferred<Response>(), deferred<Response>()];
    let navCall = 0;
    let accessCall = 0;
    stubFetch({
      "/api/workspaces": () => navDeferreds[navCall++].promise,
      "/api/workspaces/workspace": () => accessDeferreds[accessCall++].promise,
    });

    await act(async () => {
      root.render(<Probe />);
    });

    const renamed = {
      ...initialAccess,
      workspace: { ...initialAccess.workspace, name: "Renamed" },
    } satisfies WorkspaceAccessView;

    await act(async () => {
      window.dispatchEvent(new Event("kh:workspace-mutation"));
    });
    await act(async () => {
      navDeferreds[1].resolve(Response.json(initialNavigation));
      accessDeferreds[1].resolve(Response.json(renamed));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.textContent).toBe("confirmed active Renamed teams-closed");

    await act(async () => {
      navDeferreds[0].resolve(Response.json(navigationWithPersonal));
      accessDeferreds[0].resolve(new Response("{}", { status: 404 }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.textContent).toBe("confirmed active Renamed teams-closed");
    expect(window.sessionStorage.getItem("kh:workspace-access-notice")).toBeNull();
  });

  it("issues both reads before either resolves", async () => {
    const navigation = deferred<Response>();
    const access = deferred<Response>();
    const fetchMock = stubFetch({
      "/api/workspaces": () => navigation.promise,
      "/api/workspaces/workspace": () => access.promise,
    });

    await act(async () => {
      root.render(<Probe />);
    });

    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      "/api/workspaces",
      "/api/workspaces/workspace",
    ]);

    await act(async () => {
      navigation.resolve(Response.json(initialNavigation));
      access.resolve(Response.json(initialAccess));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.textContent).toBe("confirmed active Workspace teams-closed");
  });
});
