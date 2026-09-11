import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { HubKnowledgeCommandServiceImpl } from "@/modules/knowledge/application/hub-knowledge-command-service";
import { KnowledgeQueryServiceImpl } from "@/modules/knowledge/application/knowledge-query-service";
import { SourceApplicationService } from "@/modules/sources/application/source-version-guard";
import { callerFromIdentity } from "@/modules/identity/domain/caller-context";
import type { UserIdentity } from "@/modules/identity/domain/user-identity";
import {
  DocumentNotFoundError,
  FolderNotEmptyError,
  InvalidParentError,
  SourceArchivedError,
  SourceNotFoundError,
  SourceReadOnlyError,
  TreeNodeNotFoundError,
  ValidationError,
} from "@/modules/knowledge/domain/errors";
import { WorkspaceAccessDeniedError } from "@/modules/workspaces/domain/errors";
import { normalizeRevisionContent, revisionContentHash } from "@/modules/knowledge/domain/content";
import { uuidv7 } from "@/shared/ids/uuidv7";
import { createEntryFixture, createFolderEntryFixture, fixtureIdentity, secondFixtureIdentity } from "../fixtures/knowledge";
import { disposeIsolatedDatabase, provisionIsolatedDatabase } from "../../scripts/db/test-database";
import { runMigrations, type IsolatedDatabaseHandle } from "../../scripts/db/migrate";

const owner: UserIdentity = { id: "0199f300-0000-7000-8000-000000000001", emp_id: "LIFE-OWNER", name: "Lifecycle Owner", org_code: "HRSD" };
const outsider: UserIdentity = { id: "0199f300-0000-7000-8000-000000000002", emp_id: "LIFE-OUT", name: "Lifecycle Outsider", org_code: "HRSD" };

let handle: IsolatedDatabaseHandle;
let pool: Pool;

beforeAll(async () => {
  handle = await provisionIsolatedDatabase("test");
  const previous = process.env.KM_TEST_DB_NAME;
  process.env.KM_TEST_DB_NAME = handle.databaseName;
  try {
    pool = createDatabasePool(databaseConfig("test"));
  } finally {
    if (previous === undefined) delete process.env.KM_TEST_DB_NAME;
    else process.env.KM_TEST_DB_NAME = previous;
  }
  await runMigrations(pool);
});

afterAll(async () => {
  await pool.end();
  await disposeIsolatedDatabase(handle);
});

type LifecycleScope = {
  workspaceId: string;
  hubSourceId: string;
  hubFolderId: string;
  managedSourceId: string;
  managedFolderId: string;
};

async function setupLifecycleScope(): Promise<LifecycleScope> {
  const workspaceId = uuidv7();
  const hubSourceId = uuidv7();
  const hubFolderId = uuidv7();
  const managedSourceId = uuidv7();
  const managedFolderId = uuidv7();
  const now = new Date();
  await new MariaDbUnitOfWork(pool).run(async (repositories) => {
    await repositories.users.upsertIdentity(owner);
    await repositories.users.upsertIdentity(fixtureIdentity);
    await repositories.users.upsertIdentity(secondFixtureIdentity);
    await repositories.workspaces.insert({ id: workspaceId, name: "Lifecycle Workspace", createdAt: now, updatedAt: now });
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
    for (const [folderId, sourceId, name] of [
      [hubFolderId, hubSourceId, "Hub Folder"],
      [managedFolderId, managedSourceId, "Managed Folder"],
    ] as const) {
      await repositories.tree.insert({
        id: folderId, sourceId, parentId: null, nodeType: "FOLDER", name,
        documentId: null, position: 0, status: "ACTIVE", updatedBy: owner.id, archivedBy: null, archivedAt: null,
      });
    }
  });
  return { workspaceId, hubSourceId, hubFolderId, managedSourceId, managedFolderId };
}

function lifecycleServices() {
  const unitOfWork = new MariaDbUnitOfWork(pool);
  const queries = new KnowledgeQueryServiceImpl(unitOfWork);
  return {
    hub: new HubKnowledgeCommandServiceImpl(unitOfWork),
    queries,
    sources: new SourceApplicationService(unitOfWork),
  };
}

