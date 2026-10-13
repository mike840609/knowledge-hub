import { beforeEach, expect, it, vi } from "vitest";
import { createDocumentInTransaction } from "@/modules/knowledge/application/internal/create-document";
import type { KnowledgeRepositories } from "@/modules/knowledge/ports/unit-of-work";
import type { CallerContext } from "@/modules/identity/domain/caller-context";
const mocks = vi.hoisted(() => ({ authorize: vi.fn() }));
vi.mock("@/modules/identity/application/sync-caller-identity", () => ({ syncCallerIdentity: vi.fn() }));
vi.mock("@/modules/workspaces/application/workspace-mutation-guard", () => ({ lockWorkspaceForMutation: mocks.authorize }));
vi.mock("@/modules/knowledge/application/internal/tree-transaction", () => ({ placeNodeAtIndex: vi.fn() }));
const input = { sourceId: "s", parentId: null, documentId: "d", title: "Note", markdown: "Text", metadata: {} };
const caller = { identity: { id: "u" } } as CallerContext;
function repositories(existing: object | null = null) {
  return {
    users: {}, sourcePolicy: { lockById: vi.fn().mockResolvedValue({ id: "s", workspaceId: "w", status: "ACTIVE", ownership: "HUB_MANAGED" }) },
    documents: { findById: vi.fn().mockResolvedValue(existing), insertDraft: vi.fn(), setCurrentRevision: vi.fn(), assertComplete: vi.fn() },
    revisions: { findByRevisionNo: vi.fn().mockResolvedValue({ id: "r1" }), insert: vi.fn() },
    tree: { listBySource: vi.fn().mockResolvedValue(existing ? [{ id: "n", documentId: "d" }] : []), insert: vi.fn() },
    links: { replaceForDocument: vi.fn() },
  };
}
beforeEach(() => { mocks.authorize.mockReset(); });
it("creates using a stable client id", async () => {
  const repos = repositories();
  const result = await createDocumentInTransaction(repos as unknown as KnowledgeRepositories, caller, input);
  expect(result.documentId).toBe("d");
  expect(repos.documents.insertDraft).toHaveBeenCalledWith(expect.objectContaining({ id: "d", createdBy: "u" }));
});
it("replays creation without inserting or returning a newer revision", async () => {
  const repos = repositories({ id: "d", sourceId: "s", createdBy: "u", status: "ACTIVE", currentRevisionId: "r9" });
  const result = await createDocumentInTransaction(repos as unknown as KnowledgeRepositories, caller, input);
  expect(result).toEqual({ documentId: "d", revisionId: "r1", treeNodeId: "n" });
  expect(repos.documents.insertDraft).not.toHaveBeenCalled();
  expect(repos.documents.setCurrentRevision).not.toHaveBeenCalled();
  expect(mocks.authorize).toHaveBeenCalled();
});
it.each([{ sourceId: "other" }, { createdBy: "other" }, { status: "ARCHIVED" }])("refuses replay for %j", async override => {
  const repos = repositories({ id: "d", sourceId: "s", createdBy: "u", status: "ACTIVE", ...override });
  await expect(createDocumentInTransaction(repos as unknown as KnowledgeRepositories, caller, input)).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
});
it("rechecks write authorization before replaying", async () => {
  mocks.authorize.mockRejectedValue(new Error("revoked"));
  const repos = repositories({ id: "d", sourceId: "s", createdBy: "u", status: "ACTIVE" });
  await expect(createDocumentInTransaction(repos as unknown as KnowledgeRepositories, caller, input)).rejects.toThrow("revoked");
  expect(repos.documents.findById).not.toHaveBeenCalled();
});
