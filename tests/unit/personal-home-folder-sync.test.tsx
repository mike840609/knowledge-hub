import { beforeEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PersonalHome } from "@/components/knowledge/personal-home";
const state = vi.hoisted(() => ({ favorites: [] as string[], recent: [] as string[], openedAt: {} as Record<string, string> }));
beforeEach(() => { state.favorites = []; state.recent = []; state.openedAt = {}; });
vi.mock("@/components/knowledge/use-document-shortcuts", () => ({
  useDocumentShortcuts: () => ({
    shortcuts: state,
    update: () => {},
  }),
  documentShortcutKey: (a: string, b: string) => `${a}:${b}`,
}));
vi.mock("@/components/shell/use-workspace-authorization", () => ({
  useWorkspaceAuthorization: () => ({
    confirmed: true,
    access: { actions: { canImport: true } },
  }),
}));
vi.mock("@/components/actions/action-menu", () => ({
  useActionRunner: () => () => {},
  RowContextMenu: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  RowActionsTrigger: () => null,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => () => {} }));
vi.mock("@/components/knowledge/share-link-dialog", () => ({
  ShareLinkDialogHost: () => null,
}));
it("offers search, continuing work, attention, favorites and updates in task order", () => {
  const html = renderToStaticMarkup(
    <PersonalHome workspaceId="ws" documents={[]} drafts={[]} />,
  );
  // The Home trigger opens the existing palette instead of mounting a second search dialog.
  expect(html).not.toContain('role="search"');
  expect(html).not.toContain('/sources/import');
  expect(html).toContain("New note");
  expect(html).toContain("Search articles and notes");
  expect(html.indexOf("Continue working")).toBeLessThan(html.indexOf("Needs your attention"));
  expect(html.indexOf("Needs your attention")).toBeLessThan(html.indexOf("Favorites"));
  expect(html.indexOf("Favorites")).toBeLessThan(html.indexOf("Knowledge updates"));
  expect(html).not.toContain("My folders");
  expect(html).not.toContain("Continue writing");
  expect(html).not.toContain("Your notes");
  expect(html).not.toContain("Knowledge freshness");
  expect(html).toContain("Browse knowledge");
  expect(html).toContain("Notes you write and documents you open will appear here.");
});

it("merges recent activity and recoverable drafts without duplicating or exposing archived documents", () => {
  const doc = { sourceId: "source", documentId: "doc", title: "Saved note", ownership: "HUB_MANAGED" as const, status: "ACTIVE" as const, sourceStatus: "ACTIVE" as const, updatedAt: "2026-10-16T00:00:00Z" };
  state.recent = ["source:doc", "source:archived", "source:reading"];
  state.openedAt = { "source:reading": "2026-10-17T12:00:00Z" };
  const html = renderToStaticMarkup(<PersonalHome workspaceId="ws" documents={[
    doc,
    { ...doc, documentId: "archived", title: "Archived note", status: "ARCHIVED" },
    { ...doc, documentId: "reading", title: "Recent reading", ownership: "SOURCE_MANAGED" },
  ]} drafts={[
    { key: "draft:doc", title: "Recover this text", sourceId: "source", updatedAt: "2026-10-17T10:00:00Z" },
    { key: "draft:archived", title: "Archived draft", sourceId: "source", updatedAt: "2026-10-17T13:00:00Z" },
    { key: "draft:new", title: "New unfinished note", sourceId: null, updatedAt: "2026-10-17T11:00:00Z" },
  ]} />);
  expect(html).not.toContain("Saved note");
  expect(html).not.toContain("Archived note");
  expect(html).not.toContain("Archived draft");
  expect(html).toContain('/knowledge/source/doc/edit');
  expect(html.indexOf("Recent reading")).toBeLessThan(html.indexOf("New unfinished note"));
  expect(html.indexOf("New unfinished note")).toBeLessThan(html.indexOf("Recover this text"));
});

it("keeps favorites in saved order regardless of reading order", () => {
  const doc = { sourceId: "source", documentId: "a", title: "Favorite A", ownership: "SOURCE_MANAGED" as const, status: "ACTIVE" as const, sourceStatus: "ACTIVE" as const, updatedAt: "2026-10-16T00:00:00Z" };
  state.favorites = ["source:b", "source:a"];
  state.recent = ["source:a", "source:b"];
  const html = renderToStaticMarkup(<PersonalHome workspaceId="ws" documents={[doc, { ...doc, documentId: "b", title: "Favorite B" }]} drafts={[]} />);
  const favorites = html.split('aria-label="Favorites"')[1];
  expect(favorites.indexOf("Favorite B")).toBeLessThan(favorites.indexOf("Favorite A"));
});

it("offers inline guide recovery only when dismissed and the workspace has no documents", () => {
  const render = (dismissed: boolean, documents: React.ComponentProps<typeof PersonalHome>["documents"] = []) =>
    renderToStaticMarkup(<PersonalHome workspaceId="ws" documents={documents} drafts={[]} guidanceDismissed={dismissed} />);
  expect(render(true)).toContain("Show getting started guide");
  expect(render(false)).not.toContain("Show getting started guide");
  expect(render(true, [{ sourceId: "source", documentId: "doc", title: "Unread note", ownership: "HUB_MANAGED", status: "ACTIVE", sourceStatus: "ACTIVE", updatedAt: "2026-10-09T00:00:00Z" }])).not.toContain("Show getting started guide");
});
