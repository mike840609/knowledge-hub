import { describe, beforeEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PersonalHome, isNewNoteKey } from "@/components/knowledge/personal-home";
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

it("leads with Recent and Favorites, searches through ⌘K and leaves the change feed to /updates", () => {
  const html = renderToStaticMarkup(<PersonalHome workspaceId="ws" documents={[]} drafts={[]} />);
  // The search bar is a button that opens the ⌘K palette, never a second search field.
  expect(html).not.toContain('role="search"');
  expect(html).not.toContain("<input");
  expect(html).toContain('aria-label="Search articles and notes"');
  expect(html.indexOf('aria-label="Search articles and notes"')).toBeLessThan(html.indexOf('aria-label="Recent"'));
  // The ⌘K hint takes 13px in the 40px search bar, not the 11px default.
  expect(html).toMatch(/<kbd class="[^"]*text-body-sm[^"]*">⌘K<\/kbd>/);
  expect(html).not.toContain("/sources/import");
  expect(html).toContain("New note");
  expect(html).toContain('aria-label="Recent"');
  expect(html).toContain('aria-label="Favorites"');
  expect(html.indexOf('aria-label="Recent"')).toBeLessThan(html.indexOf('aria-label="Favorites"'));
  expect(html).not.toContain('aria-label="Drafts"');
  expect(html).not.toContain('aria-label="Updates"');
  expect(html).not.toContain('role="tablist"');
  expect(html).not.toContain("Needs attention");
  expect(html).not.toContain("Browse knowledge");
  expect(html).toContain("Documents you edit or open will appear here.");
  expect(html).toContain("Star a document to keep it here.");
  expect(html).toContain('aria-label="Discussions"');
  expect(html).toMatch(/<p class="[^"]*text-caption[^"]*">No new comments or replies\.<\/p>/);
  expect(html).toContain('href="/w/ws/inbox"');
  expect(html).toContain("Open Inbox");
  expect(html.indexOf('aria-label="Discussions"')).toBeLessThan(html.indexOf('aria-label="Favorites"'));
});

