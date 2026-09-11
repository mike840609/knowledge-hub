import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import {
  HubKnowledgeCommandServiceImpl,
  type CreateHubDocumentInput,
} from "@/modules/knowledge/application/hub-knowledge-command-service";
import { callerFromIdentity } from "@/modules/identity/domain/caller-context";
import type { UserIdentity } from "@/modules/identity/domain/user-identity";
import {
  DocumentArchivedError,
  InvalidParentError,
  RevisionConflictError,
  SourceArchivedError,
  SourceReadOnlyError,
  TreeNodeNotFoundError,
} from "@/modules/knowledge/domain/errors";
import { revisionContentHash, normalizeRevisionContent } from "@/modules/knowledge/domain/content";
import { uuidv7 } from "@/shared/ids/uuidv7";
import { disposeIsolatedDatabase, provisionIsolatedDatabase } from "../../scripts/db/test-database";
import { runMigrations, type IsolatedDatabaseHandle } from "../../scripts/db/migrate";

const owner: UserIdentity = { id: "0199f100-0000-7000-8000-000000000001", emp_id: "AUTH-OWNER", name: "Auth Owner", org_code: "HRSD" };
const outsider: UserIdentity = { id: "0199f100-0000-7000-8000-000000000002", emp_id: "AUTH-OUT", name: "Auth Outsider", org_code: "HRSD" };

let handle: IsolatedDatabaseHandle;
let poolA: Pool;
let poolB: Pool;

beforeAll(async () => {
  handle = await provisionIsolatedDatabase("test");
  const previous = process.env.KM_TEST_DB_NAME;
  process.env.KM_TEST_DB_NAME = handle.databaseName;
  try {
    poolA = createDatabasePool(databaseConfig("test"));
    poolB = createDatabasePool(databaseConfig("test"));
  } finally {
    if (previous === undefined) delete process.env.KM_TEST_DB_NAME;
    else process.env.KM_TEST_DB_NAME = previous;
  }
  await runMigrations(poolA);
});

afterAll(async () => {
  await poolA.end();
  await poolB.end();
  await disposeIsolatedDatabase(handle);
});

type AuthorityFixture = {
  workspaceId: string;
  hubSourceId: string;
  hubFolderId: string;
  managedSourceId: string;
  managedFolderId: string;
  archivedSourceId: string;
  archivedFolderId: string;
};

async function setupAuthorityFixture(pool: Pool): Promise<AuthorityFixture> {
  const workspaceId = uuidv7();
  const hubSourceId = uuidv7();
  const hubFolderId = uuidv7();
  const managedSourceId = uuidv7();
  const managedFolderId = uuidv7();
  const archivedSourceId = uuidv7();
  const archivedFolderId = uuidv7();
  const now = new Date();
  await new MariaDbUnitOfWork(pool).run(async (repositories) => {
    await repositories.users.upsertIdentity(owner);
    await repositories.users.upsertIdentity(outsider);
    await repositories.workspaces.insert({ id: workspaceId, name: "Authority Workspace", createdAt: now, updatedAt: now });
    await repositories.workspaceMemberships.insert({ workspaceId, userId: owner.id, createdAt: now });
    await repositories.sources.insert({
      id: hubSourceId, name: "Hub Source", workspaceId, sourceType: "HUB", ownership: "HUB_MANAGED",
      status: "ACTIVE", syncVersion: 0, createdBy: owner.id, updatedBy: owner.id,
      archivedBy: null, archivedAt: null, createdAt: now, updatedAt: now,
    });
    await repositories.sources.insert({
      id: managedSourceId, name: "Managed Source", workspaceId, sourceType: "FOLDER_SYNC", ownership: "SOURCE_MANAGED",
      status: "ACTIVE", syncVersion: 0, createdBy: owner.id, updatedBy: owner.id,
      archivedBy: null, archivedAt: null, createdAt: now, updatedAt: now,
    });
    await repositories.sources.insert({
      id: archivedSourceId, name: "Archived Source", workspaceId, sourceType: "HUB", ownership: "HUB_MANAGED",
      status: "ARCHIVED", syncVersion: 0, createdBy: owner.id, updatedBy: owner.id,
      archivedBy: owner.id, archivedAt: now, createdAt: now, updatedAt: now,
    });
    for (const [folderId, sourceId, name] of [
      [hubFolderId, hubSourceId, "Hub Folder"],
      [managedFolderId, managedSourceId, "Managed Folder"],
      [archivedFolderId, archivedSourceId, "Archived Folder"],
    ] as const) {
      await repositories.tree.insert({
        id: folderId, sourceId, parentId: null, nodeType: "FOLDER", name,
        documentId: null, position: 0, status: "ACTIVE", updatedBy: owner.id, archivedBy: null, archivedAt: null,
      });
    }
  });
  return { workspaceId, hubSourceId, hubFolderId, managedSourceId, managedFolderId, archivedSourceId, archivedFolderId };
}

