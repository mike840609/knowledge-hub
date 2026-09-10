import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { HubKnowledgeCommandServiceImpl } from "@/modules/knowledge/application/hub-knowledge-command-service";
import { callerFromIdentity } from "@/modules/identity/domain/caller-context";
import type { UserIdentity } from "@/modules/identity/domain/user-identity";
import {
  CrossSourceMoveError,
  InvalidParentError,
  SourceArchivedError,
  SourceReadOnlyError,
  TreeCycleError,
  TreeNodeNotFoundError,
  ValidationError,
} from "@/modules/knowledge/domain/errors";
import { WorkspaceAccessDeniedError } from "@/modules/workspaces/domain/errors";
import { uuidv7 } from "@/shared/ids/uuidv7";
import { disposeIsolatedDatabase, provisionIsolatedDatabase } from "../../scripts/db/test-database";
import { runMigrations, type IsolatedDatabaseHandle } from "../../scripts/db/migrate";

const owner: UserIdentity = { id: "0199f200-0000-7000-8000-000000000001", emp_id: "TREE-OWNER", name: "Tree Owner", org_code: "HRSD" };
const outsider: UserIdentity = { id: "0199f200-0000-7000-8000-000000000002", emp_id: "TREE-OUT", name: "Tree Outsider", org_code: "HRSD" };

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

type TreeFixture = {
  workspaceId: string;
  sourceId: string;
  rootFolderId: string;
  managedSourceId: string;
  managedFolderId: string;
  archivedSourceId: string;
  archivedFolderId: string;
  otherSourceId: string;
  otherFolderId: string;
};

