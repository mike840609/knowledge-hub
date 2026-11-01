// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi, afterEach } from "vitest";
import { ShareManagementView } from "@/components/knowledge/share-management-view";
import type { ManagedShareLink } from "@/modules/knowledge/domain/share-management";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => vi.fn() }));
vi.mock("@/components/shell/use-workspace-authorization", () => ({ requestWorkspaceAccessCheck: vi.fn() }));
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

it("puts the count on the toolbar row and hides the copy action at rest", async () => {
  const item: ManagedShareLink = { id: "link", documentId: "doc", sourceId: "source", title: "Guide", sourceName: "Wiki", label: "For team", path: "/s/token", status: "active", createdAt: new Date(), expiresAt: new Date(Date.now() + 86400000), revokedAt: null, totalViews: 3, lastViewedAt: null };
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<ShareManagementView workspaceId="ws" model={{ items: [item], query: { q: "", status: "all", page: 1 }, hasNext: false }} />));
    const count = host.querySelector('[role="status"]')!;
    expect(count.textContent).toBe("1 share");
    expect(count.className).toContain("ml-auto");
    const search = host.querySelector<HTMLInputElement>("#shares-query")!;
    expect(search.parentElement?.className).toContain("sm:w-72");
    expect(search.parentElement?.className).not.toContain("sm:flex-1");
    expect(search.closest("form")?.className).toContain("w-full");
    const copy = host.querySelector('button[aria-label="Copy link for Guide · For team"]')!;
    expect(copy.className).toContain("kh-row-action");
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("shows no count when the list is empty", async () => {
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<ShareManagementView workspaceId="ws" model={{ items: [], query: { q: "", status: "active", page: 1 }, hasNext: false }} />));
    expect(host.querySelector('[role="status"]')).toBeNull();
    expect(host.textContent).toContain("No active share links.");
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("keeps the focused search draft when an older server query arrives", async () => {
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const model = (q: string) => ({ items: [], query: { q, status: "all" as const, page: 1 }, hasNext: false });
  try {
    await act(async () => root.render(<ShareManagementView workspaceId="ws" model={model("guidebook")} />));
    const input = host.querySelector<HTMLInputElement>("#shares-query")!;
    await act(async () => input.focus());
    await act(async () => root.render(<ShareManagementView workspaceId="ws" model={model("guide")} />));
    expect(input.value).toBe("guidebook");
    await act(async () => {
      window.history.replaceState(null, "", "?q=previous");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(input.value).toBe("previous");
    await act(async () => input.blur());
    await act(async () => root.render(<ShareManagementView workspaceId="ws" model={model("other")} />));
    expect(input.value).toBe("previous");
    await act(async () => root.render(<ShareManagementView workspaceId="ws" model={model("previous")} />));
    expect(input.value).toBe("previous");
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("does not overwrite typed search after blur when an older response arrives", async () => {
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const model = (q: string) => ({ items: [], query: { q, status: "all" as const, page: 1 }, hasNext: false });
  try {
    await act(async () => root.render(<ShareManagementView workspaceId="ws" model={model("guide")} />));
    const input = host.querySelector<HTMLInputElement>("#shares-query")!;
    await act(async () => {
      input.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "guidebook");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(input.value).toBe("guidebook");
    await act(async () => input.blur());
    await act(async () => root.render(<ShareManagementView workspaceId="ws" model={model("guides")} />));
    expect(input.value).toBe("guidebook");
    await act(async () => root.render(<ShareManagementView workspaceId="ws" model={model("guidebook")} />));
    await act(async () => root.render(<ShareManagementView workspaceId="ws" model={model("guide")} />));
    expect(input.value).toBe("guidebook");
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("does not clear the current search on a modified Clear filters click", async () => {
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<ShareManagementView workspaceId="ws" model={{ items: [], query: { q: "guide", status: "all", page: 1 }, hasNext: false }} />));
    const input = host.querySelector<HTMLInputElement>("#shares-query")!;
    const clear = [...host.querySelectorAll("a")].find(a => a.textContent === "Clear filters")!;
    await act(async () => clear.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, metaKey: true, button: 0 })));
    expect(input.value).toBe("guide");
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("reconciles a pending draft when a pagination Link is chosen", async () => {
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const model = { items: [], query: { q: "guide", status: "all" as const, page: 2 }, hasNext: true };
  try {
    await act(async () => root.render(<ShareManagementView workspaceId="ws" model={model} />));
    const input = host.querySelector<HTMLInputElement>("#shares-query")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "draft");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(input.value).toBe("draft");
    const form = host.querySelector("form")!;
    const cancelled = vi.fn();
    form.addEventListener("kh:live-search-cancel", cancelled);
    const next = [...host.querySelectorAll("a")].find(a => a.textContent === "Next")!;
    const prevent = (event: MouseEvent) => event.preventDefault();
    document.addEventListener("click", prevent, { once: true });
    await act(async () => next.click());
    expect(input.value).toBe("guide");
    expect(cancelled).toHaveBeenCalledTimes(1);
    expect(next.getAttribute("href")).toContain("q=guide");
    document.removeEventListener("click", prevent);
  } finally { await act(async () => root.unmount()); host.remove(); }
});


it("cancels a queued search when opening the document, unread discussion, or browse action", async () => {
  const item: ManagedShareLink = {
    id: "link", documentId: "doc", sourceId: "source", title: "Guide",
    sourceName: "Wiki", label: null, path: "/s/token", status: "active",
    createdAt: new Date(), expiresAt: new Date(Date.now() + 86400000),
    revokedAt: null, totalViews: 0, lastViewedAt: null,
  };
  vi.stubGlobal("fetch", async () => Response.json({
    counts: [{ documentId: "doc", unreadCount: 2, latestThreadId: "thread" }],
  }));
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const prevent = (event: MouseEvent) => event.preventDefault();
  document.addEventListener("click", prevent);
  try {
    await act(async () => root.render(<ShareManagementView workspaceId="ws" model={{
      items: [item], query: { q: "", status: "active", page: 1 }, hasNext: false,
    }} />));
    const cancelled = vi.fn();
    host.querySelector("form")!.addEventListener("kh:live-search-cancel", cancelled);
    const documentLink = host.querySelector<HTMLAnchorElement>('a[href*="includeArchived=true"]')!;
    const unreadLink = host.querySelector<HTMLAnchorElement>('a[aria-label="Open 2 unread comments for Guide"]')!;
    expect(documentLink).not.toBeNull();
    expect(unreadLink).not.toBeNull();
    await act(async () => {
      documentLink.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
      unreadLink.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    });
    expect(cancelled).toHaveBeenCalledTimes(2);
    await act(async () => {
      documentLink.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, metaKey: true, button: 0 }));
    });
    expect(cancelled).toHaveBeenCalledTimes(2);
  } finally {
    document.removeEventListener("click", prevent);
    await act(async () => root.unmount());
    host.remove();
  }

  // The empty-state Browse documents link also leaves this route.
  const empty = document.createElement("div"); document.body.append(empty);
  const emptyRoot = createRoot(empty);
  try {
    await act(async () => emptyRoot.render(<ShareManagementView workspaceId="ws" model={{
      items: [], query: { q: "", status: "active", page: 1 }, hasNext: false,
    }} />));
    const cancelled = vi.fn();
    empty.querySelector("form")!.addEventListener("kh:live-search-cancel", cancelled);
    const browse = [...empty.querySelectorAll("a")].find(a => a.textContent === "Browse documents")!;
    await act(async () => { browse.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })); });
    expect(cancelled).toHaveBeenCalledOnce();
  } finally {
    await act(async () => emptyRoot.unmount());
    empty.remove();
  }
});