async function insertManagedDocument(sourceId: string, folderId: string): Promise<{ documentId: string; revisionId: string }> {
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

type LifecycleRow = {
  status: string;
  updated_by: string;
  archived_by: string | null;
  archived_at: Date | string | null;
};

async function readDocumentRow(documentId: string) {
  const rows = await pool.query<(LifecycleRow & { id: string; current_revision_id: string })[]>(
    "SELECT id, current_revision_id, status, updated_by, archived_by, archived_at FROM knowledge_documents WHERE id = ?",
    [documentId],
  );
  return rows[0];
}

async function readDocumentNode(documentId: string) {
  const rows = await pool.query<(LifecycleRow & { id: string })[]>(
    "SELECT id, status, updated_by, archived_by, archived_at FROM knowledge_tree_nodes WHERE document_id = ?",
    [documentId],
  );
  return rows[0];
}

async function readFolderNode(nodeId: string) {
  const rows = await pool.query<(LifecycleRow & { id: string })[]>(
    "SELECT id, status, updated_by, archived_by, archived_at FROM knowledge_tree_nodes WHERE id = ?",
    [nodeId],
  );
  return rows[0];
}

async function readDocumentEntry(documentId: string) {
  const rows = await pool.query<LifecycleRow[]>(
    "SELECT status, updated_by, archived_by, archived_at FROM source_entries WHERE document_id = ?",
    [documentId],
  );
  return rows[0];
}

async function readFolderEntry(treeNodeId: string) {
  const rows = await pool.query<LifecycleRow[]>(
    "SELECT status, updated_by, archived_by, archived_at FROM source_entries WHERE tree_node_id = ?",
    [treeNodeId],
  );
  return rows[0];
}

async function readSourceRow(sourceId: string) {
  const rows = await pool.query<(LifecycleRow & { id: string })[]>(
    "SELECT id, status, updated_by, archived_by, archived_at FROM knowledge_sources WHERE id = ?",
    [sourceId],
  );
  return rows[0];
}

async function readRevisionFingerprint(documentId: string) {
  const rows = await pool.query<{ id: string; revision_no: number; content_hash: string }[]>(
    "SELECT id, revision_no, content_hash FROM knowledge_revisions WHERE document_id = ? ORDER BY revision_no",
    [documentId],
  );
  return rows;
}

function expectArchivedBy(row: LifecycleRow | undefined, actorId: string) {
  expect(row?.status).toBe("ARCHIVED");
  expect(row?.updated_by).toBe(actorId);
  expect(row?.archived_by).toBe(actorId);
  expect(row?.archived_at).not.toBeNull();
}

function expectActiveCleared(row: LifecycleRow | undefined, actorId: string) {
  expect(row?.status).toBe("ACTIVE");
  expect(row?.updated_by).toBe(actorId);
  expect(row?.archived_by).toBeNull();
  expect(row?.archived_at).toBeNull();
}

describe("document lifecycle", () => {
  it("archives and restores Document, TreeNode, and linked SourceEntry atomically with history intact", async () => {
    const scope = await setupLifecycleScope();
    const { hub, queries } = lifecycleServices();
    const caller = callerFromIdentity(owner);
    const created = await hub.createDocument(caller, {
      sourceId: scope.hubSourceId, parentId: scope.hubFolderId,
      title: "Lifecycle Doc", markdown: "lifecycle body", metadata: {},
    });
    await createEntryFixture(pool, scope.hubSourceId, created.documentId);
    const revisionsBefore = await readRevisionFingerprint(created.documentId);
    const pointerBefore = (await readDocumentRow(created.documentId))?.current_revision_id;

    await hub.archiveDocument(caller, created.documentId);
    expectArchivedBy(await readDocumentRow(created.documentId), owner.id);
    expectArchivedBy(await readDocumentNode(created.documentId), owner.id);
    expectArchivedBy(await readDocumentEntry(created.documentId), owner.id);
    expect(await readRevisionFingerprint(created.documentId)).toEqual(revisionsBefore);
    expect((await readDocumentRow(created.documentId))?.current_revision_id).toBe(pointerBefore);
    await expect(queries.getDocument(caller, created.documentId)).rejects.toBeInstanceOf(DocumentNotFoundError);

    await hub.restoreDocument(caller, created.documentId);
    expectActiveCleared(await readDocumentRow(created.documentId), owner.id);
    expectActiveCleared(await readDocumentNode(created.documentId), owner.id);
    expectActiveCleared(await readDocumentEntry(created.documentId), owner.id);
    expect(await readRevisionFingerprint(created.documentId)).toEqual(revisionsBefore);
    const restored = await readDocumentRow(created.documentId);
    expect(restored?.id).toBe(created.documentId);
    expect(restored?.current_revision_id).toBe(pointerBefore);
    expect((await queries.getDocument(caller, created.documentId)).documentId).toBe(created.documentId);
  });

  it("treats repeat archive and restore as provenance-preserving NOOPs", async () => {
    const scope = await setupLifecycleScope();
    const { hub } = lifecycleServices();
    const caller = callerFromIdentity(owner);
    const created = await hub.createDocument(caller, {
      sourceId: scope.hubSourceId, parentId: scope.hubFolderId,
      title: "Idempotent", markdown: "body", metadata: {},
    });
    await hub.restoreDocument(caller, created.documentId);
    expect((await readDocumentRow(created.documentId))?.status).toBe("ACTIVE");
    await hub.archiveDocument(caller, created.documentId);
    const firstArchive = await readDocumentRow(created.documentId);
    await hub.archiveDocument(caller, created.documentId);
    expect(await readDocumentRow(created.documentId)).toEqual(firstArchive);
  });

  it("rejects Hub document lifecycle on SOURCE_MANAGED sources without DB change", async () => {
    const scope = await setupLifecycleScope();
    const { hub } = lifecycleServices();
    const caller = callerFromIdentity(owner);
    const managed = await insertManagedDocument(scope.managedSourceId, scope.managedFolderId);
    const archive = await hub.archiveDocument(caller, managed.documentId).then(
      (): null => null,
      (caught: unknown) => caught,
    );
    expect(archive).toBeInstanceOf(SourceReadOnlyError);
    expect((archive as SourceReadOnlyError).code).toBe("SOURCE_MANAGED_READ_ONLY");
    const restore = await hub.restoreDocument(caller, managed.documentId).then(
      (): null => null,
      (caught: unknown) => caught,
    );
    expect(restore).toBeInstanceOf(SourceReadOnlyError);
    expect((restore as SourceReadOnlyError).code).toBe("SOURCE_MANAGED_READ_ONLY");
    expect((await readDocumentRow(managed.documentId))?.status).toBe("ACTIVE");
    expect((await readDocumentNode(managed.documentId))?.status).toBe("ACTIVE");
  });

  it("refuses document restore into an archived source", async () => {
    const scope = await setupLifecycleScope();
    const { hub, sources } = lifecycleServices();
    const caller = callerFromIdentity(owner);
    const created = await hub.createDocument(caller, {
      sourceId: scope.hubSourceId, parentId: scope.hubFolderId,
      title: "Stranded", markdown: "body", metadata: {},
    });
    await hub.archiveDocument(caller, created.documentId);
    await sources.archiveSource(caller, scope.hubSourceId);
    const restore = await hub.restoreDocument(caller, created.documentId).then(
      (): null => null,
      (caught: unknown) => caught,
    );
    expect(restore).toBeInstanceOf(SourceArchivedError);
    expect((restore as SourceArchivedError).code).toBe("SOURCE_ARCHIVED");
    expect((await readDocumentRow(created.documentId))?.status).toBe("ARCHIVED");
  });
});

describe("folder lifecycle", () => {
  it("archives an empty folder with entry provenance and restores it", async () => {
    const scope = await setupLifecycleScope();
    const { hub } = lifecycleServices();
    const caller = callerFromIdentity(owner);
    const { treeNodeId } = await hub.createFolder(caller, {
      sourceId: scope.hubSourceId, parentId: scope.hubFolderId, name: "Empty",
    });
    await createFolderEntryFixture(pool, scope.hubSourceId, treeNodeId);
    await hub.archiveFolder(caller, treeNodeId);
    expectArchivedBy(await readFolderNode(treeNodeId), owner.id);
    expectArchivedBy(await readFolderEntry(treeNodeId), owner.id);
    await hub.restoreFolder(caller, treeNodeId);
    expectActiveCleared(await readFolderNode(treeNodeId), owner.id);
    expectActiveCleared(await readFolderEntry(treeNodeId), owner.id);
  });

  it("refuses a non-empty folder with FOLDER_NOT_EMPTY and leaves descendants unchanged", async () => {
    const scope = await setupLifecycleScope();
    const { hub } = lifecycleServices();
    const caller = callerFromIdentity(owner);
    const created = await hub.createDocument(caller, {
      sourceId: scope.hubSourceId, parentId: scope.hubFolderId,
      title: "Blocking Doc", markdown: "body", metadata: {},
    });
    const failure = await hub.archiveFolder(caller, scope.hubFolderId).then(
      (): null => null,
      (caught: unknown) => caught,
    );
    expect(failure).toBeInstanceOf(FolderNotEmptyError);
    expect((failure as FolderNotEmptyError).code).toBe("FOLDER_NOT_EMPTY");
    expect((await readFolderNode(scope.hubFolderId))?.status).toBe("ACTIVE");
    expect((await readDocumentRow(created.documentId))?.status).toBe("ACTIVE");
    expect((await readDocumentNode(created.documentId))?.status).toBe("ACTIVE");
  });

  it("archives a folder with only archived children without cascading", async () => {
    const scope = await setupLifecycleScope();
    const { hub } = lifecycleServices();
    const caller = callerFromIdentity(owner);
    const created = await hub.createDocument(caller, {
      sourceId: scope.hubSourceId, parentId: scope.hubFolderId,
      title: "Archived Child", markdown: "body", metadata: {},
    });
    await hub.archiveDocument(caller, created.documentId);
    await hub.archiveFolder(caller, scope.hubFolderId);
    expect((await readFolderNode(scope.hubFolderId))?.status).toBe("ARCHIVED");
    expect((await readDocumentRow(created.documentId))?.status).toBe("ARCHIVED");
    await hub.restoreFolder(caller, scope.hubFolderId);
    expect((await readFolderNode(scope.hubFolderId))?.status).toBe("ACTIVE");
    expect((await readDocumentRow(created.documentId))?.status).toBe("ARCHIVED");
    expect((await readDocumentNode(created.documentId))?.status).toBe("ARCHIVED");
  });

  it("restores folders only under active parents and rejects document nodes", async () => {
    const scope = await setupLifecycleScope();
    const { hub } = lifecycleServices();
    const caller = callerFromIdentity(owner);
    const child = await hub.createFolder(caller, {
      sourceId: scope.hubSourceId, parentId: scope.hubFolderId, name: "Child",
    });
    const created = await hub.createDocument(caller, {
      sourceId: scope.hubSourceId, parentId: scope.hubFolderId,
      title: "Not A Folder", markdown: "body", metadata: {},
    });
    const nodes = await new MariaDbUnitOfWork(pool).run((repositories) => repositories.tree.listBySource(scope.hubSourceId));
    const documentNodeId = nodes.find((node) => node.documentId === created.documentId)!.id;
    await expect(hub.archiveFolder(caller, documentNodeId)).rejects.toBeInstanceOf(ValidationError);
    await hub.archiveDocument(caller, created.documentId);
    await hub.archiveFolder(caller, child.treeNodeId);
    await hub.archiveFolder(caller, scope.hubFolderId);
    await expect(hub.restoreFolder(caller, child.treeNodeId)).rejects.toBeInstanceOf(InvalidParentError);
    expect((await readFolderNode(child.treeNodeId))?.status).toBe("ARCHIVED");
    await hub.restoreFolder(caller, scope.hubFolderId);
    await hub.restoreFolder(caller, child.treeNodeId);
    expect((await readFolderNode(child.treeNodeId))?.status).toBe("ACTIVE");
  });
});

describe("source lifecycle", () => {
  it("archives and restores both ownerships as a visibility gate with descendants unchanged", async () => {
    const scope = await setupLifecycleScope();
    const { hub, queries, sources } = lifecycleServices();
    const caller = callerFromIdentity(owner);
    const hubDoc = await hub.createDocument(caller, {
      sourceId: scope.hubSourceId, parentId: scope.hubFolderId,
      title: "Gated", markdown: "body", metadata: {},
    });
    await createEntryFixture(pool, scope.hubSourceId, hubDoc.documentId);
    const managed = await insertManagedDocument(scope.managedSourceId, scope.managedFolderId);

    for (const sourceId of [scope.hubSourceId, scope.managedSourceId]) {
      await sources.archiveSource(caller, sourceId);
      expectArchivedBy(await readSourceRow(sourceId), owner.id);
    }
    expect((await readDocumentRow(hubDoc.documentId))?.status).toBe("ACTIVE");
    expect((await readDocumentNode(hubDoc.documentId))?.status).toBe("ACTIVE");
    expect((await readDocumentEntry(hubDoc.documentId))?.status).toBe("ACTIVE");
    expect((await readDocumentRow(managed.documentId))?.status).toBe("ACTIVE");
    expect((await readDocumentNode(managed.documentId))?.status).toBe("ACTIVE");
    await expect(queries.getDocument(caller, hubDoc.documentId)).rejects.toBeInstanceOf(DocumentNotFoundError);
    expect(await queries.listTree(caller, scope.hubSourceId)).toEqual([]);

    for (const sourceId of [scope.hubSourceId, scope.managedSourceId]) {
      await sources.restoreSource(caller, sourceId);
      expectActiveCleared(await readSourceRow(sourceId), owner.id);
    }
    expect((await readDocumentRow(hubDoc.documentId))?.status).toBe("ACTIVE");
    expect((await queries.getDocument(caller, hubDoc.documentId)).documentId).toBe(hubDoc.documentId);
  });

  it("treats repeat source archive and restore as NOOPs", async () => {
    const scope = await setupLifecycleScope();
    const { sources } = lifecycleServices();
    const caller = callerFromIdentity(owner);
    await sources.restoreSource(caller, scope.hubSourceId);
    expect((await readSourceRow(scope.hubSourceId))?.status).toBe("ACTIVE");
    await sources.archiveSource(caller, scope.hubSourceId);
    const firstArchive = await readSourceRow(scope.hubSourceId);
    await sources.archiveSource(caller, scope.hubSourceId);
    expect(await readSourceRow(scope.hubSourceId)).toEqual(firstArchive);
  });
});

describe("lifecycle access", () => {
  it("rejects lifecycle operations by UUID for callers without Workspace membership", async () => {
    const scope = await setupLifecycleScope();
    const { hub, sources } = lifecycleServices();
    const member = callerFromIdentity(owner);
    const stranger = callerFromIdentity(outsider);
    const created = await hub.createDocument(member, {
      sourceId: scope.hubSourceId, parentId: scope.hubFolderId,
      title: "Secret Archive Target", markdown: "secret archive body", metadata: {},
    });
    const attempts: Array<() => Promise<unknown>> = [
      () => hub.archiveDocument(stranger, created.documentId),
      () => hub.restoreDocument(stranger, created.documentId),
      () => hub.archiveFolder(stranger, scope.hubFolderId),
      () => hub.restoreFolder(stranger, scope.hubFolderId),
      () => sources.archiveSource(stranger, scope.hubSourceId),
      () => sources.restoreSource(stranger, scope.hubSourceId),
    ];
    for (const attempt of attempts) {
      const failure = await attempt().then(
        (): null => null,
        (caught: unknown) => caught,
      );
      expect(failure).toBeInstanceOf(WorkspaceAccessDeniedError);
      expect((failure as WorkspaceAccessDeniedError).code).toBe("WORKSPACE_ACCESS_DENIED");
      expect(String((failure as Error).message)).not.toContain("Secret Archive Target");
      expect(String((failure as Error).message)).not.toContain("secret archive body");
    }
    expect((await readDocumentRow(created.documentId))?.status).toBe("ACTIVE");
    expect((await readFolderNode(scope.hubFolderId))?.status).toBe("ACTIVE");
    expect((await readSourceRow(scope.hubSourceId))?.status).toBe("ACTIVE");
  });

  it("returns precise not-found codes for unknown lifecycle targets", async () => {
    const { hub, sources } = lifecycleServices();
    const caller = callerFromIdentity(owner);
    await expect(hub.archiveDocument(caller, uuidv7())).rejects.toMatchObject({
      name: "DocumentNotFoundError", code: "DOCUMENT_NOT_FOUND",
    });
    await expect(hub.restoreDocument(caller, uuidv7())).rejects.toBeInstanceOf(DocumentNotFoundError);
    await expect(hub.archiveFolder(caller, uuidv7())).rejects.toMatchObject({
      name: "TreeNodeNotFoundError", code: "TREE_NODE_NOT_FOUND",
    });
    expect(await hub.restoreFolder(caller, uuidv7()).then(
      (): null => null,
      (caught: unknown) => caught,
    )).toBeInstanceOf(TreeNodeNotFoundError);
    await expect(sources.archiveSource(caller, uuidv7())).rejects.toMatchObject({
      name: "SourceNotFoundError", code: "SOURCE_NOT_FOUND",
    });
    await expect(sources.restoreSource(caller, uuidv7())).rejects.toBeInstanceOf(SourceNotFoundError);
  });
});
