import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { HubKnowledgeCommandServiceImpl } from "@/modules/knowledge/application/hub-knowledge-command-service";
import {
  CrossSourceMoveError,
  DocumentNotFoundError,
  FolderNotEmptyError,
  HubManagedOperationRequiredError,
  InvalidParentError,
  InvalidSourceMappingError,
  SourceEntryConflictError,
  TreeNodeNotFoundError,
  VersionConflictError,
} from "@/modules/knowledge/domain/errors";
import { WorkspaceAccessDeniedError } from "@/modules/workspaces/domain/errors";
import { callerFromIdentity } from "@/modules/identity/domain/caller-context";
import type { UserIdentity } from "@/modules/identity/domain/user-identity";
import { bindSourceProjection } from "@/modules/sources/application/source-knowledge-projection-service";
import {
  archiveSourceEntry,
  createSourceEntryMapping,
  getSourceEntry,
  resolveByExternalId,
  restoreSourceEntry,
  updateSourceLocator,
} from "@/modules/sources/application/source-entry-mapping-service";
import { SourceApplicationService } from "@/modules/sources/application/source-version-guard";
import { uuidv7 } from "@/shared/ids/uuidv7";
import { disposeIsolatedDatabase, provisionIsolatedDatabase } from "../../scripts/db/test-database";
import { runMigrations, type IsolatedDatabaseHandle } from "../../scripts/db/migrate";

const owner: UserIdentity = { id: "0199f400-0000-7000-8000-000000000001", emp_id: "MAP-OWNER", name: "Mapping Owner", org_code: "HRSD" };
const outsider: UserIdentity = { id: "0199f400-0000-7000-8000-000000000002", emp_id: "MAP-OUT", name: "Mapping Outsider", org_code: "HRSD" };

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

type MappingScope = {
  workspaceId: string;
  managedSourceId: string;
  managedFolderId: string;
  hubSourceId: string;
  hubFolderId: string;
};

async function setupMappingScope(): Promise<MappingScope> {
  const workspaceId = uuidv7();
  const managedSourceId = uuidv7();
  const managedFolderId = uuidv7();
  const hubSourceId = uuidv7();
  const hubFolderId = uuidv7();
  const now = new Date();
  await new MariaDbUnitOfWork(pool).run(async (repositories) => {
    await repositories.users.upsertIdentity(owner);
    await repositories.users.upsertIdentity(outsider);
    await repositories.workspaces.insert({ id: workspaceId, name: "Mapping Workspace", createdAt: now, updatedAt: now });
    await repositories.workspaceMemberships.insert({ workspaceId, userId: owner.id, createdAt: now });
    await repositories.sources.insert({
      id: managedSourceId, name: "Managed Source", workspaceId, sourceType: "FOLDER_SYNC", ownership: "SOURCE_MANAGED",
      status: "ACTIVE", syncVersion: 0, createdBy: owner.id, updatedBy: owner.id,
      archivedBy: null, archivedAt: null, createdAt: now, updatedAt: now,
    });
    await repositories.sources.insert({
      id: hubSourceId, name: "Hub Source", workspaceId, sourceType: "HUB", ownership: "HUB_MANAGED",
      status: "ACTIVE", syncVersion: 0, createdBy: owner.id, updatedBy: owner.id,
      archivedBy: null, archivedAt: null, createdAt: now, updatedAt: now,
    });
    for (const [folderId, sourceId] of [[managedFolderId, managedSourceId], [hubFolderId, hubSourceId]] as const) {
      await repositories.tree.insert({
        id: folderId, sourceId, parentId: null, nodeType: "FOLDER", name: "Root",
        documentId: null, position: 0, status: "ACTIVE", updatedBy: owner.id, archivedBy: null, archivedAt: null,
      });
    }
  });
  return { workspaceId, managedSourceId, managedFolderId, hubSourceId, hubFolderId };
}

async function countRows(table: string, column: string, value: string): Promise<number> {
  const rows = await pool.query<{ count: number }[]>(`SELECT COUNT(*) AS count FROM ${table} WHERE ${column} = ?`, [value]);
  return Number(rows[0]?.count ?? 0);
}