async function insertManagedDocument(pool: Pool, sourceId: string, folderId: string): Promise<{ documentId: string; revisionId: string }> {
  const documentId = uuidv7();
  const revisionId = uuidv7();
  const now = new Date();
  const content = { title: "Managed", markdown: "managed body", metadata: {} };
  await new MariaDbUnitOfWork(pool).run(async (repositories) => {
    await repositories.documents.insertDraft({
      id: documentId, sourceId, currentRevisionId: null, status: "ACTIVE",
      createdBy: owner.id, updatedBy: owner.id, archivedBy: null, archivedAt: null, createdAt: now, updatedAt: now,
    });
    await repositories.revisions.insert({
      id: revisionId, documentId, revisionNo: 1, ...content,
      contentHash: revisionContentHash(normalizeRevisionContent(content)),
      createdBy: owner.id, createdAt: now,
    });
    await repositories.documents.setCurrentRevision(documentId, revisionId, owner.id);
    await repositories.tree.insert({
      id: uuidv7(), sourceId, parentId: folderId, nodeType: "DOCUMENT", name: null,
      documentId, position: 0, status: "ACTIVE", updatedBy: owner.id, archivedBy: null, archivedAt: null,
    });
    await repositories.documents.assertComplete(documentId);
  });
  return { documentId, revisionId };
}

async function countRevisions(pool: Pool, documentId: string): Promise<number> {
  const rows = await pool.query<{ count: number }[]>("SELECT COUNT(*) AS count FROM knowledge_revisions WHERE document_id = ?", [documentId]);
  return Number(rows[0]?.count ?? 0);
}

