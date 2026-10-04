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
it("puts scoped search and folders before reading updates and keeps writing secondary", () => {
  const html = renderToStaticMarkup(
    <PersonalHome workspaceId="ws" documents={[]} drafts={[]} />,
  );
  expect(html).toContain('action="/w/ws/search"');
  expect(html).toContain("Import folder");
  expect(html).toContain("New note");
  expect(html.indexOf("My folders")).toBeLessThan(html.indexOf("Updates"));
  expect(html).not.toContain("Continue writing");
  expect(html).toContain("Your local folder is the source of truth");
  expect(html).toContain("review the Preview");
});
