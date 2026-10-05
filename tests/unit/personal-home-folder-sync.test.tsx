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
vi.mock("@/components/knowledge/share-link-dialog", () => ({
  ShareLinkDialogHost: () => null,
}));
it("keeps scoped search, reading and updates as the Home entry points", () => {
  const html = renderToStaticMarkup(
    <PersonalHome workspaceId="ws" documents={[]} drafts={[]} />,
  );
  expect(html).toContain('action="/w/ws/search"');
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