describe("hub command authority", () => {
  it("creates a HUB_MANAGED document and a follow-up revision", async () => {
    const fixture = await setupAuthorityFixture(poolA);
    const hub = new HubKnowledgeCommandServiceImpl(new MariaDbUnitOfWork(poolA));
    const created = await hub.createDocument(callerFromIdentity(owner), {
      sourceId: fixture.hubSourceId, parentId: fixture.hubFolderId,
      title: "Authority Doc", markdown: "body", metadata: {},
    });
    expect(created.documentId).toBeTruthy();
    expect(created.revisionId).toBeTruthy();
    expect(created.treeNodeId).toBeTruthy();
    const revised = await hub.createRevision(callerFromIdentity(owner), {
      documentId: created.documentId, expectedCurrentRevisionId: created.revisionId,
      title: "Authority Doc", markdown: "changed", metadata: {},
    });
    expect(revised).toEqual({ revisionId: expect.any(String), revisionNo: 2, changed: true });
  });

  it("rejects SOURCE_MANAGED writes through Hub commands without DB change", async () => {
    const fixture = await setupAuthorityFixture(poolA);
    const hub = new HubKnowledgeCommandServiceImpl(new MariaDbUnitOfWork(poolA));
    await expect(
      hub.createDocument(callerFromIdentity(owner), {
        sourceId: fixture.managedSourceId, parentId: fixture.managedFolderId,
        title: "No", markdown: "no", metadata: {},
      }),
    ).rejects.toMatchObject({ name: "SourceReadOnlyError", code: "SOURCE_MANAGED_READ_ONLY" });
    const managed = await insertManagedDocument(poolA, fixture.managedSourceId, fixture.managedFolderId);
    const failure = await hub.createRevision(callerFromIdentity(owner), {
      documentId: managed.documentId, expectedCurrentRevisionId: managed.revisionId,
      title: "No", markdown: "no", metadata: {},
    }).then(
      (): null => null,
      (caught: unknown) => caught,
    );
    expect(failure).toBeInstanceOf(SourceReadOnlyError);
    expect((failure as SourceReadOnlyError).code).toBe("SOURCE_MANAGED_READ_ONLY");
    expect(await countRevisions(poolA, managed.documentId)).toBe(1);
  });

  it("rejects writes against an archived Source", async () => {
    const fixture = await setupAuthorityFixture(poolA);
    const hub = new HubKnowledgeCommandServiceImpl(new MariaDbUnitOfWork(poolA));
    await expect(
      hub.createDocument(callerFromIdentity(owner), {
        sourceId: fixture.archivedSourceId, parentId: fixture.archivedFolderId,
        title: "No", markdown: "no", metadata: {},
      }),
    ).rejects.toBeInstanceOf(SourceArchivedError);
    const archivedDoc = await insertManagedDocument(poolA, fixture.archivedSourceId, fixture.archivedFolderId);
    await expect(
      hub.createRevision(callerFromIdentity(owner), {
        documentId: archivedDoc.documentId, expectedCurrentRevisionId: archivedDoc.revisionId,
        title: "No", markdown: "no", metadata: {},
      }),
    ).rejects.toBeInstanceOf(SourceArchivedError);
    expect(await countRevisions(poolA, archivedDoc.documentId)).toBe(1);
  });

  it("rejects invalid parents", async () => {
    const fixture = await setupAuthorityFixture(poolA);
    const other = await setupAuthorityFixture(poolA);
    const hub = new HubKnowledgeCommandServiceImpl(new MariaDbUnitOfWork(poolA));
    const base = { sourceId: fixture.hubSourceId, title: "No", markdown: "no", metadata: {} } as const;
    await expect(hub.createDocument(callerFromIdentity(owner), { ...base, parentId: other.hubFolderId })).rejects.toBeInstanceOf(InvalidParentError);
    await expect(hub.createDocument(callerFromIdentity(owner), { ...base, parentId: uuidv7() })).rejects.toBeInstanceOf(TreeNodeNotFoundError);
    const created = await hub.createDocument(callerFromIdentity(owner), { ...base, parentId: fixture.hubFolderId });
    const nodes = await new MariaDbUnitOfWork(poolA).run((repositories) => repositories.tree.listBySource(fixture.hubSourceId));
    const documentNode = nodes.find((node) => node.documentId === created.documentId);
    await expect(hub.createDocument(callerFromIdentity(owner), { ...base, parentId: documentNode!.id })).rejects.toBeInstanceOf(InvalidParentError);
  });

  it("rejects revisions on archived documents", async () => {
    const fixture = await setupAuthorityFixture(poolA);
    const hub = new HubKnowledgeCommandServiceImpl(new MariaDbUnitOfWork(poolA));
    const created = await hub.createDocument(callerFromIdentity(owner), {
      sourceId: fixture.hubSourceId, parentId: fixture.hubFolderId,
      title: "Doomed", markdown: "body", metadata: {},
    });
    await new MariaDbUnitOfWork(poolA).run(async (repositories) => {
      await repositories.documents.updateStatus(created.documentId, "ARCHIVED", owner.id);
      await repositories.tree.updateStatusForDocument(created.documentId, "ARCHIVED", owner.id);
    });
    await expect(
      hub.createRevision(callerFromIdentity(owner), {
        documentId: created.documentId, expectedCurrentRevisionId: created.revisionId,
        title: "Doomed", markdown: "changed", metadata: {},
      }),
    ).rejects.toBeInstanceOf(DocumentArchivedError);
    expect(await countRevisions(poolA, created.documentId)).toBe(1);
  });

  it("rejects stale expected revisions across two real connections without writing", async () => {
    const fixture = await setupAuthorityFixture(poolA);
    const writerA = new HubKnowledgeCommandServiceImpl(new MariaDbUnitOfWork(poolA));
    const writerB = new HubKnowledgeCommandServiceImpl(new MariaDbUnitOfWork(poolB));
    const created = await writerA.createDocument(callerFromIdentity(owner), {
      sourceId: fixture.hubSourceId, parentId: fixture.hubFolderId,
      title: "Racy", markdown: "v1", metadata: {},
    });
    const second = await writerB.createRevision(callerFromIdentity(owner), {
      documentId: created.documentId, expectedCurrentRevisionId: created.revisionId,
      title: "Racy", markdown: "v2", metadata: {},
    });
    expect(second.revisionNo).toBe(2);
    const stale = await writerA.createRevision(callerFromIdentity(owner), {
      documentId: created.documentId, expectedCurrentRevisionId: created.revisionId,
      title: "Racy", markdown: "stale", metadata: {},
    }).then(
      (): null => null,
      (caught: unknown) => caught,
    );
    expect(stale).toBeInstanceOf(RevisionConflictError);
    expect((stale as RevisionConflictError).code).toBe("REVISION_CONFLICT");
    expect(await countRevisions(poolA, created.documentId)).toBe(2);
  });

  it("ignores caller/workspace spoofing smuggled inside the payload", async () => {
    const fixture = await setupAuthorityFixture(poolA);
    const hub = new HubKnowledgeCommandServiceImpl(new MariaDbUnitOfWork(poolA));
    const spoofedCreate = {
      sourceId: fixture.hubSourceId, parentId: fixture.hubFolderId,
      title: "Spoof", markdown: "body", metadata: {},
      callerId: owner.id, workspaceId: fixture.workspaceId, identity: owner,
    } as unknown as CreateHubDocumentInput;
    await expect(hub.createDocument(callerFromIdentity(outsider), spoofedCreate)).rejects.toThrow();
    const created = await hub.createDocument(callerFromIdentity(owner), {
      sourceId: fixture.hubSourceId, parentId: fixture.hubFolderId,
      title: "Honest", markdown: "body", metadata: {},
      workspaceId: uuidv7(),
    } as unknown as CreateHubDocumentInput);
    expect(created.documentId).toBeTruthy();
    const spoofedRevision = {
      documentId: created.documentId, expectedCurrentRevisionId: created.revisionId,
      title: "Honest", markdown: "spoofed", metadata: {},
      callerId: owner.id, workspaceId: fixture.workspaceId,
    } as unknown as Parameters<HubKnowledgeCommandServiceImpl["createRevision"]>[1];
    await expect(hub.createRevision(callerFromIdentity(outsider), spoofedRevision)).rejects.toThrow();
    expect(await countRevisions(poolA, created.documentId)).toBe(1);
  });
});
