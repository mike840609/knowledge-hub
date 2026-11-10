// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestShare } from "@/components/actions/action-menu";
import { KnowledgeTree } from "@/components/knowledge/knowledge-tree";
import { ShareLinkDialogHost } from "@/components/knowledge/share-link-dialog";
import { SHARE_LINKS_CHANGED_EVENT, useSharedTargets } from "@/components/knowledge/shared-folders";
import { ToastProvider } from "@/components/ui/toast";
import type { KnowledgeTreeItem } from "@/modules/knowledge/application/knowledge-query-service";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));
vi.mock("next/link", async () => {
  const { createElement: h } = await import("react");
  return { default: ({ href, children, prefetch, ...rest }: { href: string; children: React.ReactNode; prefetch?: boolean }) => { void prefetch; return h("a", { href, ...rest }, children); } };
});

/** The two quiet reminders (folder share spec §8): a marker in the tree, and a line in the document's dialog. */

let root: Root;
let container: HTMLElement;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  window.localStorage.clear();
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

const folder = (id: string, label: string, parentId: string | null = null): KnowledgeTreeItem => ({ type: "folder", id, parentId, label, position: 0, status: "ACTIVE" });
const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

function renderTree(sharedFolderIds?: ReadonlySet<string>) {
  act(() => root.render(createElement(KnowledgeTree, {
    items: [folder("n:shared", "Handbook"), folder("n:private", "Drafts")],
    workspaceId: "w1", sourceId: "s1", favoriteDocumentIds: new Set<string>(), sharedFolderIds,
    onToggleFavorite: () => {}, documentActions: () => [], folderActions: () => [], onRunAction: () => {}, onReorder: async () => true, onMove: async () => true,
  })));
}
const rowFor = (label: string) => container.querySelector<HTMLElement>(`[role=treeitem][aria-label="${label}"]`)!;

describe("the tree's share marker", () => {
  it("marks a shared folder as Shared, and no other", () => {
    renderTree(new Set(["n:shared"]));
    expect(rowFor("Handbook").querySelector('[aria-label="Shared"]')).not.toBeNull();
    expect(rowFor("Drafts").querySelector('[aria-label="Shared"]')).toBeNull();
  });

  it("marks nothing where it was told of nothing", () => {
    renderTree();
    expect(container.querySelector('[aria-label="Shared"]')).toBeNull();
  });
});

