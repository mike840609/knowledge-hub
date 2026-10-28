// @vitest-environment jsdom
import { act, useMemo } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { SourceSidebar } from "@/components/knowledge/source-sidebar";
import { useSourceTrees } from "@/components/knowledge/use-source-trees";
import type { SourceView } from "@/modules/knowledge/application/knowledge-query-service";

const shortcuts = vi.hoisted(() => ({ current: { favorites: [] as string[], recent: [] as string[], ready: true } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/w/w/knowledge/a", useSearchParams: () => new URLSearchParams(), useParams: () => ({}) }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.ComponentProps<"a">) => <a {...props}>{children}</a> }));
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

function Host() {
  const seed = useMemo(() => [{ source: sources[0], tree }], []);
  const trees = useSourceTrees("w", sources, seed);
  return <SourceSidebar workspaceId="w" source={sources[0]} sources={sources} collections={trees.collections} treeStates={trees.states} ensureTree={trees.ensure} retryTree={trees.retry} includeArchived />;
}

let cleanup: () => Promise<void>;
afterEach(async () => {
  await cleanup?.();
  document.body.innerHTML = "";
  shortcuts.current = { favorites: [], recent: [], ready: true };
});

async function mount() {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ tree: [] })));
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  cleanup = async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); };
  await act(async () => root.render(<Host />));
}

it("lists four recents in place and the rest behind Show all", async () => {
  shortcuts.current = { favorites: [], recent: ["a:d1", "a:d2", "a:d3", "a:d4", "a:d5", "a:d6"], ready: true };
  await mount();

  const recent = document.querySelector('section[aria-label="Recent documents"]');
  expect(recent?.textContent).toContain("Recent 4");
  expect(recent?.textContent).not.toContain("Recent 5");
  const showAll = [...(recent?.querySelectorAll("button") ?? [])].find((button) => button.textContent?.includes("Show all 6"));
  expect(showAll).toBeTruthy();
  expect(showAll?.getAttribute("aria-haspopup")).toBe("menu");

  await act(async () => {
    showAll!.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    showAll!.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
    showAll!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
  expect(document.body.textContent).toContain("Recent 5");
  expect(document.body.textContent).toContain("Recent 6");
});