describe("source entry mapping primitives", () => {
  it("keeps stable folder/document mappings across locator path changes", async () => {
    const scope = await setupMappingScope();
    const caller = callerFromIdentity(owner);
    const folderEntryId = uuidv7();
    const projected = await new MariaDbUnitOfWork(pool).run(async (repositories) => {
      const projection = bindSourceProjection(repositories, { id: scope.managedSourceId, workspaceId: scope.workspaceId });
      const folder = await projection.projectFolder(caller, {
        sourceId: scope.managedSourceId,
        mapping: { sourceEntryId: folderEntryId, externalId: `folder-${uuidv7()}`, sourcePath: "docs/area" },
        parentId: scope.managedFolderId, name: "Area",
      });
      const document = await projection.projectDocument(caller, {
        sourceId: scope.managedSourceId, parentId: folder.treeNodeId,
        title: "Mapped", markdown: "body", metadata: {},
        mapping: { sourceEntryId: uuidv7(), externalId: `doc-${uuidv7()}`, sourcePath: "docs/area/note.md" },
      });
      return { folder, document };
    });
    const before = await new MariaDbUnitOfWork(pool).run((repositories) => repositories.entries.findById(folderEntryId));
    expect(before).toMatchObject({ sourceId: scope.managedSourceId, documentId: null, treeNodeId: projected.folder.treeNodeId, status: "ACTIVE" });
    const docEntryId = (await pool.query<{ id: string }[]>("SELECT id FROM source_entries WHERE tree_node_id = ?", [projected.document.treeNodeId]))[0].id;
    const updated = await new MariaDbUnitOfWork(pool).run((repositories) =>
      updateSourceLocator(repositories, caller, scope.managedSourceId, docEntryId, "docs/area/renamed.md", "0".repeat(64)),
    );
    expect(updated).toMatchObject({ id: docEntryId, documentId: projected.document.documentId, treeNodeId: projected.document.treeNodeId, sourcePath: "docs/area/renamed.md" });
    const reread = await new MariaDbUnitOfWork(pool).run((repositories) => getSourceEntry(repositories, docEntryId));
    expect(reread).toMatchObject({ documentId: projected.document.documentId, treeNodeId: projected.document.treeNodeId });
  });

  it("rejects duplicate external IDs in one source but allows them across sources", async () => {
    const scope = await setupMappingScope();
    const first = await setupMappingScope();
    const caller = callerFromIdentity(owner);
    const externalId = `dupe-${uuidv7()}`;
    await new MariaDbUnitOfWork(pool).run(async (repositories) => {
      const projection = bindSourceProjection(repositories, { id: scope.managedSourceId, workspaceId: scope.workspaceId });
      await projection.projectDocument(caller, {
        sourceId: scope.managedSourceId, parentId: scope.managedFolderId,
        title: "First", markdown: "a", metadata: {},
        mapping: { sourceEntryId: uuidv7(), externalId, sourcePath: "docs/first.md" },
      });
      await expect(projection.projectDocument(caller, {
        sourceId: scope.managedSourceId, parentId: scope.managedFolderId,
        title: "Second", markdown: "b", metadata: {},
        mapping: { sourceEntryId: uuidv7(), externalId, sourcePath: "docs/second.md" },
      })).rejects.toBeInstanceOf(SourceEntryConflictError);
      const other = bindSourceProjection(repositories, { id: first.managedSourceId, workspaceId: first.workspaceId });
      await other.projectDocument(callerFromIdentity(owner), {
        sourceId: first.managedSourceId, parentId: first.managedFolderId,
        title: "Other", markdown: "c", metadata: {},
        mapping: { sourceEntryId: uuidv7(), externalId, sourcePath: "docs/other.md" },
      });
    });
    const conflict = await new MariaDbUnitOfWork(pool).run((repositories) =>
      resolveByExternalId(repositories, scope.managedSourceId, externalId),
    );
    expect(conflict?.sourcePath).toBe("docs/first.md");
  });

  it("never merges same-hash content into one identity and never infers titles from filenames", async () => {
    const scope = await setupMappingScope();
    const caller = callerFromIdentity(owner);
    const content = { title: "Real Title", markdown: "same body", metadata: {} };
    const created = await new MariaDbUnitOfWork(pool).run(async (repositories) => {
      const projection = bindSourceProjection(repositories, { id: scope.managedSourceId, workspaceId: scope.workspaceId });
      const first = await projection.projectDocument(caller, {
        sourceId: scope.managedSourceId, parentId: scope.managedFolderId, ...content,
        mapping: { sourceEntryId: uuidv7(), externalId: `same-hash-a-${uuidv7()}`, sourcePath: "docs/zzz-weird-name.md" },
      });
      const second = await projection.projectDocument(caller, {
        sourceId: scope.managedSourceId, parentId: scope.managedFolderId, ...content,
        mapping: { sourceEntryId: uuidv7(), externalId: `same-hash-b-${uuidv7()}`, sourcePath: "docs/another.md" },
      });
      return { first, second };
    });
    expect(created.first.documentId).not.toBe(created.second.documentId);
    const revisions = await new MariaDbUnitOfWork(pool).run(async (repositories) => ({
      first: await repositories.revisions.findCurrent(created.first.documentId),
      second: await repositories.revisions.findCurrent(created.second.documentId),
    }));
    expect(revisions.first?.title).toBe("Real Title");
    expect(revisions.second?.title).toBe("Real Title");
    expect(revisions.first?.contentHash).toBe(revisions.second?.contentHash);
    await new MariaDbUnitOfWork(pool).run(async (repositories) => {
      const entry = await resolveByExternalId(repositories, scope.managedSourceId, null);
      expect(entry).toBeNull();
      const stored = await repositories.entries.findById(
        (await pool.query<{ id: string }[]>("SELECT id FROM source_entries WHERE tree_node_id = ?", [created.first.treeNodeId]))[0].id,
      );
      await updateSourceLocator(repositories, caller, scope.managedSourceId, stored!.id, "docs/totally-different-slug.md", stored!.contentHash);
    });
    const afterMove = await new MariaDbUnitOfWork(pool).run((repositories) => repositories.revisions.findCurrent(created.first.documentId));
    expect(afterMove?.title).toBe("Real Title");
    expect(await countRows("knowledge_revisions", "document_id", created.first.documentId)).toBe(1);
  });

  it("leaves Hub-native documents without a SourceEntry", async () => {
    const scope = await setupMappingScope();
    const hub = new HubKnowledgeCommandServiceImpl(new MariaDbUnitOfWork(pool));
    const created = await hub.createDocument(callerFromIdentity(owner), {
      sourceId: scope.hubSourceId, parentId: scope.hubFolderId,
      title: "Hub Native", markdown: "hub body", metadata: {},
    });
    expect(await countRows("source_entries", "document_id", created.documentId)).toBe(0);
    expect(await countRows("source_entries", "tree_node_id", created.treeNodeId)).toBe(0);
  });

  it("archives and restores entries with provenance while preserving lastSeenAt on restore", async () => {
    const scope = await setupMappingScope();
    const caller = callerFromIdentity(owner);
    const entryId = uuidv7();
    await new MariaDbUnitOfWork(pool).run(async (repositories) => {
      const projection = bindSourceProjection(repositories, { id: scope.managedSourceId, workspaceId: scope.workspaceId });
      await projection.projectFolder(caller, {
        sourceId: scope.managedSourceId,
        mapping: { sourceEntryId: entryId, externalId: null, sourcePath: "docs/lifecycle" },
        parentId: scope.managedFolderId, name: "Lifecycle",
      });
      const archived = await archiveSourceEntry(repositories, caller, scope.managedSourceId, entryId);
      expect(archived).toMatchObject({ status: "ARCHIVED", archivedBy: owner.id });
      expect(archived.archivedAt).toBeInstanceOf(Date);
      const restored = await restoreSourceEntry(repositories, caller, scope.managedSourceId, entryId);
      expect(restored).toMatchObject({ status: "ACTIVE", archivedBy: null, archivedAt: null });
      expect(restored.lastSeenAt.getTime()).toBe(archived.lastSeenAt.getTime());
      await expect(createSourceEntryMapping(repositories, caller, scope.hubSourceId, {
        sourceEntryId: uuidv7(), externalId: null, sourcePath: "docs/wrong.md",
        entryType: "FOLDER", contentHash: null, documentId: null, treeNodeId: archived.treeNodeId,
      })).rejects.toBeInstanceOf(InvalidSourceMappingError);
    });
  });
});