describe("useSharedTargets", () => {
  function Probe({ enabled }: { enabled: boolean }) {
    const { folderIds: ids, sourceIds } = useSharedTargets("w1", enabled);
    return createElement("p", { "data-ids": [...ids].join(","), "data-sources": [...sourceIds].join(",") });
  }
  const seen = () => container.querySelector("p")!.getAttribute("data-ids");

  it("reads once, and again when the dialog says a link was made or revoked", async () => {
    let folders = [{ folderNodeId: "a", name: "A" }];
    const fetchStub = vi.fn(async () => new Response(JSON.stringify({ folders, sources: [{ sourceId: "s1" }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchStub);
    act(() => root.render(createElement(Probe, { enabled: true })));
    await flush();
    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(fetchStub.mock.calls[0]).toEqual(["/api/workspaces/w1/shared-folders", { cache: "no-store" }]);
    expect(seen()).toBe("a");
    expect(container.querySelector("p")!.getAttribute("data-sources")).toBe("s1");
    folders = [];
    act(() => { window.dispatchEvent(new Event(SHARE_LINKS_CHANGED_EVENT)); });
    await flush();
    expect(fetchStub).toHaveBeenCalledTimes(2);
    expect(seen()).toBe("");
  });

  it("refreshes on a return, coalesces both signals, and still reads on a later app switch", async () => {
    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    let folders = [{ folderNodeId: "a", name: "A" }];
    const fetchStub = vi.fn(async () => new Response(JSON.stringify({ folders }), { status: 200 }));
    vi.stubGlobal("fetch", fetchStub);
    act(() => root.render(createElement(Probe, { enabled: true })));
    await flush();
    expect(fetchStub).toHaveBeenCalledTimes(1);
    folders = [];
    now += 5_000;
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    await flush();
    expect(fetchStub).toHaveBeenCalledTimes(2);
    expect(seen()).toBe("");
    // A tab return can fire both; the second signal inside the cooldown does not read again.
    act(() => { window.dispatchEvent(new Event("focus")); });
    await flush();
    expect(fetchStub).toHaveBeenCalledTimes(2);
    // Returning from another application fires focus without visibilitychange; that still reads.
    now += 1_001;
    act(() => { window.dispatchEvent(new Event("focus")); });
    await flush();
    expect(fetchStub).toHaveBeenCalledTimes(3);
  });

  it("does not ask outside My Space, and keeps the last answer when a read fails", async () => {
    const fetchStub = vi.fn(async () => new Response("{}", { status: 403 }));
    vi.stubGlobal("fetch", fetchStub);
    act(() => root.render(createElement(Probe, { enabled: false })));
    await flush();
    expect(fetchStub).not.toHaveBeenCalled();
    act(() => root.render(createElement(Probe, { enabled: true })));
    await flush();
    expect(seen()).toBe("");
  });
});

describe("shared target subscribers", () => {
  function Probe({ workspaceId, enabled = true }: { workspaceId: string; enabled?: boolean }) {
    const { folderIds, sourceIds } = useSharedTargets(workspaceId, enabled);
    return createElement("p", { "data-folders": [...folderIds].join(","), "data-sources": [...sourceIds].join(",") }, sourceIds.has("secret") ? createElement("span", { "aria-label": "Shared" }) : null);
  }
  const rows = () => [...container.querySelectorAll("p")];
  it("shares one request and broadcasts authoritative changes to both subscribers", async () => {
    let sources = [{ sourceId: "a" }];
    const fetcher = vi.fn(async () => Response.json({ folders: [], sources }));
    vi.stubGlobal("fetch", fetcher);
    act(() => root.render(createElement("div", null, createElement(Probe, { workspaceId: "dedupe" }), createElement(Probe, { workspaceId: "dedupe" }))));
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(rows().map(p => p.dataset.sources)).toEqual(["a", "a"]);
    sources = [{ sourceId: "b" }];
    act(() => window.dispatchEvent(new Event(SHARE_LINKS_CHANGED_EVENT)));
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(rows().map(p => p.dataset.sources)).toEqual(["b", "b"]);
  });
  it("retains the last answer after failure and does not fetch when disabled", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ folders: [{ folderNodeId: "f" }], sources: [{ sourceId: "a" }] })).mockResolvedValueOnce(new Response("", { status: 503 }));
    vi.stubGlobal("fetch", fetcher);
    act(() => root.render(createElement(Probe, { workspaceId: "failure", enabled: false })));
    await flush();
    expect(fetcher).not.toHaveBeenCalled();
    act(() => root.render(createElement(Probe, { workspaceId: "failure" })));
    await flush();
    act(() => window.dispatchEvent(new Event(SHARE_LINKS_CHANGED_EVENT)));
    await flush();
    expect(rows()[0].dataset).toMatchObject({ folders: "f", sources: "a" });
  });
  it("never paints a late previous workspace response after switching", async () => {
    let resolveOld!: (value: Response) => void;
    const fetcher = vi.fn((url: string) => url.includes("old-workspace") ? new Promise<Response>(resolve => { resolveOld = resolve; }) : Promise.resolve(Response.json({ folders: [], sources: [] })));
    vi.stubGlobal("fetch", fetcher);
    act(() => root.render(createElement(Probe, { workspaceId: "old-workspace" })));
    act(() => root.render(createElement(Probe, { workspaceId: "new-workspace" })));
    await flush();
    await act(async () => { resolveOld(Response.json({ folders: [], sources: [{ sourceId: "secret" }] })); });
    expect(rows()[0].dataset.sources).toBe("");
    expect(container.querySelector('[aria-label="Shared"]')).toBeNull();
  });
  it("ignores a pre-change request that finishes after the authoritative refresh", async () => {
    let old!: (response: Response) => void;
    const fetcher = vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => { old = resolve; })).mockResolvedValueOnce(Response.json({ folders: [], sources: [{ sourceId: "new" }] }));
    vi.stubGlobal("fetch", fetcher);
    act(() => root.render(createElement(Probe, { workspaceId: "race" })));
    act(() => window.dispatchEvent(new Event(SHARE_LINKS_CHANGED_EVENT)));
    await flush();
    await act(async () => old(Response.json({ folders: [], sources: [{ sourceId: "old" }] })));
    expect(rows()[0].dataset.sources).toBe("new");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

describe("the share dialog", () => {
  const link = (id: string) => ({ id, label: null, path: `/s/${id}`, createdAt: "2026-10-29T00:00:00Z", expiresAt: "2026-11-29T00:00:00Z", revokedAt: null, active: true, totalViews: 0, lastViewedAt: null });
  function stubLinks(routes: Record<string, unknown>) {
    const fetchStub = vi.fn(async (url: string) => (url in routes ? new Response(JSON.stringify(routes[url]), { status: 200 }) : new Response("{}", { status: 404 })));
    vi.stubGlobal("fetch", fetchStub);
    return fetchStub;
  }
  async function open(target: Parameters<typeof requestShare>[0]) {
    act(() => root.render(createElement(ToastProvider, null, createElement(ShareLinkDialogHost))));
    await act(async () => { requestShare(target); });
    await flush();
  }
  const dialogText = () => document.body.textContent ?? "";

  it("says which shared folders also expose a document, and switches to that folder's links", async () => {
    const fetchStub = stubLinks({
      "/api/documents/d1/share-links": { links: [], viaFolders: [{ folderNodeId: "n1", name: "Handbook" }] },
      "/api/tree-nodes/n1/share-links": { links: [link("L1")] },
    });
    await open({ documentId: "d1" });
    expect(dialogText()).toContain("Also visible through the shared folder Handbook");
    const button = Array.from(document.body.querySelectorAll("button")).find((candidate) => candidate.textContent === "Handbook")!;
    // Tabbed to on its own, it says what it does and that Handbook is a folder, not only the name.
    expect(button.getAttribute("aria-label")).toBe("Handbook — open share links for this folder");
    await act(async () => { button.click(); });
    await flush();
    expect(fetchStub).toHaveBeenCalledWith("/api/tree-nodes/n1/share-links", expect.anything());
    expect(document.body.querySelector('[data-share-link="/s/L1"]')).not.toBeNull();
    expect(dialogText()).toContain("Share folder Handbook");
    expect(dialogText()).not.toContain("Also visible through");
  });

  it("retargets a document reminder to its shared source", async () => {
    const fetchStub = stubLinks({
      "/api/documents/d1/share-links": { links: [], viaSources: [{ sourceId: "s1", name: "Notes" }] },
      "/api/sources/s1/share-links": { links: [] },
    });
    await open({ documentId: "d1" });
    expect(dialogText()).toContain("Also visible through the shared source Notes");
    await act(async () => { Array.from(document.body.querySelectorAll("button")).find(b => b.textContent === "Notes")!.click(); });
    await flush();
    expect(fetchStub).toHaveBeenCalledWith("/api/sources/s1/share-links", expect.anything());
    expect(dialogText()).toContain("Share source Notes");
  });

  it("shows no such line for a document no shared folder reaches", async () => {
    stubLinks({ "/api/documents/d1/share-links": { links: [], viaFolders: [] } });
    await open({ documentId: "d1" });
    expect(dialogText()).not.toContain("Also visible through");
  });

  it("opens for a folder from its own links, titled with its name", async () => {
    const fetchStub = stubLinks({ "/api/tree-nodes/n1/share-links": { links: [] } });
    await open({ folderNodeId: "n1", name: "Runbooks" });
    expect(fetchStub).toHaveBeenCalledWith("/api/tree-nodes/n1/share-links", expect.anything());
    expect(dialogText()).toContain("Share folder Runbooks");
    expect(dialogText()).toContain("every document in this folder");
  });

  it("tells the tree when a link is made, and creates it on the folder's route", async () => {
    const fetchStub = stubLinks({ "/api/tree-nodes/n1/share-links": { links: [], link: link("NEW") } });
    const changed = vi.fn();
    window.addEventListener(SHARE_LINKS_CHANGED_EVENT, changed);
    try {
      await open({ folderNodeId: "n1", name: "Runbooks" });
      await act(async () => { document.body.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
      await flush();
    } finally {
      window.removeEventListener(SHARE_LINKS_CHANGED_EVENT, changed);
    }
    expect(fetchStub).toHaveBeenCalledWith("/api/tree-nodes/n1/share-links", expect.objectContaining({ method: "POST" }));
    expect(changed).toHaveBeenCalledTimes(1);
  });
});
