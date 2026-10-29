// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi, afterEach } from "vitest";
import { ShareManagementView } from "@/components/knowledge/share-management-view";
import type { ManagedShareLink } from "@/modules/knowledge/domain/share-management";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => vi.fn() }));
vi.mock("@/components/shell/use-workspace-authorization", () => ({ requestWorkspaceAccessCheck: vi.fn() }));
// The empty state with no documents offers the shell's start actions, which need the Workspace shell.
vi.mock("@/components/knowledge/workspace-content-actions", () => ({ WorkspaceContentActions: () => null }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => vi.unstubAllGlobals());
it("requires confirmation before revoke and disables copying after success", async () => {
  // The list now fetches unread counts on mount; only revoke POSTs are mutations.
  let posts = 0;
  vi.stubGlobal("fetch", async (_url: unknown, options?: RequestInit) => {
    if (options?.method === "POST") {
      posts++;
      return new Response(null, { status: 204 });
    }
    return Response.json({ counts: [] });
  });
  const item: ManagedShareLink = { id: "link", kind: "DOCUMENT", documentId: "doc", folderNodeId: null, sourceId: "source", title: "Guide", sourceName: "Wiki", label: "For team", path: "/s/token", status: "active", createdAt: new Date(), expiresAt: new Date(Date.now()+86400000), revokedAt: null, totalViews: 3, lastViewedAt: null };
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const click = async (name: string) => { await act(async () => [...document.querySelectorAll<HTMLElement>("button,[role=menuitem]")].find(b => (b.getAttribute("aria-label") ?? b.textContent) === name)!.click()); };
  try {
    await act(async () => root.render(<ShareManagementView workspaceId="ws" model={{ items: [item], query: { q: "", status: "all", page: 1 }, hasNext: false }} />));
    await click("Share actions for Guide · For team");
    await click("Revoke"); expect(posts).toBe(0);
    await click("Confirm revoke"); expect(posts).toBe(1);
    expect(host.textContent).toContain("Revoked");
    await click("Share actions for Guide · For team");
    const actions = [...document.querySelectorAll('[role="menuitem"]')].map(node => node.textContent);
    expect(actions).toContain("Show details"); expect(actions).not.toContain("Copy link"); expect(actions).not.toContain("Revoke");
  } finally { await act(async () => root.unmount()); host.remove(); }
});
it("selects the full share URL when clipboard writing is denied", async () => {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { throw new Error("denied"); } } });
  const item: ManagedShareLink = { id: "link", kind: "DOCUMENT", documentId: "doc", folderNodeId: null, sourceId: "source", title: "Guide", sourceName: "Wiki", label: null, path: "/s/token", status: "active", createdAt: new Date(), expiresAt: new Date(Date.now()+86400000), revokedAt: null, totalViews: 0, lastViewedAt: null };
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<ShareManagementView workspaceId="ws" model={{ items: [item], query: { q: "", status: "active", page: 1 }, hasNext: false }} />));
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Share actions for Guide · Untitled link"]')!.click());
    await act(async () => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(b => b.textContent === "Copy link")!.click());
    const field = host.querySelector<HTMLInputElement>('input[readonly]')!;
    expect(field.value).toBe(`${window.location.origin}/s/token`); expect(document.activeElement).toBe(field);
    expect(field.selectionEnd).toBe(field.value.length); expect(host.querySelector('[role="alert"]')?.textContent).toContain("copy it manually");
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it.each([
  { page: 1, hasNext: false, visible: false, previous: false, next: false },
  { page: 1, hasNext: true, visible: true, previous: false, next: true },
  { page: 2, hasNext: false, visible: true, previous: true, next: false },
  { page: 2, hasNext: true, visible: true, previous: true, next: true },
])("shows pagination only when navigation is available: $page / $hasNext", async ({ page, hasNext, visible, previous, next }) => {
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<ShareManagementView workspaceId="ws" model={{ items: [], query: { q: "guide", status: "all", page }, hasNext }} />));
    const pagination = host.querySelector('nav[aria-label="Share pages"]');
    expect(Boolean(pagination)).toBe(visible);
    if (visible) {
      expect(pagination!.textContent).toContain(`Page ${page}`);
      const links = [...pagination!.querySelectorAll("a")];
      expect(links.some(link => link.textContent === "Previous")).toBe(previous);
      expect(links.some(link => link.textContent === "Next")).toBe(next);
      for (const link of links) expect(link.href).toContain("q=guide");
    }
  } finally { await act(async () => root.unmount()); host.remove(); }
});