describe("source projection authority", () => {
  it("accepts SOURCE_MANAGED projection only with Workspace access and rejects HUB_MANAGED", async () => {
    const scope = await setupMappingScope();
    const accepted = await new MariaDbUnitOfWork(pool).run(async (repositories) => {
      const projection = bindSourceProjection(repositories, { id: scope.managedSourceId, workspaceId: scope.workspaceId });
      return projection.projectDocument(callerFromIdentity(owner), {
        sourceId: scope.managedSourceId, parentId: scope.managedFolderId,
        title: "Managed", markdown: "managed", metadata: {},
        mapping: { sourceEntryId: uuidv7(), externalId: `auth-${uuidv7()}`, sourcePath: "docs/managed.md" },
      });
    });
    expect(accepted.documentId).toBeTruthy();
    await expect(new MariaDbUnitOfWork(pool).run(async (repositories) => {
      const projection = bindSourceProjection(repositories, { id: scope.managedSourceId, workspaceId: scope.workspaceId });
      return projection.projectDocument(callerFromIdentity(outsider), {
        sourceId: scope.managedSourceId, parentId: scope.managedFolderId,
        title: "No", markdown: "no", metadata: {},
        mapping: { sourceEntryId: uuidv7(), externalId: null, sourcePath: "docs/no.md" },
      });
    })).rejects.toBeInstanceOf(WorkspaceAccessDeniedError);
    const hubRejection = await new MariaDbUnitOfWork(pool).run(async (repositories) => {
      const projection = bindSourceProjection(repositories, { id: scope.hubSourceId, workspaceId: scope.workspaceId });
      return projection.projectDocument(callerFromIdentity(owner), {
        sourceId: scope.hubSourceId, parentId: scope.hubFolderId,
        title: "No", markdown: "no", metadata: {},
        mapping: { sourceEntryId: uuidv7(), externalId: null, sourcePath: "docs/no.md" },
      }).then(
        (): null => null,
        (caught: unknown) => caught,
      );
    });
    expect(hubRejection).toBeInstanceOf(HubManagedOperationRequiredError);
    expect((hubRejection as HubManagedOperationRequiredError).code).toBe("HUB_MANAGED_OPERATION_REQUIRED");
    expect(await countRows("knowledge_documents", "source_id", scope.hubSourceId)).toBe(0);
  });

  it("never lets input data override the bound source or the explicit caller", async () => {
    const scope = await setupMappingScope();
    const other = await setupMappingScope();
    const caller = callerFromIdentity(owner);
    const { treeNodeId } = await new MariaDbUnitOfWork(pool).run(async (repositories) => {
      const projection = bindSourceProjection(repositories, { id: scope.managedSourceId, workspaceId: scope.workspaceId });
      return projection.projectFolder(caller, {
        sourceId: scope.managedSourceId,
        mapping: { sourceEntryId: uuidv7(), externalId: null, sourcePath: "docs/bound" },
        parentId: scope.managedFolderId, name: "Bound",
      });
    });
    await new MariaDbUnitOfWork(pool).run(async (repositories) => {
      const projection = bindSourceProjection(repositories, { id: scope.managedSourceId, workspaceId: scope.workspaceId });
      await expect(projection.projectDocument(caller, {
        sourceId: other.managedSourceId, parentId: other.managedFolderId,
        title: "No", markdown: "no", metadata: {},
        mapping: { sourceEntryId: uuidv7(), externalId: null, sourcePath: "docs/no.md" },
      })).rejects.toBeInstanceOf(InvalidSourceMappingError);
      await expect(projection.renameProjectedFolder(caller, { nodeId: other.managedFolderId, name: "Hijack" })).rejects.toBeInstanceOf(TreeNodeNotFoundError);
      const spoofed = {
        sourceId: scope.managedSourceId, parentId: scope.managedFolderId,
        title: "Spoof", markdown: "spoof", metadata: {},
        mapping: { sourceEntryId: uuidv7(), externalId: null, sourcePath: "docs/spoof.md" },
        callerId: owner.id, workspaceId: scope.workspaceId, identity: owner,
      } as unknown as Parameters<typeof projection.projectDocument>[1];
      await expect(projection.projectDocument(callerFromIdentity(outsider), spoofed)).rejects.toBeInstanceOf(WorkspaceAccessDeniedError);
      const misbound = bindSourceProjection(repositories, { id: scope.managedSourceId, workspaceId: uuidv7() });
      await expect(misbound.renameProjectedFolder(caller, { nodeId: treeNodeId, name: "Misbound" })).rejects.toBeInstanceOf(InvalidSourceMappingError);
    });
    const hub = new HubKnowledgeCommandServiceImpl(new MariaDbUnitOfWork(pool));
    const hubDoc = await hub.createDocument(caller, {
      sourceId: scope.hubSourceId, parentId: scope.hubFolderId,
      title: "Hub Doc", markdown: "hub", metadata: {},
    });
    await expect(new MariaDbUnitOfWork(pool).run(async (repositories) => {
      const projection = bindSourceProjection(repositories, { id: scope.managedSourceId, workspaceId: scope.workspaceId });
      return projection.archiveProjectedDocument(caller, hubDoc.documentId);
    })).rejects.toBeInstanceOf(DocumentNotFoundError);
  });

  it("creates projected folders with rename/archive/restore provenance and ancestor-first restore", async () => {
    const scope = await setupMappingScope();
    const caller = callerFromIdentity(owner);
    const parentEntryId = uuidv7();
    const childEntryId = uuidv7();
    const { parentId, childId } = await new MariaDbUnitOfWork(pool).run(async (repositories) => {
      const projection = bindSourceProjection(repositories, { id: scope.managedSourceId, workspaceId: scope.workspaceId });
      const parent = await projection.projectFolder(caller, {
        sourceId: scope.managedSourceId,
        mapping: { sourceEntryId: parentEntryId, externalId: null, sourcePath: "docs/parent" },
        parentId: scope.managedFolderId, name: "Parent",
      });
      const child = await projection.projectFolder(caller, {
        sourceId: scope.managedSourceId,
        mapping: { sourceEntryId: childEntryId, externalId: null, sourcePath: "docs/parent/child" },
        parentId: parent.treeNodeId, name: "Child",
      });
      return { parentId: parent.treeNodeId, childId: child.treeNodeId };
    });
    await new MariaDbUnitOfWork(pool).run(async (repositories) => {
      const projection = bindSourceProjection(repositories, { id: scope.managedSourceId, workspaceId: scope.workspaceId });
      await projection.renameProjectedFolder(caller, { nodeId: childId, name: "Renamed Child" });
      const renamed = await repositories.tree.lockById(childId);
      expect(renamed?.name).toBe("Renamed Child");
      const renamedEntry = await repositories.entries.findById(childEntryId);
      expect(renamedEntry).toMatchObject({ status: "ACTIVE", updatedBy: owner.id });
      await expect(projection.archiveProjectedFolder(caller, parentId)).rejects.toBeInstanceOf(FolderNotEmptyError);
      expect((await repositories.tree.lockById(childId))?.status).toBe("ACTIVE");
      await projection.archiveProjectedFolder(caller, childId);
      expect((await repositories.tree.lockById(childId))?.status).toBe("ARCHIVED");
      expect((await repositories.entries.findById(childEntryId))?.status).toBe("ARCHIVED");
      await projection.archiveProjectedFolder(caller, parentId);
      const archivedParentEntry = await repositories.entries.findById(parentEntryId);
      expect(archivedParentEntry).toMatchObject({ status: "ARCHIVED", archivedBy: owner.id });
      const archivedChildSeenAt = (await repositories.entries.findById(childEntryId))?.lastSeenAt.getTime();
      await expect(projection.restoreProjectedFolder(caller, childId)).rejects.toBeInstanceOf(InvalidParentError);
      await projection.restoreProjectedFolder(caller, parentId);
      await projection.restoreProjectedFolder(caller, childId);
      const restoredChild = await repositories.tree.lockById(childId);
      expect(restoredChild?.status).toBe("ACTIVE");
      const restoredChildEntry = await repositories.entries.findById(childEntryId);
      expect(restoredChildEntry).toMatchObject({ status: "ACTIVE", archivedBy: null, archivedAt: null });
      expect(restoredChildEntry?.lastSeenAt.getTime()).toBe(archivedChildSeenAt);
    });
  });

  it("moves projected nodes with hierarchy-only changes and rejects unauthorized or cross-source moves", async () => {
    const scope = await setupMappingScope();
    const other = await setupMappingScope();
    const caller = callerFromIdentity(owner);
    const created = await new MariaDbUnitOfWork(pool).run(async (repositories) => {
      const projection = bindSourceProjection(repositories, { id: scope.managedSourceId, workspaceId: scope.workspaceId });
      const target = await projection.projectFolder(caller, {
        sourceId: scope.managedSourceId,
        mapping: { sourceEntryId: uuidv7(), externalId: null, sourcePath: "docs/move-target" },
        parentId: scope.managedFolderId, name: "Target",
      });
      const movable = await projection.projectFolder(caller, {
        sourceId: scope.managedSourceId,
        mapping: { sourceEntryId: uuidv7(), externalId: null, sourcePath: "docs/move-me" },
        parentId: scope.managedFolderId, name: "Movable",
      });
      const document = await projection.projectDocument(caller, {
        sourceId: scope.managedSourceId, parentId: movable.treeNodeId,
        title: "Movable Doc", markdown: "movable", metadata: {},
        mapping: { sourceEntryId: uuidv7(), externalId: `move-doc-${uuidv7()}`, sourcePath: "docs/move-me/note.md" },
      });
      return { targetId: target.treeNodeId, folderId: movable.treeNodeId, ...document };
    });
    await new MariaDbUnitOfWork(pool).run(async (repositories) => {
      const projection = bindSourceProjection(repositories, { id: scope.managedSourceId, workspaceId: scope.workspaceId });
      await projection.moveProjectedNode(caller, { nodeId: created.folderId, newParentId: created.targetId, newPosition: 0 });
      expect(await repositories.tree.lockById(created.folderId)).toMatchObject({
        parentId: created.targetId, position: 0, sourceId: scope.managedSourceId,
      });
      await projection.moveProjectedNode(caller, { nodeId: created.treeNodeId, newParentId: created.targetId, newPosition: 0 });
      expect(await repositories.tree.lockById(created.treeNodeId)).toMatchObject({
        parentId: created.targetId, position: 0, documentId: created.documentId,
      });
      expect(await repositories.documents.lockById(created.documentId)).toMatchObject({
        id: created.documentId, sourceId: scope.managedSourceId, currentRevisionId: created.revisionId, status: "ACTIVE",
      });
      expect(await repositories.revisions.findCurrent(created.documentId)).toMatchObject({
        id: created.revisionId, title: "Movable Doc",
      });
      expect(await repositories.entries.findByDocumentId(created.documentId)).toMatchObject({
        treeNodeId: created.treeNodeId, sourcePath: "docs/move-me/note.md", status: "ACTIVE",
      });
    });
    const settled = await new MariaDbUnitOfWork(pool).run(async (repositories) => ({
      folder: await repositories.tree.lockById(created.folderId),
      documentNode: await repositories.tree.lockById(created.treeNodeId),
    }));
    await new MariaDbUnitOfWork(pool).run(async (repositories) => {
      const projection = bindSourceProjection(repositories, { id: scope.managedSourceId, workspaceId: scope.workspaceId });
      await expect(projection.moveProjectedNode(callerFromIdentity(outsider), {
        nodeId: created.folderId, newParentId: scope.managedFolderId, newPosition: 0,
      })).rejects.toBeInstanceOf(WorkspaceAccessDeniedError);
      await expect(projection.moveProjectedNode(caller, {
        nodeId: created.folderId, newParentId: other.managedFolderId, newPosition: 0,
      })).rejects.toBeInstanceOf(CrossSourceMoveError);
    });
    const after = await new MariaDbUnitOfWork(pool).run(async (repositories) => ({
      folder: await repositories.tree.lockById(created.folderId),
      documentNode: await repositories.tree.lockById(created.treeNodeId),
    }));
    expect(after.folder).toMatchObject({ parentId: settled.folder?.parentId, position: settled.folder?.position });
    expect(after.documentNode).toMatchObject({ parentId: settled.documentNode?.parentId, position: settled.documentNode?.position });
  });

  it("archives and restores projected documents with entry provenance and stable revisions", async () => {
    const scope = await setupMappingScope();
    const caller = callerFromIdentity(owner);
    const entryId = uuidv7();
    const created = await new MariaDbUnitOfWork(pool).run(async (repositories) => {
      const projection = bindSourceProjection(repositories, { id: scope.managedSourceId, workspaceId: scope.workspaceId });
      return projection.projectDocument(caller, {
        sourceId: scope.managedSourceId, parentId: scope.managedFolderId,
        title: "Cycled", markdown: "v1", metadata: {},
        mapping: { sourceEntryId: entryId, externalId: `cycle-${uuidv7()}`, sourcePath: "docs/cycled.md" },
      });
    });
    await new MariaDbUnitOfWork(pool).run(async (repositories) => {
      const projection = bindSourceProjection(repositories, { id: scope.managedSourceId, workspaceId: scope.workspaceId });
      await projection.archiveProjectedDocument(caller, created.documentId);
      expect((await repositories.documents.lockById(created.documentId))?.status).toBe("ARCHIVED");
      expect((await repositories.entries.findById(entryId))?.status).toBe("ARCHIVED");
      const archivedEntry = await repositories.entries.findById(entryId);
      await projection.restoreProjectedDocument(caller, created.documentId);
      expect((await repositories.documents.lockById(created.documentId))?.status).toBe("ACTIVE");
      const restoredEntry = await repositories.entries.findById(entryId);
      expect(restoredEntry).toMatchObject({ status: "ACTIVE", archivedBy: null });
      expect(restoredEntry?.lastSeenAt.getTime()).toBe(archivedEntry?.lastSeenAt.getTime());
      const current = await repositories.revisions.findCurrent(created.documentId);
      expect(current?.id).toBe(created.revisionId);
    });
    expect(await countRows("knowledge_revisions", "document_id", created.documentId)).toBe(1);
  });

  it("rolls back multi-command projection writes on one connection and records FAILED separately", async () => {
    const scope = await setupMappingScope();
    const caller = callerFromIdentity(owner);
    const unitOfWork = new MariaDbUnitOfWork(pool);
    const before = {
      documents: await countRows("knowledge_documents", "source_id", scope.managedSourceId),
      tree: await countRows("knowledge_tree_nodes", "source_id", scope.managedSourceId),
      entries: await countRows("source_entries", "source_id", scope.managedSourceId),
      assets: await countRows("knowledge_assets", "source_id", scope.managedSourceId),
      version: Number((await pool.query<{ sync_version: number }[]>("SELECT sync_version FROM knowledge_sources WHERE id = ?", [scope.managedSourceId]))[0].sync_version),
    };
    const spy = vi.spyOn(pool, "getConnection");
    try {
      const failure = await unitOfWork.run(async (repositories) => {
        await repositories.users.upsertIdentity(owner);
        const source = await repositories.sources.lockById(scope.managedSourceId);
        await repositories.workspaceAccess.requireMembership(caller, source!.workspaceId);
        await repositories.sources.guardAndAdvanceVersion(scope.managedSourceId, before.version, owner.id);
        const projection = bindSourceProjection(repositories, { id: scope.managedSourceId, workspaceId: scope.workspaceId });
        await projection.projectDocument(caller, {
          sourceId: scope.managedSourceId, parentId: scope.managedFolderId,
          title: "Doomed Doc", markdown: "doomed", metadata: {},
          mapping: { sourceEntryId: uuidv7(), externalId: `doomed-${uuidv7()}`, sourcePath: "docs/doomed.md" },
        });
        await projection.projectFolder(caller, {
          sourceId: scope.managedSourceId,
          mapping: { sourceEntryId: uuidv7(), externalId: null, sourcePath: "docs/doomed-folder" },
          parentId: scope.managedFolderId, name: "Doomed Folder",
        });
        await repositories.assets.insert({
          id: uuidv7(), sourceId: scope.managedSourceId, sourcePath: "assets/doomed.png",
          mimeType: "image/png", contentHash: "d".repeat(64), metadata: {}, createdAt: new Date(),
        });
        throw new Error("Injected multi-command projection failure before APPLIED commit.");
      }).then(
        (): null => null,
        (caught: unknown) => caught,
      );
      expect(failure).toBeInstanceOf(Error);
      expect((failure as { cause?: { message?: string } }).cause?.message).toContain("Injected multi-command projection failure");
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
    expect(await countRows("knowledge_documents", "source_id", scope.managedSourceId)).toBe(before.documents);
    expect(await countRows("knowledge_tree_nodes", "source_id", scope.managedSourceId)).toBe(before.tree);
    expect(await countRows("source_entries", "source_id", scope.managedSourceId)).toBe(before.entries);
    expect(await countRows("knowledge_assets", "source_id", scope.managedSourceId)).toBe(before.assets);
    expect(Number((await pool.query<{ sync_version: number }[]>("SELECT sync_version FROM knowledge_sources WHERE id = ?", [scope.managedSourceId]))[0].sync_version)).toBe(before.version);
    const service = new SourceApplicationService(unitOfWork);
    const failedId = await service.recordFailedRun({ caller, sourceId: scope.managedSourceId, basedOnVersion: before.version, summary: { failure: true } });
    expect(await pool.query<{ status: string }[]>("SELECT status FROM sync_runs WHERE id = ?", [failedId])).toEqual([{ status: "FAILED" }]);
    expect(Number((await pool.query<{ sync_version: number }[]>("SELECT sync_version FROM knowledge_sources WHERE id = ?", [scope.managedSourceId]))[0].sync_version)).toBe(before.version);
  });

  it("routes known-entry apply and archive through projection authority with precise errors", async () => {
    const scope = await setupMappingScope();
    const caller = callerFromIdentity(owner);
    const hub = new HubKnowledgeCommandServiceImpl(new MariaDbUnitOfWork(pool));
    const hubDoc = await hub.createDocument(caller, {
      sourceId: scope.hubSourceId, parentId: scope.hubFolderId,
      title: "Hub Doc", markdown: "hub", metadata: {},
    });
    const hubNodes = await pool.query<{ id: unknown }[]>("SELECT id FROM knowledge_tree_nodes WHERE document_id = ?", [hubDoc.documentId]);
    const hubEntryId = uuidv7();
    await new MariaDbUnitOfWork(pool).run((repositories) => repositories.entries.insert({
      id: hubEntryId, sourceId: scope.hubSourceId, externalId: `hub-${uuidv7()}`, sourcePath: "docs/hub.md",
      entryType: "DOCUMENT", contentHash: "e".repeat(64), documentId: hubDoc.documentId,
      treeNodeId: String(hubNodes[0].id), status: "ACTIVE", updatedBy: owner.id,
      archivedBy: null, archivedAt: null, firstSeenAt: new Date(), lastSeenAt: new Date(),
    }));
    const service = new SourceApplicationService(new MariaDbUnitOfWork(pool));
    const hubApply = await service.applyKnownEntry(caller, {
      sourceId: scope.hubSourceId, basedOnVersion: 0, entryId: hubEntryId, documentId: hubDoc.documentId,
      externalId: null, sourcePath: "docs/hub.md", content: { title: "Hub Doc", markdown: "changed", metadata: {} },
    }).then(
      (): null => null,
      (caught: unknown) => caught,
    );
    expect(hubApply).toBeInstanceOf(VersionConflictError);
    expect((hubApply as VersionConflictError).code).toBe("VERSION_CONFLICT");
    const managed = await new MariaDbUnitOfWork(pool).run(async (repositories) => {
      const projection = bindSourceProjection(repositories, { id: scope.managedSourceId, workspaceId: scope.workspaceId });
      return projection.projectDocument(caller, {
        sourceId: scope.managedSourceId, parentId: scope.managedFolderId,
        title: "Managed", markdown: "v1", metadata: {},
        mapping: { sourceEntryId: uuidv7(), externalId: `apply-${uuidv7()}`, sourcePath: "docs/managed-apply.md" },
      });
    });
    const managedEntryId = (await pool.query<{ id: string }[]>("SELECT id FROM source_entries WHERE tree_node_id = ?", [managed.treeNodeId]))[0].id;
    const applied = await service.applyKnownEntry(caller, {
      sourceId: scope.managedSourceId, basedOnVersion: 0, entryId: managedEntryId, documentId: managed.documentId,
      externalId: null, sourcePath: "docs/managed-apply.md", content: { title: "Managed", markdown: "v2", metadata: {} },
    });
    expect(applied).toMatchObject({ resultVersion: 1, changed: true });
    const archived = await service.archiveKnownEntry(caller, {
      sourceId: scope.managedSourceId, basedOnVersion: 1, entryId: managedEntryId, documentId: managed.documentId,
      externalId: null, sourcePath: "docs/managed-apply.md",
    });
    expect(archived.resultVersion).toBe(2);
  });
});