async function setupTreeFixture(): Promise<TreeFixture> {
  const workspaceId = uuidv7();
  const sourceId = uuidv7();
  const rootFolderId = uuidv7();
  const managedSourceId = uuidv7();
  const managedFolderId = uuidv7();
  const archivedSourceId = uuidv7();
  const archivedFolderId = uuidv7();
  const otherSourceId = uuidv7();
  const otherFolderId = uuidv7();
  const now = new Date();
  await new MariaDbUnitOfWork(pool).run(async (repositories) => {
    await repositories.users.upsertIdentity(owner);
    await repositories.users.upsertIdentity(outsider);
    await repositories.workspaces.insert({ id: workspaceId, name: "Tree Workspace", createdAt: now, updatedAt: now });
    await repositories.workspaceMemberships.insert({ workspaceId, userId: owner.id, createdAt: now });
    await repositories.sources.insert({
      id: sourceId, name: "Tree Source", workspaceId, sourceType: "HUB", ownership: "HUB_MANAGED",
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
    await repositories.sources.insert({
      id: otherSourceId, name: "Other Source", workspaceId, sourceType: "HUB", ownership: "HUB_MANAGED",
      status: "ACTIVE", syncVersion: 0, createdBy: owner.id, updatedBy: owner.id,
      archivedBy: null, archivedAt: null, createdAt: now, updatedAt: now,
    });
    for (const [folderId, folderSourceId, name] of [
      [rootFolderId, sourceId, "Root"],
      [managedFolderId, managedSourceId, "Managed"],
      [archivedFolderId, archivedSourceId, "Archived"],
      [otherFolderId, otherSourceId, "Other"],
    ] as const) {
      await repositories.tree.insert({
        id: folderId, sourceId: folderSourceId, parentId: null, nodeType: "FOLDER", name,
        documentId: null, position: 0, status: "ACTIVE", updatedBy: owner.id, archivedBy: null, archivedAt: null,
      });
    }
  });
  return { workspaceId, sourceId, rootFolderId, managedSourceId, managedFolderId, archivedSourceId, archivedFolderId, otherSourceId, otherFolderId };
}

function hub() {
  return new HubKnowledgeCommandServiceImpl(new MariaDbUnitOfWork(pool));
}

async function treeRow(nodeId: string) {
  const rows = await pool.query<Record<string, unknown>[]>("SELECT * FROM knowledge_tree_nodes WHERE id = ?", [nodeId]);
  return rows[0]!;
}

async function documentRow(documentId: string) {
  const rows = await pool.query<Record<string, unknown>[]>("SELECT * FROM knowledge_documents WHERE id = ?", [documentId]);
  return rows[0]!;
}

async function revisionCount(documentId: string) {
  const rows = await pool.query<{ count: number }[]>("SELECT COUNT(*) AS count FROM knowledge_revisions WHERE document_id = ?", [documentId]);
  return Number(rows[0]?.count ?? 0);
}

describe("hub tree creation", () => {
  it("creates root and nested folders", async () => {
    const fixture = await setupTreeFixture();
    const service = hub();
    const root = await service.createFolder(callerFromIdentity(owner), { sourceId: fixture.sourceId, parentId: null, name: "  Planning  " });
    expect(root.treeNodeId).toBeTruthy();
    expect(await treeRow(root.treeNodeId)).toMatchObject({ node_type: "FOLDER", name: "Planning", parent_id: null, status: "ACTIVE" });
    const nested = await service.createFolder(callerFromIdentity(owner), { sourceId: fixture.sourceId, parentId: root.treeNodeId, name: "Quarterly" });
    expect(await treeRow(nested.treeNodeId)).toMatchObject({ parent_id: root.treeNodeId });
  });

  it("rejects invalid folder creation without writes", async () => {
    const fixture = await setupTreeFixture();
    const service = hub();
    const created = await service.createDocument(callerFromIdentity(owner), {
      sourceId: fixture.sourceId, parentId: fixture.rootFolderId, title: "Doc", markdown: "body", metadata: {},
    });
    const documentNodes = await new MariaDbUnitOfWork(pool).run((repositories) => repositories.tree.listBySource(fixture.sourceId));
    const documentNodeId = documentNodes.find((node) => node.documentId === created.documentId)!.id;
    await expect(service.createFolder(callerFromIdentity(owner), { sourceId: fixture.sourceId, parentId: null, name: "   " })).rejects.toBeInstanceOf(ValidationError);
    await expect(service.createFolder(callerFromIdentity(owner), { sourceId: fixture.sourceId, parentId: uuidv7(), name: "No" })).rejects.toBeInstanceOf(TreeNodeNotFoundError);
    await expect(service.createFolder(callerFromIdentity(owner), { sourceId: fixture.sourceId, parentId: fixture.otherFolderId, name: "No" })).rejects.toBeInstanceOf(InvalidParentError);
    await expect(service.createFolder(callerFromIdentity(owner), { sourceId: fixture.sourceId, parentId: documentNodeId, name: "No" })).rejects.toBeInstanceOf(InvalidParentError);
    await expect(service.createFolder(callerFromIdentity(owner), { sourceId: fixture.managedSourceId, parentId: null, name: "No" })).rejects.toBeInstanceOf(SourceReadOnlyError);
    await expect(service.createFolder(callerFromIdentity(owner), { sourceId: fixture.archivedSourceId, parentId: null, name: "No" })).rejects.toBeInstanceOf(SourceArchivedError);
    await expect(service.createFolder(callerFromIdentity(outsider), { sourceId: fixture.sourceId, parentId: null, name: "No" })).rejects.toBeInstanceOf(WorkspaceAccessDeniedError);
  });

  it("keeps sibling positions contiguous across mixed document and folder creation", async () => {
    const fixture = await setupTreeFixture();
    const service = hub();
    const caller = callerFromIdentity(owner);
    const folderA = await service.createFolder(caller, { sourceId: fixture.sourceId, parentId: fixture.rootFolderId, name: "A" });
    const docOne = await service.createDocument(caller, {
      sourceId: fixture.sourceId, parentId: fixture.rootFolderId, title: "One", markdown: "body", metadata: {},
    });
    const folderB = await service.createFolder(caller, { sourceId: fixture.sourceId, parentId: fixture.rootFolderId, name: "B" });
    const docZero = await service.createDocument(caller, {
      sourceId: fixture.sourceId, parentId: fixture.rootFolderId, title: "Zero", markdown: "body", metadata: {}, position: 0,
    });
    const siblings = await new MariaDbUnitOfWork(pool).run(async (repositories) =>
      (await repositories.tree.listBySource(fixture.sourceId))
        .filter((node) => node.parentId === fixture.rootFolderId)
        .sort((left, right) => left.position - right.position),
    );
    expect(siblings.map((node) => node.position)).toEqual([0, 1, 2, 3]);
    expect(siblings.map((node) => node.id)).toEqual([docZero.treeNodeId, folderA.treeNodeId, docOne.treeNodeId, folderB.treeNodeId]);
  });
});

describe("hub folder rename", () => {
  it("renames an active folder", async () => {
    const fixture = await setupTreeFixture();
    const service = hub();
    await service.renameFolder(callerFromIdentity(owner), { nodeId: fixture.rootFolderId, name: "Renamed Root" });
    expect(await treeRow(fixture.rootFolderId)).toMatchObject({ name: "Renamed Root", status: "ACTIVE" });
  });

  it("rejects invalid folder renames", async () => {
    const fixture = await setupTreeFixture();
    const service = hub();
    const created = await service.createDocument(callerFromIdentity(owner), {
      sourceId: fixture.sourceId, parentId: fixture.rootFolderId, title: "Doc", markdown: "body", metadata: {},
    });
    const documentNodes = await new MariaDbUnitOfWork(pool).run((repositories) => repositories.tree.listBySource(fixture.sourceId));
    const documentNodeId = documentNodes.find((node) => node.documentId === created.documentId)!.id;
    await expect(service.renameFolder(callerFromIdentity(owner), { nodeId: fixture.rootFolderId, name: "" })).rejects.toBeInstanceOf(ValidationError);
    await expect(service.renameFolder(callerFromIdentity(owner), { nodeId: uuidv7(), name: "No" })).rejects.toBeInstanceOf(TreeNodeNotFoundError);
    await expect(service.renameFolder(callerFromIdentity(owner), { nodeId: documentNodeId, name: "No" })).rejects.toBeInstanceOf(ValidationError);
    await expect(service.renameFolder(callerFromIdentity(owner), { nodeId: fixture.managedFolderId, name: "No" })).rejects.toBeInstanceOf(SourceReadOnlyError);
    await expect(service.renameFolder(callerFromIdentity(outsider), { nodeId: fixture.rootFolderId, name: "No" })).rejects.toBeInstanceOf(WorkspaceAccessDeniedError);
    await pool.query("UPDATE knowledge_tree_nodes SET status = 'ARCHIVED', archived_by = ?, archived_at = CURRENT_TIMESTAMP(6) WHERE id = ?", [owner.id, fixture.rootFolderId]);
    await expect(service.renameFolder(callerFromIdentity(owner), { nodeId: fixture.rootFolderId, name: "No" })).rejects.toBeInstanceOf(ValidationError);
    expect(await treeRow(fixture.rootFolderId)).toMatchObject({ name: "Root" });
  });
});

describe("hub tree move", () => {
  it("moves a document by changing hierarchy only", async () => {
    const fixture = await setupTreeFixture();
    const service = hub();
    const target = await service.createFolder(callerFromIdentity(owner), { sourceId: fixture.sourceId, parentId: null, name: "Target" });
    const created = await service.createDocument(callerFromIdentity(owner), {
      sourceId: fixture.sourceId, parentId: fixture.rootFolderId, title: "Movable", markdown: "body", metadata: {},
    });
    const nodes = await new MariaDbUnitOfWork(pool).run((repositories) => repositories.tree.listBySource(fixture.sourceId));
    const nodeId = nodes.find((node) => node.documentId === created.documentId)!.id;
    const documentBefore = await documentRow(created.documentId);
    const revisionsBefore = await revisionCount(created.documentId);
    const sourceBefore = (await pool.query<Record<string, unknown>[]>("SELECT workspace_id FROM knowledge_sources WHERE id = ?", [fixture.sourceId]))[0]!;

    await service.moveTreeNode(callerFromIdentity(owner), { nodeId, newParentId: target.treeNodeId, newPosition: 0 });

    const moved = await treeRow(nodeId);
    expect(moved).toMatchObject({ id: nodeId, parent_id: target.treeNodeId, position: 0 });
    expect(await documentRow(created.documentId)).toEqual(documentBefore);
    expect(await revisionCount(created.documentId)).toBe(revisionsBefore);
    const sourceAfter = (await pool.query<Record<string, unknown>[]>("SELECT workspace_id FROM knowledge_sources WHERE id = ?", [fixture.sourceId]))[0]!;
    expect(sourceAfter).toEqual(sourceBefore);
  });

  it("moves a folder with its subtree and supports root moves", async () => {
    const fixture = await setupTreeFixture();
    const service = hub();
    const caller = callerFromIdentity(owner);
    const parent = await service.createFolder(caller, { sourceId: fixture.sourceId, parentId: null, name: "Parent" });
    const child = await service.createFolder(caller, { sourceId: fixture.sourceId, parentId: parent.treeNodeId, name: "Child" });
    await service.moveTreeNode(caller, { nodeId: child.treeNodeId, newParentId: fixture.rootFolderId, newPosition: 0 });
    expect(await treeRow(child.treeNodeId)).toMatchObject({ parent_id: fixture.rootFolderId });
    await service.moveTreeNode(caller, { nodeId: child.treeNodeId, newParentId: null, newPosition: 0 });
    expect(await treeRow(child.treeNodeId)).toMatchObject({ parent_id: null });
  });

  it("rejects cyclic, cross-source, and invalid moves", async () => {
    const fixture = await setupTreeFixture();
    const service = hub();
    const caller = callerFromIdentity(owner);
    const parent = await service.createFolder(caller, { sourceId: fixture.sourceId, parentId: null, name: "Parent" });
    const child = await service.createFolder(caller, { sourceId: fixture.sourceId, parentId: parent.treeNodeId, name: "Child" });
    await expect(service.moveTreeNode(caller, { nodeId: parent.treeNodeId, newParentId: parent.treeNodeId, newPosition: 0 })).rejects.toMatchObject({ name: "TreeCycleError", code: "TREE_CYCLE" });
    await expect(service.moveTreeNode(caller, { nodeId: parent.treeNodeId, newParentId: child.treeNodeId, newPosition: 0 })).rejects.toBeInstanceOf(TreeCycleError);
    await expect(service.moveTreeNode(caller, { nodeId: parent.treeNodeId, newParentId: fixture.otherFolderId, newPosition: 0 })).rejects.toBeInstanceOf(CrossSourceMoveError);
    await expect(service.moveTreeNode(caller, { nodeId: parent.treeNodeId, newParentId: uuidv7(), newPosition: 0 })).rejects.toBeInstanceOf(TreeNodeNotFoundError);
    await expect(service.moveTreeNode(caller, { nodeId: uuidv7(), newParentId: null, newPosition: 0 })).rejects.toBeInstanceOf(TreeNodeNotFoundError);
    await expect(service.moveTreeNode(caller, { nodeId: fixture.managedFolderId, newParentId: null, newPosition: 0 })).rejects.toBeInstanceOf(SourceReadOnlyError);
    await expect(service.moveTreeNode(callerFromIdentity(outsider), { nodeId: parent.treeNodeId, newParentId: null, newPosition: 0 })).rejects.toBeInstanceOf(WorkspaceAccessDeniedError);
    expect(await treeRow(parent.treeNodeId)).toMatchObject({ parent_id: null });
  });

  it("rejects moves below an archived parent without changing hierarchy", async () => {
    const fixture = await setupTreeFixture();
    const service = hub();
    const caller = callerFromIdentity(owner);
    const parent = await service.createFolder(caller, { sourceId: fixture.sourceId, parentId: null, name: "Parent" });
    const child = await service.createFolder(caller, { sourceId: fixture.sourceId, parentId: null, name: "Child" });
    await pool.query("UPDATE knowledge_tree_nodes SET status = 'ARCHIVED', archived_by = ?, archived_at = CURRENT_TIMESTAMP(6) WHERE id = ?", [owner.id, parent.treeNodeId]);
    await expect(service.moveTreeNode(caller, { nodeId: child.treeNodeId, newParentId: parent.treeNodeId, newPosition: 0 })).rejects.toBeInstanceOf(InvalidParentError);
    expect(await treeRow(child.treeNodeId)).toMatchObject({ parent_id: null });
  });
});

describe("hub tree reorder", () => {
  it("reorders siblings contiguously by position then id", async () => {
    const fixture = await setupTreeFixture();
    const service = hub();
    const caller = callerFromIdentity(owner);
    const first = await service.createFolder(caller, { sourceId: fixture.sourceId, parentId: fixture.rootFolderId, name: "First" });
    const second = await service.createFolder(caller, { sourceId: fixture.sourceId, parentId: fixture.rootFolderId, name: "Second" });
    const third = await service.createFolder(caller, { sourceId: fixture.sourceId, parentId: fixture.rootFolderId, name: "Third" });
    const created = await service.createDocument(caller, {
      sourceId: fixture.sourceId, parentId: fixture.rootFolderId, title: "Doc", markdown: "body", metadata: {},
    });
    const revisionsBefore = await revisionCount(created.documentId);

    await service.reorderTreeNode(caller, { nodeId: third.treeNodeId, newPosition: 0 });

    const ordered = await new MariaDbUnitOfWork(pool).run(async (repositories) =>
      (await repositories.tree.listBySource(fixture.sourceId))
        .filter((node) => node.parentId === fixture.rootFolderId)
        .sort((left, right) => left.position - right.position || (left.id < right.id ? -1 : 1)),
    );
    expect(ordered.map((node) => node.position)).toEqual([0, 1, 2, 3]);
    expect(ordered[0]!.id).toBe(third.treeNodeId);
    expect(ordered.map((node) => node.id)).toContain(first.treeNodeId);
    expect(ordered.map((node) => node.id)).toContain(second.treeNodeId);
    expect(await revisionCount(created.documentId)).toBe(revisionsBefore);
  });

  it("clamps out-of-range reorder positions to the end without gaps", async () => {
    const fixture = await setupTreeFixture();
    const service = hub();
    const caller = callerFromIdentity(owner);
    const first = await service.createFolder(caller, { sourceId: fixture.sourceId, parentId: null, name: "First" });
    await service.reorderTreeNode(caller, { nodeId: first.treeNodeId, newPosition: 99 });
    const siblings = await new MariaDbUnitOfWork(pool).run(async (repositories) =>
      (await repositories.tree.listBySource(fixture.sourceId)).filter((node) => node.parentId === null),
    );
    const positions = siblings.map((node) => node.position).sort((a, b) => a - b);
    expect(positions).toEqual(siblings.map((_, index) => index));
    expect(await treeRow(first.treeNodeId)).toMatchObject({ position: positions.length - 1 });
  });

  it("rejects invalid reorders", async () => {
    const fixture = await setupTreeFixture();
    const service = hub();
    await expect(service.reorderTreeNode(callerFromIdentity(owner), { nodeId: fixture.rootFolderId, newPosition: -1 })).rejects.toBeInstanceOf(ValidationError);
    await expect(service.reorderTreeNode(callerFromIdentity(owner), { nodeId: uuidv7(), newPosition: 0 })).rejects.toBeInstanceOf(TreeNodeNotFoundError);
    await expect(service.reorderTreeNode(callerFromIdentity(owner), { nodeId: fixture.managedFolderId, newPosition: 0 })).rejects.toBeInstanceOf(SourceReadOnlyError);
    await expect(service.reorderTreeNode(callerFromIdentity(outsider), { nodeId: fixture.rootFolderId, newPosition: 0 })).rejects.toBeInstanceOf(WorkspaceAccessDeniedError);
  });
});
