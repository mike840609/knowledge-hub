// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { SourceSidebar } from "@/components/knowledge/source-sidebar";
import type { SourceView } from "@/modules/knowledge/application/knowledge-query-service";

const shortcuts = vi.hoisted(() => ({ current: { favorites: [] as string[], recent: [] as string[], ready: true } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/w/w/knowledge/a", useSearchParams: () => new URLSearchParams(), useParams: () => ({}) }));
vi.mock("next/link", () => ({ default: ({ children, onClick, ...props }: React.ComponentProps<"a">) => <a {...props} onClick={(event) => { onClick?.(event); event.preventDefault(); }}>{children}</a> }));
vi.mock("@/components/shell/use-workspace-authorization", () => ({ useWorkspaceAuthorization: () => ({ access: { actions: {}, workspace: { type: "PERSONAL" } }, confirmed: true }) }));
vi.mock("@/components/knowledge/use-document-shortcuts", () => ({ useDocumentShortcuts: () => ({ shortcuts: { favorites: shortcuts.current.favorites, recent: shortcuts.current.recent }, ready: shortcuts.current.ready, update: vi.fn() }), documentShortcutKey: (s: string, d: string) => `${s}:${d}` }));
vi.mock("@/components/knowledge/use-tree-mutations", () => ({ useTreeMutations: () => ({}) }));
vi.mock("@/components/actions/action-menu", () => ({ useActionRunner: () => vi.fn() }));
vi.mock("@/components/actions/action-registry", () => ({ actionsFor: () => [] }));
vi.mock("@/components/knowledge/knowledge-tree", () => ({ KnowledgeTree: () => null }));
vi.mock("@/components/ui/tooltip", () => ({ Tooltip: ({ children }: { children: React.ReactNode }) => children }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const sources = [{ id: "a", name: "Alpha", status: "ACTIVE", ownership: "HUB_MANAGED", sourceType: "HUB" }] as SourceView[];
const tree = Array.from({ length: 6 }, (_, index) => ({
  type: "document" as const,
  id: `node-${index + 1}`,
  parentId: null,
  documentId: `d${index + 1}`,
  label: `Recent ${index + 1}`,
  currentRevisionId: `rev-${index + 1}`,
  position: index,
  status: "ACTIVE" as const,
  pageIcon: index === 0 ? "📌" : null,
}));

const ensureTree = async () => {};
let selectedDocumentId: string | undefined;
let loadedTree = true;
function Host() {
  return <SourceSidebar workspaceId="w" source={sources[0]} sources={sources}
    collections={loadedTree ? [{ source: sources[0], tree }] : []}
    ensureTree={ensureTree} selectedDocumentId={selectedDocumentId} includeArchived={false} />;
}

let cleanup: () => Promise<void>;
afterEach(async () => {
  await cleanup?.();
  document.body.innerHTML = "";
  localStorage.clear();
  sessionStorage.clear();
  selectedDocumentId = undefined;
  loadedTree = true;
  sources[0].ownership = "HUB_MANAGED";
  sources[0].status = "ACTIVE";
  shortcuts.current = { favorites: [], recent: [], ready: true };
});

async function mount(fetcher = vi.fn().mockResolvedValue(Response.json({ documents: [] }))) {
  vi.stubGlobal("fetch", vi.fn((url: string) => url.includes("/sidebar-shortcuts?") ? fetcher() : Promise.resolve(Response.json({ folders: [] }))));
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const render = () => act(async () => root.render(<Host />));
  cleanup = async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); };
  await render();
  return render;
}

async function click(element: Element | null) {
  expect(element).not.toBeNull();
  await act(async () => {
    element!.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    element!.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
    element!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}
function clock() { return document.querySelector('button[aria-label="Recent documents"]'); }
function menu() { return document.querySelector('[role="menu"]'); }
function menuHrefs() { return [...(menu()?.querySelectorAll("a") ?? [])].map(link => link.getAttribute("href")); }
const href = (id: number) => `/w/w/knowledge/a/d${id}`;
const recent = ["a:d1", "a:d2", "a:d3", "a:d4", "a:d5", "a:d6"];

it("keeps recents out of the tree and makes every eligible recent reachable from the clock", async () => {
  shortcuts.current.recent = recent;
  sources[0].ownership = "SOURCE_MANAGED";
  await mount();
  expect(document.querySelector('section[aria-label="Recent documents"]')).toBeNull();
  expect(document.querySelector('nav[aria-label="Document tree"]')?.textContent).not.toContain("Recent 1");
  await click(clock());
  expect(menuHrefs()).toEqual([href(1), href(2), href(3), href(4), href(5), href(6)]);
  const first = menu()!.querySelector("a")!;
  expect(first.textContent).toContain("📌");
  expect(first.textContent).toContain("Alpha");
  expect(first.querySelector('[data-read-only-cue]')).not.toBeNull();
  expect(document.getElementById(first.getAttribute("aria-describedby")!)?.textContent).toContain("read-only");
});

it("closes after selection and uses updated history on reopening", async () => {
  shortcuts.current.recent = recent;
  const render = await mount();
  await click(clock());
  await click(menu()!.querySelector(`a[href="${href(3)}"]`));
  expect(clock()?.getAttribute("aria-expanded")).toBe("false");
  selectedDocumentId = "d3";
  shortcuts.current.recent = ["a:d3", "a:d6", "a:d1"];
  await render();
  await click(clock());
  expect(menuHrefs()).toEqual([href(6), href(1)]);
});

it("does not reorder an open menu when history changes, but still removes ineligible entries", async () => {
  shortcuts.current.recent = recent;
  const render = await mount();
  await click(clock());
  shortcuts.current.recent = ["a:d6", "a:d5", "a:d4", "a:d3", "a:d2", "a:d1"];
  await render();
  expect(menuHrefs()).toEqual([href(1), href(2), href(3), href(4), href(5), href(6)]);
  shortcuts.current.favorites = ["a:d2"];
  await render();
  expect(menuHrefs()).toEqual([href(1), href(3), href(4), href(5), href(6)]);
});

it("preserves favorite, current-document, and unavailable-document exclusions", async () => {
  shortcuts.current.recent = ["a:missing", ...recent];
  shortcuts.current.favorites = ["a:d1"];
  selectedDocumentId = "d2";
  await mount();
  await click(clock());
  expect(menuHrefs()).toEqual([href(3), href(4), href(5), href(6)]);
  expect(document.querySelector('section[aria-label="Favorites"]')?.textContent).toContain("Recent 1");
});

it("keeps the clock available for genuinely empty history", async () => {
  await mount();
  await click(clock());
  expect(menu()?.textContent).toContain("No recent documents");
});

it("shows loading while history loads and populates a menu opened before it is ready", async () => {
  shortcuts.current.ready = false;
  const render = await mount();
  await click(clock());
  expect(menu()?.textContent).toContain("Loading recent documents");
  expect(menu()?.textContent).not.toContain("No recent documents");
  shortcuts.current = { ready: true, favorites: [], recent: ["a:d1"] };
  await render();
  expect(menuHrefs()).toEqual([href(1)]);
});

it("waits for unloaded document metadata before deciding history is empty", async () => {
  loadedTree = false;
  shortcuts.current.recent = ["a:d1"];
  let answer!: (response: Response) => void;
  await mount(vi.fn(() => new Promise<Response>(resolve => { answer = resolve; })));
  await click(clock());
  expect(menu()?.textContent).toContain("Loading recent documents");
  expect(menu()?.textContent).not.toContain("No recent documents");
  await act(async () => answer(Response.json({ documents: [{ documentId: "d1", sourceId: "a", label: "Arrived", sourceName: "Alpha", ownership: "HUB_MANAGED", pageIcon: null }] })));
  expect(menuHrefs()).toEqual([href(1)]);
  expect(menu()?.textContent).toContain("Arrived");
});

it("offers retry for failed metadata rather than reporting empty history", async () => {
  loadedTree = false;
  shortcuts.current.recent = ["a:d1"];
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({}, { status: 503 }))
    .mockResolvedValueOnce(Response.json({ documents: [{ documentId: "d1", sourceId: "a", label: "Recovered", sourceName: "Alpha", ownership: "HUB_MANAGED", pageIcon: null }] }));
  await mount(fetcher);
  await click(clock());
  expect(menu()?.textContent).toContain("could not be loaded");
  expect(menu()?.textContent).not.toContain("No recent documents");
  await click([...menu()!.querySelectorAll('button,[role="menuitem"]')].find(el => el.textContent === "Retry") ?? null);
  expect(menu()?.textContent).toContain("Recovered");
});

it("removes links when their loaded source becomes archived", async () => {
  shortcuts.current.recent = ["a:d1"];
  const render = await mount();
  await click(clock());
  expect(menuHrefs()).toEqual([href(1)]);
  sources[0] = { ...sources[0], status: "ARCHIVED" };
  await render();
  expect(menuHrefs()).toEqual([]);
  expect(menu()?.textContent).toContain("No recent documents");
});

it("keeps links from unloaded sources visible when background history reorders", async () => {
  loadedTree = false;
  shortcuts.current.recent = ["a:d1", "a:d2"];
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ documents: [
    { documentId: "d1", sourceId: "a", label: "First", sourceName: "Alpha", ownership: "HUB_MANAGED", pageIcon: null },
    { documentId: "d2", sourceId: "a", label: "Second", sourceName: "Alpha", ownership: "HUB_MANAGED", pageIcon: null },
  ] })).mockImplementation(() => new Promise(() => {}));
  const render = await mount(fetcher);
  await click(clock());
  expect(menuHrefs()).toEqual([href(1), href(2)]);
  shortcuts.current.recent = ["a:d2", "a:d1"];
  await render();
  expect(menuHrefs()).toEqual([href(1), href(2)]);
});

it("accepts the first history update in an already open empty menu then freezes order", async () => {
  const render = await mount();
  await click(clock());
  expect(menu()?.textContent).toContain("No recent documents");
  shortcuts.current.recent = ["a:d1", "a:d2"];
  await render();
  expect(menuHrefs()).toEqual([href(1), href(2)]);
  shortcuts.current.recent = ["a:d2", "a:d1"];
  await render();
  expect(menuHrefs()).toEqual([href(1), href(2)]);
});

it.each([false, true])("keeps unloaded-source recents when unrelated favorite metadata is pending/fails (failure=%s)", async failure => {
  loadedTree = false;
  shortcuts.current.recent = ["a:d1"];
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ documents: [
    { documentId: "d1", sourceId: "a", label: "First", sourceName: "Alpha", ownership: "HUB_MANAGED", pageIcon: null },
  ] })).mockImplementation(() => failure ? Promise.resolve(Response.json({}, { status: 503 })) : new Promise(() => {}));
  const render = await mount(fetcher);
  await click(clock());
  expect(menuHrefs()).toEqual([href(1)]);
  shortcuts.current.favorites = ["a:d6"];
  await render();
  expect(menuHrefs()).toEqual([href(1)]);
  expect(menu()?.textContent).not.toContain("could not be loaded");
  expect(menu()?.textContent).not.toContain("Loading recent documents");
});

it.each(["current", "favorite", "unavailable"])("waits for visible items before freezing a %s-only history", async kind => {
  shortcuts.current.recent = kind === "unavailable" ? ["a:missing"] : ["a:d1"];
  if (kind === "current") selectedDocumentId = "d1";
  if (kind === "favorite") shortcuts.current.favorites = ["a:d1"];
  const render = await mount();
  await click(clock());
  expect(menuHrefs()).toEqual([]);
  shortcuts.current.recent = ["a:d2", "a:d3", ...shortcuts.current.recent];
  await render();
  expect(menuHrefs()).toEqual([href(2), href(3)]);
  shortcuts.current.recent = ["a:d3", "a:d2"];
  await render();
  expect(menuHrefs()).toEqual([href(2), href(3)]);
});
