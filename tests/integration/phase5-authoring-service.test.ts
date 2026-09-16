import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { callerFromIdentity } from "@/modules/identity/domain/caller-context";
import type { UserIdentity } from "@/modules/identity/domain/user-identity";
import { HubKnowledgeCommandServiceImpl } from "@/modules/knowledge/application/hub-knowledge-command-service";
import { KnowledgeQueryServiceImpl } from "@/modules/knowledge/application/knowledge-query-service";
import { contentFingerprint } from "@/modules/knowledge/domain/content";
import { RevisionConflictError, SourceReadOnlyError } from "@/modules/knowledge/domain/errors";
import { ensureDefaultHubSource } from "@/modules/sources/application/ensure-default-hub-source";
import { WorkspaceAccessDeniedError } from "@/modules/workspaces/domain/errors";
import { createTeamWorkspaceInsert } from "@/modules/workspaces/domain/workspace";
import { createDirectMembership } from "@/modules/workspaces/domain/workspace-membership";
import { uuidv7 } from "@/shared/ids/uuidv7";

let pool: Pool;
beforeAll(() => { pool = createDatabasePool(databaseConfig("test")); });
afterAll(async () => { await pool.end(); });

const owner: UserIdentity = { id: "00000000-0000-0000-0000-000000000521", emp_id: "P5-A-OWNER", name: "Owner", org_code: "HRSD" };
const viewer: UserIdentity = { id: "00000000-0000-0000-0000-000000000522", emp_id: "P5-A-VIEWER", name: "Viewer", org_code: "HRSD" };

async function createWorkspace(): Promise<string> {
  const unitOfWork = new MariaDbUnitOfWork(pool);
  const workspaceId = uuidv7();
  const now = new Date();
  await unitOfWork.run(async (repositories) => {
    for (const identity of [owner, viewer]) await repositories.users.upsertIdentity(identity);
    await repositories.workspaces.insert(createTeamWorkspaceInsert({ id: workspaceId, name: `WS ${workspaceId}`, createdBy: owner.id, now }));
    await repositories.workspaceMemberships.insert(createDirectMembership({ workspaceId, userId: owner.id, role: "OWNER", createdBy: owner.id, now }));
    await repositories.workspaceMemberships.insert(createDirectMembership({ workspaceId, userId: viewer.id, role: "VIEWER", createdBy: owner.id, now }));
  });
  return workspaceId;
}

