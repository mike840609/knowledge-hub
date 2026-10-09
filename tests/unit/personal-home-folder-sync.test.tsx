import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PersonalHome } from "@/components/knowledge/personal-home";
vi.mock("@/components/knowledge/use-document-shortcuts", () => ({
  useDocumentShortcuts: () => ({
    shortcuts: { favorites: [], recent: [] },
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
it("keeps reading and updates as the Home entry points, leaving search to the topbar's ⌘K", () => {
  const html = renderToStaticMarkup(
    <PersonalHome workspaceId="ws" documents={[]} drafts={[]} />,
  );
  // A second search field on Home duplicated the topbar's and split where people search.
  expect(html).not.toContain('role="search"');
  expect(html).not.toContain('/sources/import');
  expect(html).toContain("New note");
  expect(html.indexOf("Continue reading")).toBeLessThan(html.indexOf("Updates"));
  expect(html).not.toContain("My folders");
  expect(html).not.toContain("Continue writing");
  expect(html).not.toContain("Your notes");
  expect(html).not.toContain("Knowledge freshness");
  expect(html).toContain("Browse knowledge");
  expect(html).toContain("Documents you open will appear here.");
});

it("offers inline guide recovery only when dismissed and the workspace has no documents", () => {
  const render = (dismissed: boolean, documents: React.ComponentProps<typeof PersonalHome>["documents"] = []) =>
    renderToStaticMarkup(<PersonalHome workspaceId="ws" documents={documents} drafts={[]} guidanceDismissed={dismissed} />);
  expect(render(true)).toContain("Show getting started guide");
  expect(render(false)).not.toContain("Show getting started guide");
  expect(render(true, [{ sourceId: "source", documentId: "doc", title: "Unread note", ownership: "HUB_MANAGED", status: "ACTIVE", sourceStatus: "ACTIVE", updatedAt: "2026-10-09T00:00:00Z" }])).not.toContain("Show getting started guide");
});