const folderItem: ManagedShareLink = { id: "folder-link", kind: "FOLDER", documentId: null, folderNodeId: "node", sourceId: "source", title: "Handbook", sourceName: "Wiki", label: "Onboarding", path: "/s/folder-token", status: "active", createdAt: new Date(), expiresAt: new Date(Date.now()+86400000), revokedAt: null, totalViews: 4, lastViewedAt: null };
it("draws a folder row with its source link, its own unread badge and the folder's view tooltip", async () => {
  // A document link's count on the same page must not leak onto the folder row, nor the folder's onto the document.
  const documentItem: ManagedShareLink = { ...folderItem, id: "doc-link", kind: "DOCUMENT", documentId: "doc-a", folderNodeId: null, title: "Guide" };
  vi.stubGlobal("fetch", async () => Response.json({ counts: [
    { documentId: "doc-b", shareLinkId: "folder-link", unreadCount: 2, latestThreadId: "thread-b" },
    { documentId: "doc-a", shareLinkId: null, unreadCount: 1, latestThreadId: "thread-a" },
  ] }));
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<ShareManagementView workspaceId="ws" model={{ items: [folderItem, documentItem], query: { q: "", status: "all", page: 1 }, hasNext: false }} />));
    const rows = [...host.querySelectorAll("ul[aria-label='Share links'] > li")];
    const [folder, doc] = rows;
    const title = folder.querySelector<HTMLAnchorElement>("a[data-list-row]")!;
    expect(title.getAttribute("href")).toBe("/w/ws/knowledge/source");
    expect(title.textContent).toBe("Folder Handbook"); expect(title.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    const badges = folder.querySelectorAll("a[aria-label*='unread comments']");
    expect(badges).toHaveLength(1);
    expect(badges[0].getAttribute("href")).toBe("/w/ws/knowledge/source/doc-b?thread=thread-b"); expect(badges[0].textContent).toBe("2 new");
    expect(folder.querySelector("[title='Documents opened through this link']")?.textContent).toContain("4");
    expect(doc.querySelector("a[data-list-row]")!.getAttribute("href")).toBe("/w/ws/knowledge/source/doc-a?includeArchived=true");
    expect(doc.querySelector("a[aria-label*='unread comments']")?.textContent).toBe("1 new");
    expect(doc.querySelector("[title='Documents opened through this link']")).toBeNull(); expect(doc.querySelector("svg.lucide-folder")).toBeNull();
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("heads the list for documents and folders alike, and says links come from either when there are none", async () => {
  vi.stubGlobal("fetch", async () => Response.json({ counts: [] }));
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<ShareManagementView workspaceId="ws" model={{ items: [folderItem], query: { q: "", status: "all", page: 1 }, hasNext: false }} />));
    expect(host.textContent).toContain("Shared item / link");
    expect(host.textContent).not.toContain("Document / link");
    await act(async () => root.render(<ShareManagementView workspaceId="ws" model={{ items: [], query: { q: "", status: "all", page: 1 }, hasNext: false }} />));
    expect(host.textContent).toContain("Open a document or folder and choose Share to create a link.");
    await act(async () => root.render(<ShareManagementView workspaceId="ws" hasDocuments={false} model={{ items: [], query: { q: "", status: "all", page: 1 }, hasNext: false }} />));
    expect(host.textContent).toContain("Links you share to your documents and folders appear here.");
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("names a folder row's controls as the folder's, so a document and a folder of one name differ", async () => {
  vi.stubGlobal("fetch", async () => Response.json({ counts: [{ documentId: "doc-b", shareLinkId: "folder-link", unreadCount: 2, latestThreadId: "thread-b" }] }));
  const documentItem: ManagedShareLink = { ...folderItem, id: "doc-link", kind: "DOCUMENT", documentId: "doc-a", folderNodeId: null };
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const labelled = (label: string) => host.querySelectorAll(`[aria-label="${label}"]`).length;
  try {
    await act(async () => root.render(<ShareManagementView workspaceId="ws" model={{ items: [folderItem, documentItem], query: { q: "", status: "all", page: 1 }, hasNext: false }} />));
    expect(labelled("Share actions for folder Handbook · Onboarding")).toBe(1);
    expect(labelled("Share actions for Handbook · Onboarding")).toBe(1);
    expect(labelled("Copy link for folder Handbook · Onboarding")).toBe(1);
    expect(labelled("Copy link for Handbook · Onboarding")).toBe(1);
    expect(labelled("Open 2 unread comments for folder Handbook")).toBe(1);
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Share actions for folder Handbook · Onboarding"]')!.click());
    await act(async () => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(item => item.textContent === "Show details")!.click());
    expect(labelled("Share URL for folder Handbook · Onboarding")).toBe(1);
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Share actions for folder Handbook · Onboarding"]')!.click());
    await act(async () => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(item => item.textContent === "Revoke")!.click());
    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain("for folder Handbook?");
  } finally { await act(async () => root.unmount()); host.remove(); }
});