describe("Phase 5 authoring (spec §4, §7.1)", () => {
  it("creates revision 1 in the lazily provisioned source", async () => {
    const workspaceId = await createWorkspace();
    const unitOfWork = new MariaDbUnitOfWork(pool);
    const caller = callerFromIdentity(owner);
    const sourceId = await ensureDefaultHubSource(unitOfWork, caller, workspaceId);
    const created = await new HubKnowledgeCommandServiceImpl(unitOfWork).createDocument(caller, {
      sourceId, parentId: null, title: "Runbook", markdown: "first", metadata: {},
    });
    const revisions = await new KnowledgeQueryServiceImpl(unitOfWork).listRevisions(caller, created.documentId);
    expect(revisions).toHaveLength(1);
    expect(revisions[0]).toMatchObject({ revisionNo: 1, title: "Runbook", markdown: "first" });
  });

  it("creates revision 2 on edit and leaves revision 1 untouched", async () => {
    const workspaceId = await createWorkspace();
    const unitOfWork = new MariaDbUnitOfWork(pool);
    const caller = callerFromIdentity(owner);
    const hub = new HubKnowledgeCommandServiceImpl(unitOfWork);
    const sourceId = await ensureDefaultHubSource(unitOfWork, caller, workspaceId);
    const created = await hub.createDocument(caller, { sourceId, parentId: null, title: "Runbook", markdown: "v1", metadata: {} });
    await hub.createRevision(caller, {
      documentId: created.documentId, expectedCurrentRevisionId: created.revisionId,
      title: "Runbook", markdown: "v2", metadata: {},
    });
    const revisions = await new KnowledgeQueryServiceImpl(unitOfWork).listRevisions(caller, created.documentId);
    expect(revisions.map((revision) => revision.markdown).sort()).toEqual(["v1", "v2"]);
  });

  it("does not create a revision when the content is unchanged", async () => {
    const workspaceId = await createWorkspace();
    const unitOfWork = new MariaDbUnitOfWork(pool);
    const caller = callerFromIdentity(owner);
    const hub = new HubKnowledgeCommandServiceImpl(unitOfWork);
    const sourceId = await ensureDefaultHubSource(unitOfWork, caller, workspaceId);
    const created = await hub.createDocument(caller, { sourceId, parentId: null, title: "Same", markdown: "same", metadata: {} });
    const result = await hub.createRevision(caller, {
      documentId: created.documentId, expectedCurrentRevisionId: created.revisionId,
      title: "Same", markdown: "same", metadata: {},
    });
    expect(result.changed).toBe(false);
    const revisions = await new KnowledgeQueryServiceImpl(unitOfWork).listRevisions(caller, created.documentId);
    expect(revisions).toHaveLength(1);
  });

  it("rejects a stale editor and keeps the winner's content", async () => {
    const workspaceId = await createWorkspace();
    const unitOfWork = new MariaDbUnitOfWork(pool);
    const caller = callerFromIdentity(owner);
    const hub = new HubKnowledgeCommandServiceImpl(unitOfWork);
    const queries = new KnowledgeQueryServiceImpl(unitOfWork);
    const sourceId = await ensureDefaultHubSource(unitOfWork, caller, workspaceId);
    const created = await hub.createDocument(caller, { sourceId, parentId: null, title: "Doc", markdown: "v1", metadata: {} });
    const stale = created.revisionId;
    await hub.createRevision(caller, { documentId: created.documentId, expectedCurrentRevisionId: stale, title: "Doc", markdown: "winner", metadata: {} });
    await expect(hub.createRevision(caller, {
      documentId: created.documentId, expectedCurrentRevisionId: stale, title: "Doc", markdown: "loser", metadata: {},
    })).rejects.toBeInstanceOf(RevisionConflictError);
    expect((await queries.getCurrentRevision(caller, created.documentId)).markdown).toBe("winner");
  });

  it("preserves existing metadata across an edit", async () => {
    const workspaceId = await createWorkspace();
    const unitOfWork = new MariaDbUnitOfWork(pool);
    const caller = callerFromIdentity(owner);
    const hub = new HubKnowledgeCommandServiceImpl(unitOfWork);
    const queries = new KnowledgeQueryServiceImpl(unitOfWork);
    const sourceId = await ensureDefaultHubSource(unitOfWork, caller, workspaceId);
    const created = await hub.createDocument(caller, { sourceId, parentId: null, title: "Doc", markdown: "v1", metadata: { owner: "hr", tags: ["a"] } });
    const current = await queries.getCurrentRevision(caller, created.documentId);
    await hub.createRevision(caller, {
      documentId: created.documentId, expectedCurrentRevisionId: current.id,
      title: "Doc", markdown: "v2", metadata: current.metadata as Record<string, never>,
    });
    expect((await queries.getCurrentRevision(caller, created.documentId)).metadata).toEqual({ owner: "hr", tags: ["a"] });
  });

  it("refuses a VIEWER on both create and edit", async () => {
    const workspaceId = await createWorkspace();
    const unitOfWork = new MariaDbUnitOfWork(pool);
    const hub = new HubKnowledgeCommandServiceImpl(unitOfWork);
    const sourceId = await ensureDefaultHubSource(unitOfWork, callerFromIdentity(owner), workspaceId);
    const created = await hub.createDocument(callerFromIdentity(owner), { sourceId, parentId: null, title: "Doc", markdown: "v1", metadata: {} });
    await expect(hub.createDocument(callerFromIdentity(viewer), { sourceId, parentId: null, title: "Nope", markdown: "x", metadata: {} }))
      .rejects.toBeInstanceOf(WorkspaceAccessDeniedError);
    await expect(hub.createRevision(callerFromIdentity(viewer), {
      documentId: created.documentId, expectedCurrentRevisionId: created.revisionId, title: "Doc", markdown: "x", metadata: {},
    })).rejects.toBeInstanceOf(WorkspaceAccessDeniedError);
  });

  // Ruling A fallback: `repositories.connection` does not exist on SourceRepositories.
  // Verified by reading src/infrastructure/database/mariadb/repositories/index.ts —
  // createRepositories() returns an object with no `connection` field, so the brief's
  // `repositories.connection?.query?.(...)` escape hatch would silently no-op. Instead,
  // build a SOURCE_MANAGED source and a document under it directly, mirroring
  // scripts/db/seed.ts:92-107 (insertDraft + revisions.insert + setCurrentRevision + tree.insert).
  it("refuses edits to SOURCE_MANAGED content", async () => {
    const workspaceId = await createWorkspace();
    const unitOfWork = new MariaDbUnitOfWork(pool);
    const caller = callerFromIdentity(owner);
    const hub = new HubKnowledgeCommandServiceImpl(unitOfWork);
    const sourceManagedSourceId = uuidv7();
    const documentId = uuidv7();
    const revisionId = uuidv7();
    const nodeId = uuidv7();
    const now = new Date();
    await unitOfWork.run(async (repositories) => {
      await repositories.sources.insert({
        id: sourceManagedSourceId, name: "Synced Folder", workspaceId, sourceType: "FOLDER_SYNC", ownership: "SOURCE_MANAGED",
        status: "ACTIVE", syncVersion: 0, createdBy: owner.id, updatedBy: owner.id,
        archivedBy: null, archivedAt: null, createdAt: now, updatedAt: now,
      });
      const content = { title: "Doc", markdown: "v1", metadata: {} };
      await repositories.documents.insertDraft({
        id: documentId, sourceId: sourceManagedSourceId, currentRevisionId: null,
        status: "ACTIVE", createdBy: owner.id, updatedBy: owner.id, archivedBy: null, archivedAt: null, createdAt: now, updatedAt: now,
      });
      await repositories.revisions.insert({
        id: revisionId, documentId, revisionNo: 1,
        ...content, contentHash: contentFingerprint(content), createdBy: owner.id, createdAt: now,
      });
      await repositories.documents.setCurrentRevision(documentId, revisionId, owner.id);
      await repositories.tree.insert({
        id: nodeId, sourceId: sourceManagedSourceId, parentId: null,
        nodeType: "DOCUMENT", name: null, documentId, position: 0,
        status: "ACTIVE", updatedBy: owner.id, archivedBy: null, archivedAt: null,
      });
      await repositories.documents.assertComplete(documentId);
    });
    await expect(hub.createRevision(caller, {
      documentId, expectedCurrentRevisionId: revisionId, title: "Doc", markdown: "v2", metadata: {},
    })).rejects.toBeInstanceOf(SourceReadOnlyError);
  });
});
