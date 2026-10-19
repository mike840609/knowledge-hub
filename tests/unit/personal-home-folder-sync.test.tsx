import { beforeEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PersonalHome } from "@/components/knowledge/personal-home";
const shortcuts = vi.hoisted(() => ({ value: { favorites: [] as string[], recent: [] as string[] } as { favorites: string[]; recent: string[]; openedAt?: Record<string, string> } }));
vi.mock("@/components/knowledge/use-document-shortcuts", () => ({
  useDocumentShortcuts: () => ({ shortcuts: shortcuts.value, update: () => {} }),
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
beforeEach(() => { shortcuts.value = { favorites: [], recent: [] }; });

const doc = (id: string, over = {}) => ({ sourceId: "src", documentId: id, title: `Doc ${id}`, ownership: "HUB_MANAGED" as const, status: "ACTIVE" as const, sourceStatus: "ACTIVE" as const, updatedAt: "2026-10-09T00:00:00.000Z", ...over });

it("leads with Recent and Favorites, leaves search to ⌘K and the change feed to /updates", () => {
  const html = renderToStaticMarkup(<PersonalHome workspaceId="ws" documents={[]} drafts={[]} />);
  expect(html).not.toContain('role="search"');
  expect(html).not.toContain("/sources/import");
  expect(html).toContain("New note");
  expect(html).toContain('aria-label="Recent"');
  expect(html).toContain('aria-label="Favorites"');
  expect(html.indexOf('aria-label="Recent"')).toBeLessThan(html.indexOf('aria-label="Favorites"'));
  expect(html).not.toContain('aria-label="Drafts"');
  expect(html).not.toContain('aria-label="Updates"');
  expect(html).not.toContain('role="tablist"');
  expect(html).not.toContain("Needs attention");
  expect(html).toContain("Browse knowledge");
  expect(html).toContain("Documents you edit or open will appear here.");
  expect(html).toContain("Star a document to keep it here.");
});

it("puts drafts above Recent, counted in the accent, and edits in muted text", () => {
  const html = renderToStaticMarkup(<PersonalHome workspaceId="ws" documents={[doc("a"), doc("b", { updatedAt: "2026-10-01T00:00:00.000Z" })]} drafts={[{ key: "draft:a", title: "Doc a", sourceId: "src", updatedAt: "2026-10-02T00:00:00.000Z" }]} />);
  const drafts = html.slice(html.indexOf('aria-label="Drafts"'), html.indexOf('aria-label="Recent"'));
  expect(html.indexOf('aria-label="Drafts"')).toBeGreaterThan(-1);
  expect(drafts).toContain('href="/w/ws/knowledge/src/a/edit"');
  expect(drafts).toMatch(/text-kh-selected-text[^"]*">1</);
  const recent = html.slice(html.indexOf('aria-label="Recent"'), html.indexOf('aria-label="Favorites"'));
  expect(recent).toContain('href="/w/ws/knowledge/src/b"');
  expect(recent).not.toContain('href="/w/ws/knowledge/src/a"');
  expect(recent).toMatch(/text-kh-text-muted[^"]*">Edited/);
});

it("lists favourites in favourites order with a filled star", () => {
  shortcuts.value = { favorites: ["src:b", "src:a"], recent: [] };
  const html = renderToStaticMarkup(<PersonalHome workspaceId="ws" documents={[doc("a", { ownership: "SOURCE_MANAGED" }), doc("b", { ownership: "SOURCE_MANAGED" })]} drafts={[]} />);
  const favorites = html.slice(html.indexOf('aria-label="Favorites"'));
  expect(favorites.indexOf("Doc b")).toBeLessThan(favorites.indexOf("Doc a"));
  expect(favorites).toContain("Remove favorite: Doc b");
  expect(favorites).not.toContain("Star a document to keep it here.");
});

it("offers inline guide recovery only when dismissed and the workspace has no documents", () => {
  const render = (dismissed: boolean, documents: React.ComponentProps<typeof PersonalHome>["documents"] = []) =>
    renderToStaticMarkup(<PersonalHome workspaceId="ws" documents={documents} drafts={[]} guidanceDismissed={dismissed} />);
  expect(render(true)).toContain("Show getting started guide");
  expect(render(false)).not.toContain("Show getting started guide");
  expect(render(true, [{ sourceId: "source", documentId: "doc", title: "Unread note", ownership: "HUB_MANAGED", status: "ACTIVE", sourceStatus: "ACTIVE", updatedAt: "2026-10-09T00:00:00Z" }])).not.toContain("Show getting started guide");
});

it("renders the attention strip when reminders or notices are passed in", () => {
  const reminders = [{ sourceId: "s1", sourceName: "Folder", status: "old" as const, previewId: null, lastImportedAt: null }];
  const notices = [{ id: "n1", workspaceId: "ws", sourceId: "src", documentId: "a", threadId: "t1", commentId: "c1", documentTitle: "Plan", authorName: "Ana", excerpt: "Looks good", createdAt: "2026-10-18T00:00:00.000Z", readAt: null, threadStatus: "OPEN" as const }];
  const withReminders = renderToStaticMarkup(<PersonalHome workspaceId="ws" documents={[]} drafts={[]} reminders={reminders} />);
  expect(withReminders).toContain('aria-label="Needs attention"');
  const withNotices = renderToStaticMarkup(<PersonalHome workspaceId="ws" documents={[]} drafts={[]} notices={notices} />);
  expect(withNotices).toContain('aria-label="Unread discussions"');
  expect(withNotices.indexOf('aria-label="Needs attention"')).toBeLessThan(withNotices.indexOf('aria-label="Recent"'));
});

it("labels an untimed recent as Opened without a time", () => {
  shortcuts.value = { favorites: [], recent: ["src:a"] };
  const html = renderToStaticMarkup(<PersonalHome workspaceId="ws" documents={[doc("a", { ownership: "SOURCE_MANAGED" })]} drafts={[]} />);
  expect(html).toContain('href="/w/ws/knowledge/src/a"');
  expect(html).toMatch(/text-kh-text-muted[^"]*">Opened/);
});

it("names a document's source only when Home spans more than one source", () => {
  const one = renderToStaticMarkup(<PersonalHome workspaceId="ws" documents={[doc("a", { sourceName: "Notes" }), doc("b", { sourceName: "Notes" })]} drafts={[{ key: "draft:new", title: "Fresh", sourceId: null, updatedAt: "2026-10-02T00:00:00.000Z" }]} />);
  expect(one).not.toContain(">Notes<");
  expect(one).not.toContain("Continue writing");
  const two = renderToStaticMarkup(<PersonalHome workspaceId="ws" documents={[doc("a", { sourceName: "Notes" }), doc("b", { sourceId: "team", sourceName: "Team wiki", sourcePath: "guides/setup.md" })]} drafts={[]} />);
  expect(two).toContain(">Notes<");
  expect(two).toContain(">Team wiki · guides/setup.md<");
});
