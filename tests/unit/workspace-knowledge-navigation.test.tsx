// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WorkspaceKnowledgeNavigation } from "@/components/knowledge/workspace-knowledge-navigation";
import { WorkspaceAuthorizationContext } from "@/components/shell/use-workspace-authorization";
import { ToastProvider } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { KnowledgeTreeItem, SourceView } from "@/modules/knowledge/application/knowledge-query-service";
import type { WorkspaceAccessView } from "@/server/workspace-admin";

const navigation = vi.hoisted(() => ({ pathname: "/w/w/home", refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useParams: () => ({ workspaceId: "w", documentId: "other" }),
  useRouter: () => ({ refresh: navigation.refresh }),
  useSearchParams: () => new URLSearchParams(),
}));

const beta: SourceView = {
  id: "beta", name: "Beta", workspaceId: "w", sourceType: "FOLDER_SYNC",
  ownership: "SOURCE_MANAGED", status: "ACTIVE", syncVersion: 1,
};
const notes: SourceView = { ...beta, id: "notes", name: "Notes", sourceType: "HUB", ownership: "HUB_MANAGED" };
const sources = [beta, notes];

function documentItem(documentId: string, label: string): KnowledgeTreeItem {
  return { type: "document", id: `node-${documentId}`, documentId, label, currentRevisionId: `rev-${documentId}`, parentId: null, position: 0, status: "ACTIVE" };
}

const actions: WorkspaceAccessView["actions"] = {
  canImport: false, canInspectSources: false, canOpenSettings: false, canRename: false,
  canArchive: false, canRestore: false, canManageBasicMembers: false, canManageAdminMembers: false,
  canManageOwners: false, canManageBasicGroups: false, canManageAdminGroups: false, canReadAudit: false,
  canSearch: true, canWrite: false,
};
let root: Root, host: HTMLElement, desktop: HTMLDivElement, drawer: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  navigation.pathname = "/w/w/home";
  navigation.refresh.mockClear();
  host = document.createElement("div");
  desktop = document.createElement("div");
  drawer = document.createElement("div");
  document.body.append(host, desktop, drawer);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  desktop.remove();
  drawer.remove();
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.unstubAllGlobals();
});

async function render(headers: SourceView[] | null = sources, target: HTMLElement = desktop, workspaceId = "w", overrides: Partial<WorkspaceAccessView["actions"]> = {}) {
  const workspace = { id: workspaceId, name: "Workspace", type: "TEAM" as const, lifecycleState: "ACTIVE" as const };
  await act(async () => root.render(
    <WorkspaceAuthorizationContext.Provider value={{
      access: { workspace, isPersonalOwner: false, actions: { ...actions, ...overrides }, effectiveCapabilities: ["document.read"] },
      navigation: { canCreateTeam: false, teamsOpen: true, items: [workspace] },
      confirmed: true,
      refresh: async () => {},
    }}>
      <ToastProvider>
        <TooltipProvider>
          <WorkspaceKnowledgeNavigation workspaceId={workspaceId} sources={headers} target={target} />
        </TooltipProvider>
      </ToastProvider>
    </WorkspaceAuthorizationContext.Provider>,
  ));
}

function mockTrees(resolveTree: (url: string) => Response | Promise<Response>) {
  const requests: string[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/sidebar-shortcuts?")) return Response.json({ documents: [] });
    requests.push(url);
    return resolveTree(url);
  });
  return requests;
}

it("opens the active source and keeps one tree and its scroll position when moving to the drawer", async () => {
  navigation.pathname = "/w/w/knowledge/beta/doc";
  const requests = mockTrees(() => Response.json({
    tree: [documentItem("doc", "Read in Beta"), documentItem("other", "Another document")],
  }));
  await render();
  const tree = desktop.querySelector('nav[aria-label="Document tree"]')!;
  expect(tree.querySelector('[aria-current="page"]')?.getAttribute("aria-label")).toBe("Read in Beta");
  tree.scrollTop = 88;

  navigation.pathname = "/w/w/tasks/other";
  await render(sources, drawer);

  expect(desktop.childElementCount).toBe(0);
  expect(drawer.querySelector('nav[aria-label="Document tree"]')).toBe(tree);
  expect(tree.scrollTop).toBe(88);
  expect(tree.querySelector('[aria-current="page"]')).toBeNull();
  expect(requests).toEqual(["/api/workspaces/w/sources/beta/tree"]);
  expect(JSON.parse(localStorage.getItem("kh:document-shortcuts:w") ?? "{}").recent).toEqual(["beta:doc"]);
});

async function openDestinations(label: string) {
  const trigger = [...desktop.querySelectorAll("button")].find((button) => button.textContent?.trim() === label);
  expect(trigger).toBeDefined();
  await act(async () => trigger!.click());
  return trigger!;
}

