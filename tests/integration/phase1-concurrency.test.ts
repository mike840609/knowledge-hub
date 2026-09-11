import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { HubKnowledgeCommandServiceImpl } from "@/modules/knowledge/application/hub-knowledge-command-service";
import { callerFromIdentity } from "@/modules/identity/domain/caller-context";
import type { UserIdentity } from "@/modules/identity/domain/user-identity";
import { InvalidParentError, TreeCycleError } from "@/modules/knowledge/domain/errors";
import { uuidv7 } from "@/shared/ids/uuidv7";
import { disposeIsolatedDatabase, provisionIsolatedDatabase } from "../../scripts/db/test-database";
import { runMigrations, type IsolatedDatabaseHandle } from "../../scripts/db/migrate";

const first: UserIdentity = { id: "0199f300-0000-7000-8000-000000000001", emp_id: "CONC-ONE", name: "Conc One", org_code: "HRSD" };
const second: UserIdentity = { id: "0199f300-0000-7000-8000-000000000002", emp_id: "CONC-TWO", name: "Conc Two", org_code: "HRSD" };

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

async function setupConcurrencyFixture(pool: Pool): Promise<{ sourceId: string; folderA: string; folderB: string }> {
  const workspaceId = uuidv7();
  const sourceId = uuidv7();
  const folderA = uuidv7();
  const folderB = uuidv7();
  const now = new Date();
  await new MariaDbUnitOfWork(pool).run(async (repositories) => {
    await repositories.users.upsertIdentity(first);
    await repositories.users.upsertIdentity(second);
    await repositories.workspaces.insert({ id: workspaceId, name: "Concurrency Workspace", createdAt: now, updatedAt: now });
    await repositories.workspaceMemberships.insert({ workspaceId, userId: first.id, createdAt: now });
    await repositories.workspaceMemberships.insert({ workspaceId, userId: second.id, createdAt: now });
    await repositories.sources.insert({
      id: sourceId, name: "Concurrency Source", workspaceId, sourceType: "HUB", ownership: "HUB_MANAGED",
      status: "ACTIVE", syncVersion: 0, createdBy: first.id, updatedBy: first.id,
      archivedBy: null, archivedAt: null, createdAt: now, updatedAt: now,
    });
    for (const [folderId, name, position] of [[folderA, "Folder A", 0], [folderB, "Folder B", 1]] as const) {
      await repositories.tree.insert({
        id: folderId, sourceId, parentId: null, nodeType: "FOLDER", name,
        documentId: null, position, status: "ACTIVE", updatedBy: first.id, archivedBy: null, archivedAt: null,
      });
    }
  });
  return { sourceId, folderA, folderB };
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe("tree concurrency on two real connections", () => {
  it("allows at most one of two concurrent cycle moves and keeps the tree acyclic", async () => {
    const fixture = await setupConcurrencyFixture(poolA);
    const hubA = new HubKnowledgeCommandServiceImpl(new MariaDbUnitOfWork(poolA));
    const hubB = new HubKnowledgeCommandServiceImpl(new MariaDbUnitOfWork(poolB));
    const outcomes = await Promise.allSettled([
      hubA.moveTreeNode(callerFromIdentity(first), { nodeId: fixture.folderA, newParentId: fixture.folderB, newPosition: 0 }),
      hubB.moveTreeNode(callerFromIdentity(second), { nodeId: fixture.folderB, newParentId: fixture.folderA, newPosition: 0 }),
    ]);
    const fulfilled = outcomes.filter((outcome) => outcome.status === "fulfilled");
    const rejected = outcomes.filter((outcome) => outcome.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(TreeCycleError);
    const nodes = await new MariaDbUnitOfWork(poolA).run((repositories) => repositories.tree.listBySource(fixture.sourceId));
    const byId = new Map(nodes.map((node) => [node.id, node]));
    expect(byId.get(fixture.folderA)?.parentId === fixture.folderB || byId.get(fixture.folderB)?.parentId === fixture.folderA).toBe(true);
    expect(byId.get(fixture.folderA)?.parentId === fixture.folderB && byId.get(fixture.folderB)?.parentId === fixture.folderA).toBe(false);
  });

  it("validates the latest committed hierarchy after waiting on the Source lock", async () => {
    const fixture = await setupConcurrencyFixture(poolA);
    const holder = await poolB.getConnection();
    try {
      await holder.query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED");
      await holder.beginTransaction();
      await holder.query("SELECT * FROM knowledge_sources WHERE id = ? FOR UPDATE", [fixture.sourceId]);
      const hub = new HubKnowledgeCommandServiceImpl(new MariaDbUnitOfWork(poolA));
      const move = hub.moveTreeNode(callerFromIdentity(first), { nodeId: fixture.folderA, newParentId: fixture.folderB, newPosition: 0 });
      const challenged = expect(move).rejects.toBeInstanceOf(InvalidParentError);
      await sleep(300);
      await holder.query("UPDATE knowledge_tree_nodes SET status = 'ARCHIVED', archived_by = ?, archived_at = CURRENT_TIMESTAMP(6) WHERE id = ?", [first.id, fixture.folderB]);
      await holder.commit();
      await challenged;
      const rows = await poolA.query<{ parent_id: unknown }[]>("SELECT parent_id FROM knowledge_tree_nodes WHERE id = ?", [fixture.folderA]);
      expect(rows[0]?.parent_id ?? null).toBeNull();
    } finally {
      try { await holder.rollback(); } catch { /* already committed */ }
      holder.release();
    }
  });
});