it("puts drafts above Recent, counted in the accent, and edits in muted text", () => {
  const html = renderToStaticMarkup(<PersonalHome workspaceId="ws" documents={[doc("a"), doc("b", { updatedAt: "2026-10-01T00:00:00.000Z" })]} drafts={[{ key: "draft:a", title: "Doc a", sourceId: "src", updatedAt: "2026-10-02T00:00:00.000Z" }]} />);
  const drafts = html.slice(html.indexOf('aria-label="Drafts"'), html.indexOf('aria-label="Recent"'));
  expect(html.indexOf('aria-label="Drafts"')).toBeGreaterThan(-1);
  expect(drafts).toContain('href="/w/ws/knowledge/src/a"');
  expect(drafts).toMatch(/text-kh-selected-text[^"]*">1</);
  const recent = html.slice(html.indexOf('aria-label="Recent"'), html.indexOf('aria-label="Favorites"'));
  expect(recent).toContain('href="/w/ws/knowledge/src/b"');
  expect(recent).not.toContain('href="/w/ws/knowledge/src/a"');
  // The event is read out and shown in the time's tooltip; the column holds only the short time.
  expect(recent).toContain('<span class="sr-only">Edited </span>');
  expect(recent).toMatch(/<time [^>]*title="Edited Oct 1, 2026/);
});

it("links an archived document's draft to recovery, not the editor", () => {
  const html = renderToStaticMarkup(
    <PersonalHome
      workspaceId="ws"
      documents={[doc("a", { status: "ARCHIVED" })]}
      drafts={[{ key: "draft:a", title: "Doc a", sourceId: "src", updatedAt: "2026-10-02T00:00:00.000Z" }]}
    />,
  );
  const drafts = html.slice(html.indexOf('aria-label="Drafts"'), html.indexOf('aria-label="Recent"'));
  expect(drafts).toContain('href="/w/ws/knowledge/drafts/src/a"');
  expect(drafts).toContain("Original document archived");
  expect(drafts).not.toContain("/edit");
});

it("still offers the getting-started guide when every document is archived", () => {
  const html = renderToStaticMarkup(
    <PersonalHome workspaceId="ws" documents={[doc("a", { status: "ARCHIVED" })]} drafts={[]} guidanceDismissed />,
  );
  expect(html).toContain("Show getting started guide");
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

it("puts source reminders in the attention strip and unread comments in Discussions", () => {
  const reminders = [{ sourceId: "s1", sourceName: "Folder", status: "old" as const, previewId: null, lastImportedAt: null }];
  const notices = [{ id: "n1", workspaceId: "ws", sourceId: "src", documentId: "a", threadId: "t1", commentId: "c1", documentTitle: "Plan", authorName: "Ana", excerpt: "Looks good", createdAt: "2026-10-18T00:00:00.000Z", readAt: null, threadStatus: "OPEN" as const }];
  const withReminders = renderToStaticMarkup(<PersonalHome workspaceId="ws" documents={[]} drafts={[]} reminders={reminders} />);
  expect(withReminders).toContain('aria-label="Needs attention"');
  const withNotices = renderToStaticMarkup(<PersonalHome workspaceId="ws" documents={[]} drafts={[]} notices={notices} />);
  expect(withReminders.indexOf('aria-label="Needs attention"')).toBeLessThan(withReminders.indexOf('aria-label="Recent"'));
  expect(withNotices).not.toContain("Needs attention");
  expect(withNotices).not.toContain("No new comments or replies.");
  const discussions = withNotices.slice(withNotices.indexOf('aria-label="Discussions"'), withNotices.indexOf('aria-label="Favorites"'));
  expect(discussions).toContain('aria-label="Unread discussions"');
  expect(discussions).toContain(">1<");
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

it("names a source only where it changes from the row above", () => {
  const html = renderToStaticMarkup(<PersonalHome workspaceId="ws" documents={[
    doc("a", { sourceName: "Notes", updatedAt: "2026-10-09T00:00:00.000Z" }),
    doc("b", { sourceName: "Notes", updatedAt: "2026-10-08T00:00:00.000Z" }),
    doc("c", { sourceId: "team", sourceName: "Team wiki", updatedAt: "2026-10-07T00:00:00.000Z" }),
    doc("d", { sourceName: "Notes", updatedAt: "2026-10-06T00:00:00.000Z" }),
  ]} drafts={[]} />);
  const recent = html.slice(html.indexOf('aria-label="Recent"'), html.indexOf('aria-label="Discussions"'));
  // a names Notes, b repeats it and stays quiet, c changes to Team wiki, d changes back.
  expect(recent.match(/>Notes</g)).toHaveLength(2);
  expect(recent.match(/>Team wiki</g)).toHaveLength(1);
});

it("shows the first eight recent rows and offers the rest behind Show more", () => {
  const many = Array.from({ length: 11 }, (_, n) => doc(`d${n}`, { updatedAt: `2026-10-${String(n + 1).padStart(2, "0")}T00:00:00.000Z` }));
  const html = renderToStaticMarkup(<PersonalHome workspaceId="ws" documents={many} drafts={[]} />);
  const recent = html.slice(html.indexOf('aria-label="Recent"'), html.indexOf('aria-label="Favorites"'));
  expect(recent.match(/data-list-row/g)).toHaveLength(8);
  expect(recent).toContain(">Show 3 more<");
  const few = renderToStaticMarkup(<PersonalHome workspaceId="ws" documents={many.slice(0, 8)} drafts={[]} />);
  expect(few).not.toContain("Show ");
});

describe("C on Home opens a new note", () => {
  /** A target whose closest() answers for the selectors it is "inside". */
  const inside = (...matches: string[]) => ({ closest: (selector: string) => (matches.some(m => selector.includes(m)) ? {} : null) });
  const press = (over: Partial<Parameters<typeof isNewNoteKey>[0]> = {}) => isNewNoteKey({
    key: "c", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, isComposing: false, repeat: false, defaultPrevented: false, target: inside(), ...over,
  });

  it("answers c on the page, and C with caps lock", () => {
    expect(press()).toBe(true);
    expect(press({ key: "C" })).toBe(true);
    expect(press({ target: null })).toBe(true);
  });

  it("leaves a letter typed into a field, an editor, a menu or a dialog alone", () => {
    for (const where of ["input", "textarea", "contenteditable", '[role="menu"]', '[role="dialog"]']) expect(press({ target: inside(where) })).toBe(false);
  });

  it("leaves the search bar alone, where a key means search", () => {
    expect(press({ target: inside("data-home-search") })).toBe(false);
  });

  it("never fires mid-composition, on a held key, or with a modifier (⌘C copies)", () => {
    expect(press({ isComposing: true })).toBe(false);
    expect(press({ keyCode: 229 })).toBe(false);
    expect(press({ repeat: true })).toBe(false);
    expect(press({ metaKey: true })).toBe(false);
    expect(press({ ctrlKey: true })).toBe(false);
    expect(press({ altKey: true })).toBe(false);
    expect(press({ shiftKey: true, key: "C" })).toBe(false);
  });

  it("answers only c, and not a key something else already took", () => {
    expect(press({ key: "e" })).toBe(false);
    expect(press({ key: "/" })).toBe(false);
    expect(press({ defaultPrevented: true })).toBe(false);
  });

  it("names the key on New note and marks the search bar", () => {
    const html = renderToStaticMarkup(<PersonalHome workspaceId="ws" documents={[]} drafts={[]} />);
    expect(html).toMatch(/<a [^>]*href="\/w\/ws\/knowledge\/new"[^>]*aria-keyshortcuts="C"|<a [^>]*aria-keyshortcuts="C"[^>]*href="\/w\/ws\/knowledge\/new"/);
    expect(html).toMatch(/<button [^>]*data-home-search/);
  });
});

