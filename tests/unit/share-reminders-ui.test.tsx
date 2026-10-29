// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestShare } from "@/components/actions/action-menu";
import { KnowledgeTree } from "@/components/knowledge/knowledge-tree";
import { ShareLinkDialogHost } from "@/components/knowledge/share-link-dialog";
import { SHARE_LINKS_CHANGED_EVENT, useSharedFolderIds } from "@/components/knowledge/shared-folders";
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
    onToggleFavorite: () => {}, documentActions: () => [], folderActions: () => [], onRunAction: () => {}, onReorder: async () => true,
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

describe("useSharedFolderIds", () => {
  function Probe({ enabled }: { enabled: boolean }) {
    const ids = useSharedFolderIds("w1", enabled);
    return createElement("p", { "data-ids": [...ids].join(",") });
  }
  const seen = () => container.querySelector("p")!.getAttribute("data-ids");

  it("reads once, and again when the dialog says a link was made or revoked", async () => {
    let folders = [{ folderNodeId: "a", name: "A" }];
    const fetchStub = vi.fn(async () => new Response(JSON.stringify({ folders }), { status: 200 }));
    vi.stubGlobal("fetch", fetchStub);
    act(() => root.render(createElement(Probe, { enabled: true })));
    await flush();
    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(fetchStub.mock.calls[0]).toEqual(["/api/workspaces/w1/shared-folders", { cache: "no-store" }]);
    expect(seen()).toBe("a");
    folders = [];
    act(() => { window.dispatchEvent(new Event(SHARE_LINKS_CHANGED_EVENT)); });
    await flush();
    expect(fetchStub).toHaveBeenCalledTimes(2);
    expect(seen()).toBe("");
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
    expect(button.getAttribute("aria-label")).toBe("Open share links for folder Handbook");
    await act(async () => { button.click(); });
    await flush();
    expect(fetchStub).toHaveBeenCalledWith("/api/tree-nodes/n1/share-links", expect.anything());
    expect(document.body.querySelector('[data-share-link="/s/L1"]')).not.toBeNull();
    expect(dialogText()).toContain("Share folder Handbook");
    expect(dialogText()).not.toContain("Also visible through");
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
