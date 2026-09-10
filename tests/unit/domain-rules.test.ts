import { describe, expect, it } from "vitest";
import { assertTreeNodeShape } from "@/modules/knowledge/domain/tree-node";
import { isHubManaged } from "@/modules/knowledge/domain/source-policy";
import {
  DocumentNotFoundError,
  DomainError,
  IdentityError,
  IntegrityError,
  IntegrityViolationError,
  InvalidMetadataError,
  InvalidTitleError,
  KnowledgeError,
  NotFoundError,
  RevisionConflictError,
  RevisionNotFoundError,
  SourceNotFoundError,
  SourceReadOnlyError,
  TreeNodeNotFoundError,
  ValidationError,
  VersionConflictError,
} from "@/modules/knowledge/domain/errors";
import { WorkspaceAccessDeniedError, WorkspaceNotFoundError } from "@/modules/workspaces/domain/errors";
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
    const error = await service.createRevision(caller, "d", { title: "new", markdown: "m", metadata: {} }).then(
      (): null => null,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(SourceReadOnlyError);
    expect(error).toBeInstanceOf(DomainError);
    expect((error as SourceReadOnlyError).code).toBe("SOURCE_MANAGED_READ_ONLY");
    expect(calls).toEqual([]);
  });

  it("keeps precise not-found subclasses under the compatible NotFoundError base", () => {
    for (const [instance, code] of [
      [new SourceNotFoundError(), "SOURCE_NOT_FOUND"],
      [new DocumentNotFoundError(), "DOCUMENT_NOT_FOUND"],
      [new RevisionNotFoundError(), "REVISION_NOT_FOUND"],
      [new TreeNodeNotFoundError(), "TREE_NODE_NOT_FOUND"],
    ] as const) {
      expect(instance).toBeInstanceOf(NotFoundError);
      expect(instance).toBeInstanceOf(DomainError);
      expect(instance.code).toBe(code);
    }
  });

  it("routes candidate validation through KnowledgeError without breaking ValidationError consumers", () => {
    const title = new InvalidTitleError();
    const metadata = new InvalidMetadataError();
    for (const [instance, code] of [[title, "INVALID_TITLE"], [metadata, "INVALID_METADATA"]] as const) {
      expect(instance).toBeInstanceOf(KnowledgeError);
      expect(instance).toBeInstanceOf(ValidationError);
      expect(instance).toBeInstanceOf(DomainError);
      expect(instance.code).toBe(code);
    }
  });

  it("keeps revision conflicts distinct from source version conflicts", () => {
    const revision = new RevisionConflictError();
    const version = new VersionConflictError();
    expect(revision.code).toBe("REVISION_CONFLICT");
    expect(version.code).toBe("VERSION_CONFLICT");
    expect(revision).not.toBeInstanceOf(VersionConflictError);
    expect(version).not.toBeInstanceOf(RevisionConflictError);
  });

  it("preserves identity errors and maps integrity violations precisely", () => {
    const identity = new IdentityError("Configured identity id and employee id belong to different users.");
    expect(identity).toBeInstanceOf(DomainError);
    expect(identity.code).toBe("IDENTITY_ERROR");
    const violation = new IntegrityViolationError();
    expect(violation).toBeInstanceOf(IntegrityError);
    expect(violation).toBeInstanceOf(DomainError);
    expect(violation.code).toBe("INTEGRITY_VIOLATION");
  });

  it("keeps Workspace errors at the Workspaces boundary", () => {
    const denied = new WorkspaceAccessDeniedError();
    const missing = new WorkspaceNotFoundError();
    expect(denied).toBeInstanceOf(DomainError);
    expect(denied.code).toBe("WORKSPACE_ACCESS_DENIED");
    expect(missing).toBeInstanceOf(DomainError);
    expect(missing.code).toBe("WORKSPACE_NOT_FOUND");
    expect(missing).not.toBeInstanceOf(WorkspaceAccessDeniedError);
  });
});