it("ignores an older unread-count response after a newer notification refresh", async () => {
  const responses: Array<{ resolve: (response: Response) => void; reject: (error: Error) => void }> = [];
  vi.stubGlobal("fetch", () => new Promise<Response>((resolve, reject) => {
    responses.push({ resolve, reject });
  }));
  const item: ManagedShareLink = {
    id: "link", documentId: "doc", sourceId: "source", title: "Guide",
    sourceName: "Wiki", label: null, path: "/s/token", status: "active",
    createdAt: new Date(), expiresAt: new Date(Date.now() + 86_400_000),
    revokedAt: null, totalViews: 0, lastViewedAt: null,
  };
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<ShareManagementView workspaceId="ws" model={{
      items: [item], query: { q: "", status: "active", page: 1 }, hasNext: false,
    }} />));
    expect(responses).toHaveLength(1);
    await act(async () => { window.dispatchEvent(new Event("kh:notification-changed")); });
    expect(responses).toHaveLength(2);

    // The latest refresh finishes first; its badge should survive older replies.
    await act(async () => responses[1].resolve(Response.json({
      counts: [{ documentId: "doc", unreadCount: 2, latestThreadId: "thread-2" }],
    })));
    expect(host.querySelector('a[aria-label="Open 2 unread comments for Guide"]')).not.toBeNull();

    await act(async () => responses[0].resolve(Response.json({ counts: [] })));
    expect(host.querySelector('a[aria-label="Open 2 unread comments for Guide"]')).not.toBeNull();

    // A stale failure must not erase a subsequent successful refresh either.
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    await act(async () => { window.dispatchEvent(new Event("kh:notification-changed")); });
    expect(responses).toHaveLength(4);
    await act(async () => responses[3].resolve(Response.json({
      counts: [{ documentId: "doc", unreadCount: 3, latestThreadId: "thread-3" }],
    })));
    await act(async () => responses[2].reject(new Error("stale network failure")));
    expect(host.querySelector('a[aria-label="Open 3 unread comments for Guide"]')).not.toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
