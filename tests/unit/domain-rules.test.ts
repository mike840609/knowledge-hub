import { describe, expect, it } from "vitest";
import { assertTreeNodeShape } from "@/modules/knowledge/domain/tree-node";
import { isHubManaged } from "@/modules/knowledge/domain/source-policy";
import { SourceReadOnlyError } from "@/modules/knowledge/domain/errors";
import { KnowledgeApplicationService } from "@/modules/knowledge/application/service";
import type { KnowledgeRepositories, KnowledgeUnitOfWork } from "@/modules/knowledge/ports/unit-of-work";
import { callerFromIdentity } from "@/modules/identity/domain/caller-context";

describe("foundation domain rules", () => {
  it("keeps source ownership separate from source type", () => {
    expect(isHubManaged({ id: "s", workspaceId: "w", sourceType: "HUB", ownership: "HUB_MANAGED", status: "ACTIVE", syncVersion: 0 })).toBe(true);
    expect(isHubManaged({ id: "s", workspaceId: "w", sourceType: "FOLDER_SYNC", ownership: "SOURCE_MANAGED", status: "ACTIVE", syncVersion: 0 })).toBe(false);
  });

  it("requires folder/document tree shapes", () => {
    expect(() => assertTreeNodeShape({ nodeType: "FOLDER", name: "Folder", documentId: null })).not.toThrow();
    expect(() => assertTreeNodeShape({ nodeType: "DOCUMENT", name: null, documentId: "doc" })).not.toThrow();
    expect(() => assertTreeNodeShape({ nodeType: "FOLDER", name: "Folder", documentId: "doc" })).toThrow();
    expect(() => assertTreeNodeShape({ nodeType: "DOCUMENT", name: "Title", documentId: "doc" })).toThrow();
  });

  it("rejects a Hub revision on a SOURCE_MANAGED source before writes", async () => {
    const caller = callerFromIdentity({ id: "u", emp_id: "e", name: "N", org_code: "O" });
    const calls: string[] = [];
    const fakeRepositories = {
        users: { upsertIdentity: async () => undefined },
        workspaceMemberships: { find: async () => ({ workspaceId: "w", userId: "u", createdAt: new Date() }) },
        workspaceAccess: { requireMembership: async () => undefined },
        documents: { findById: async () => ({ id: "d", sourceId: "s" }), lockById: async () => ({ id: "d", sourceId: "s" }) },
        sourcePolicy: { lockById: async () => ({ id: "s", workspaceId: "w", sourceType: "FOLDER_SYNC", ownership: "SOURCE_MANAGED", status: "ACTIVE", syncVersion: 0 }), findById: async () => ({ id: "s", workspaceId: "w", sourceType: "FOLDER_SYNC", ownership: "SOURCE_MANAGED", status: "ACTIVE", syncVersion: 0 }) },
        revisions: { findCurrent: async () => ({ id: "r", documentId: "d", revisionNo: 1, title: "t", markdown: "m", metadata: {}, contentHash: "h", createdBy: "u", createdAt: new Date() }), insert: async () => calls.push("insert"), nextRevisionNumber: async () => 2 },
        tree: {},
      } as unknown as KnowledgeRepositories;
    const fakeUow: KnowledgeUnitOfWork = { run: async (work) => work(fakeRepositories) };
    const service = new KnowledgeApplicationService(fakeUow);
    await expect(service.createRevision(caller, "d", { title: "new", markdown: "m", metadata: {} })).rejects.toBeInstanceOf(SourceReadOnlyError);
    expect(calls).toEqual([]);
  });
});
