import { beforeEach, expect, it, vi, type Mock } from "vitest";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const mocks = vi.hoisted(() => ({ model: vi.fn(), redirect: vi.fn() }));
vi.mock("@/server/draft-read", () => ({ getDraftRecoveryModel: mocks.model }));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("not found"); },
  redirect: mocks.redirect,
}));
vi.mock("@/components/knowledge/draft-recovery-actions", () => ({
  DraftRecoveryActions: ({ canRestore }: { canRestore: boolean }) => <span data-can-restore={String(canRestore)} />,
}));
vi.mock("@/components/knowledge/markdown-article", () => ({
  MarkdownArticle: ({ markdown }: { markdown: string }) => <article>{markdown}</article>,
}));

import DraftRecoveryPage from "@/app/w/[workspaceId]/knowledge/drafts/[sourceId]/[documentId]/page";

beforeEach(() => {
  (mocks.model as Mock).mockReset();
  (mocks.redirect as Mock).mockReset();
});

it("renders an archived draft with its recovery actions", async () => {
  mocks.model.mockResolvedValue({
    draft: { key: "draft:doc", title: "Draft", markdown: "# Unsaved body", updatedAt: "2026-10-24T00:00:00.000Z" },
    document: { documentId: "doc", sourceId: "src", status: "ARCHIVED", sourceStatus: "ACTIVE", ownership: "HUB_MANAGED", title: "Draft" },
    canRestore: true, canWrite: true, sourceArchived: false, workspaceArchived: false,
  });
  const result = await DraftRecoveryPage({ params: Promise.resolve({ workspaceId: "ws", sourceId: "src", documentId: "doc" }) });
  const html = renderToStaticMarkup(result as ReactElement);
  expect(html).toContain("Draft");
  expect(html).toContain("# Unsaved body");
  expect(html).toContain('data-can-restore="true"');
});

it("does not promise restore for a synced-source document", async () => {
  mocks.model.mockResolvedValue({
    draft: { key: "draft:doc", title: "Draft", markdown: "# Body", updatedAt: "2026-10-24T00:00:00.000Z" },
    document: { documentId: "doc", sourceId: "src", status: "ARCHIVED", sourceStatus: "ACTIVE", ownership: "SOURCE_MANAGED", title: "Draft" },
    canRestore: false, canWrite: true, sourceArchived: false, workspaceArchived: false, folderArchived: false, treeNodeMissing: false,
  });
  const result = await DraftRecoveryPage({ params: Promise.resolve({ workspaceId: "ws", sourceId: "src", documentId: "doc" }) });
  const html = renderToStaticMarkup(result as ReactElement);
  expect(html).toContain("synced source");
  expect(html).toContain('data-can-restore="false"');
});

it("points to Sources when an ancestor folder is archived", async () => {
  mocks.model.mockResolvedValue({
    draft: { key: "draft:doc", title: "Draft", markdown: "# Body", updatedAt: "2026-10-24T00:00:00.000Z" },
    document: { documentId: "doc", sourceId: "src", status: "ARCHIVED", sourceStatus: "ACTIVE", ownership: "HUB_MANAGED", title: "Draft" },
    canRestore: false, canWrite: true, sourceArchived: false, workspaceArchived: false, folderArchived: true, treeNodeMissing: false,
  });
  const result = await DraftRecoveryPage({ params: Promise.resolve({ workspaceId: "ws", sourceId: "src", documentId: "doc" }) });
  const html = renderToStaticMarkup(result as ReactElement);
  expect(html).toContain("folder holding this document is archived");
  expect(html).toContain('href="/w/ws/sources/src"');
});

it("sends an active draft back to the document page", async () => {
  mocks.model.mockResolvedValue({
    draft: { key: "draft:doc", title: "Draft", markdown: "# Body", updatedAt: "2026-10-24T00:00:00.000Z" },
    document: { documentId: "doc", sourceId: "src", status: "ACTIVE", sourceStatus: "ACTIVE", ownership: "HUB_MANAGED", title: "Draft" },
    canRestore: false, canWrite: true, sourceArchived: false, workspaceArchived: false,
  });
  await DraftRecoveryPage({ params: Promise.resolve({ workspaceId: "ws", sourceId: "src", documentId: "doc" }) });
  expect(mocks.redirect).toHaveBeenCalledWith("/w/ws/knowledge/src/doc");
});

it("redirects a stale recovery URL to an active document when the draft is gone", async () => {
  mocks.model.mockResolvedValue({
    draft: null,
    document: { documentId: "doc", sourceId: "src", status: "ACTIVE", sourceStatus: "ACTIVE", ownership: "HUB_MANAGED", title: "Document" },
    canRestore: false, canWrite: true, sourceArchived: false, workspaceArchived: false, folderArchived: false, treeNodeMissing: false,
  });
  await DraftRecoveryPage({ params: Promise.resolve({ workspaceId: "ws", sourceId: "src", documentId: "doc" }) });
  expect(mocks.redirect).toHaveBeenCalledWith("/w/ws/knowledge/src/doc");
});

it("redirects a stale recovery URL to the archived document view", async () => {
  mocks.model.mockResolvedValue({
    draft: null,
    document: { documentId: "doc", sourceId: "src", status: "ARCHIVED", sourceStatus: "ACTIVE", ownership: "HUB_MANAGED", title: "Document" },
    canRestore: true, canWrite: true, sourceArchived: false, workspaceArchived: false, folderArchived: false, treeNodeMissing: false,
  });
  await DraftRecoveryPage({ params: Promise.resolve({ workspaceId: "ws", sourceId: "src", documentId: "doc" }) });
  expect(mocks.redirect).toHaveBeenCalledWith("/w/ws/knowledge/src/doc?includeArchived=true");
});

it("is not found when the draft has no recovery model", async () => {
  mocks.model.mockResolvedValue(null);
  await expect(DraftRecoveryPage({ params: Promise.resolve({ workspaceId: "ws", sourceId: "src", documentId: "doc" }) })).rejects.toThrow("not found");
});