it("keeps the Knowledge heading while source headers fail and recover", async () => {
  navigation.pathname = "/w/w/graph";
  const requests = mockTrees(() => Response.json({ tree: [] }));
  await render(null);
  const trigger = await openDestinations("Knowledge / Graph");
  expect(document.querySelector('a[href="/w/w/graph"]')?.getAttribute("aria-current")).toBe("page");
  expect(desktop.querySelector('[role="status"]')?.textContent).toContain("Sources could not be loaded");
  await act(async () => [...desktop.querySelectorAll("button")].find((button) => button.textContent === "Retry")!.click());
  expect(navigation.refresh).toHaveBeenCalledOnce();
  expect(requests).toEqual([]);
  await render([]);
  expect(desktop.contains(trigger)).toBe(true);
  expect(desktop.textContent).not.toContain("Sources could not be loaded");
});

it("uses the current workspace capabilities for Knowledge destinations", async () => {
  await render([]);
  await openDestinations("Knowledge");
  expect(document.querySelector('a[href="/w/w/graph"]')).not.toBeNull();
  expect(document.querySelector('a[href="/w/w/sources"]')).toBeNull();
  expect(document.querySelector('a[href="/w/w/shares"]')).toBeNull();
  navigation.pathname = "/w/next/sources/detail";
  await render([], desktop, "next", { canInspectSources: true });
  await openDestinations("Knowledge / Sources");
  expect(document.querySelector('a[href="/w/next/sources"]')?.getAttribute("aria-current")).toBe("location");
  expect(document.querySelector('a[href="/w/w/graph"]')).toBeNull();
});

it("does not match a similarly prefixed route", async () => {
  navigation.pathname = "/w/w/sources-extra";
  await render([], desktop, "w", { canInspectSources: true });
  await openDestinations("Knowledge");
  const link = document.querySelector('a[href="/w/w/sources"]');
  expect(link).not.toBeNull();
  expect(link?.hasAttribute("aria-current")).toBe(false);
});

it("fetches only Notes by default and refreshes its visible rows after a new header snapshot", async () => {
  let finishRefresh!: (response: Response) => void;
  const refreshed = new Promise<Response>((resolve) => { finishRefresh = resolve; });
  let notesRead = false;
  const requests = mockTrees(() => {
    if (notesRead) return refreshed;
    notesRead = true;
    return Response.json({ tree: [documentItem("doc", "Before rename")] });
  });
  await render();
  const row = desktop.querySelector('[role="treeitem"]');
  expect(row?.getAttribute("aria-label")).toBe("Before rename");

  await render([...sources]);
  expect(desktop.querySelector('[role="treeitem"]')).toBe(row);
  expect(requests).toEqual(["/api/workspaces/w/sources/notes/tree", "/api/workspaces/w/sources/notes/tree"]);

  await act(async () => finishRefresh(Response.json({ tree: [documentItem("doc", "After rename")] })));
  expect(desktop.querySelector('[role="treeitem"]')?.getAttribute("aria-label")).toBe("After rename");
});

it("drops an archived favorite from a collapsed source without reloading that tree", async () => {
  const favorite = { documentId: "doc", sourceId: "beta", sourceName: "Beta", label: "Read in Beta", ownership: "SOURCE_MANAGED", pageIcon: null };
  let availableFavorites = [favorite];
  const requests: string[] = [];
  localStorage.setItem("kh:document-shortcuts:w", JSON.stringify({ favorites: ["beta:doc"], recent: [] }));
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/sidebar-shortcuts?")) return Response.json({ documents: availableFavorites });
    requests.push(url);
    return Response.json({ tree: url.endsWith("/beta/tree") ? [documentItem("doc", "Read in Beta")] : [] });
  });
  await render();
  const expand = desktop.querySelector<HTMLButtonElement>('[aria-controls="collection-beta"]')!;
  await act(async () => expand.click());
  await act(async () => expand.click());
  availableFavorites = [];
  await render([...sources]);

  const favorites = desktop.querySelector<HTMLButtonElement>('button[aria-label="Favorite documents"]')!;
  await act(async () => favorites.click());
  expect(document.querySelector('[role="menu"]')?.textContent).toContain("No favorite documents");
  expect(requests).toEqual([
    "/api/workspaces/w/sources/notes/tree",
    "/api/workspaces/w/sources/beta/tree",
    "/api/workspaces/w/sources/notes/tree",
  ]);
});

it("replaces the tree and cache when switching workspace", async () => {
  const requests = mockTrees((url) => Response.json({
    tree: [documentItem("doc", url.includes("/workspaces/w/") ? "Old workspace note" : "New workspace note")],
  }));
  await render();
  await render([{ ...notes, workspaceId: "other" }], desktop, "other");

  expect(desktop.querySelectorAll('aside[aria-label="Knowledge explorer"]')).toHaveLength(1);
  expect(desktop.querySelector('[role="treeitem"]')?.getAttribute("aria-label")).toBe("New workspace note");
  expect(requests).toEqual(["/api/workspaces/w/sources/notes/tree", "/api/workspaces/other/sources/notes/tree"]);
});

it("offers a shell refresh when the workspace source headers are unavailable", async () => {
  const requests = mockTrees(() => Response.json({ tree: [] }));
  await render(null);

  expect(desktop.querySelector('[role="status"]')?.textContent).toContain("Sources could not be loaded.");
  await act(async () => desktop.querySelector<HTMLButtonElement>('[role="status"] button')?.click());
  expect(navigation.refresh).toHaveBeenCalledOnce();
  expect(requests).toEqual([]);
});
