// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi, afterEach } from "vitest";
import { ShareManagementView } from "@/components/knowledge/share-management-view";
import type { ManagedShareLink } from "@/modules/knowledge/domain/share-management";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => vi.fn() }));
vi.mock("@/components/shell/use-workspace-authorization", () => ({ requestWorkspaceAccessCheck: vi.fn() }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => vi.unstubAllGlobals());
it("requires confirmation before revoke and disables copying after success", async () => {
  let posts = 0; vi.stubGlobal("fetch", async () => { posts++; return new Response(null, { status: 204 }); });
  const item: ManagedShareLink = { id: "link", documentId: "doc", sourceId: "source", title: "Guide", sourceName: "Wiki", label: "For team", path: "/s/token", status: "active", createdAt: new Date(), expiresAt: new Date(Date.now()+86400000), revokedAt: null, totalViews: 3, lastViewedAt: null };
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
  const item: ManagedShareLink = { id: "link", documentId: "doc", sourceId: "source", title: "Guide", sourceName: "Wiki", label: null, path: "/s/token", status: "active", createdAt: new Date(), expiresAt: new Date(Date.now()+86400000), revokedAt: null, totalViews: 0, lastViewedAt: null };
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
