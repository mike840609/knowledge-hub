import { afterAll, beforeAll, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { uuidv7 } from "@/shared/ids/uuidv7";
import { createSourceFixture, fixtureIdentity } from "../fixtures/knowledge";

/** `updatePositions` writes many siblings per statement; a folder past one batch (500) must come out whole. */
let pool: Pool;
beforeAll(() => { pool = createDatabasePool(databaseConfig("test")); });
afterAll(async () => { await pool.end(); });

const SIBLINGS = 501;

async function folderWithSiblings() {
  const fixture = await createSourceFixture(pool, { managed: true });
  const ids = Array.from({ length: SIBLINGS }, () => uuidv7());
  await new MariaDbUnitOfWork(pool).run((repositories) => repositories.tree.insertMany(ids.map((id, position) => ({
    id, sourceId: fixture.source.id, parentId: fixture.folderId, nodeType: "FOLDER" as const, name: `Folder ${position}`,
    documentId: null, position, status: "ACTIVE" as const, updatedBy: fixtureIdentity.id, archivedBy: null, archivedAt: null,
  }))));
  return { fixture, ids };
}

async function positionsOf(ids: readonly string[]) {
  const rows = await pool.query<{ id: string; position: number }[]>(
    `SELECT id, position FROM knowledge_tree_nodes WHERE id IN (${ids.map(() => "?").join(",")})`, [...ids]);
  return new Map(rows.map((row) => [String(row.id), Number(row.position)]));
}

it("writes every position across more than one batch and leaves unnamed siblings alone", async () => {
  const { ids } = await folderWithSiblings();
  const [untouched, ...moved] = ids;
  await new MariaDbUnitOfWork(pool).run((repositories) =>
    repositories.tree.updatePositions(moved.map((nodeId, index) => ({ nodeId, position: SIBLINGS - index })), fixtureIdentity.id));
  const positions = await positionsOf(ids);
  expect(positions.get(untouched)).toBe(0);
  moved.forEach((id, index) => expect(positions.get(id)).toBe(SIBLINGS - index));
});

it("refuses a batch naming a node that does not exist, and the transaction keeps nothing", async () => {
  const { ids } = await folderWithSiblings();
  const updates = [...ids.map((nodeId, index) => ({ nodeId, position: index + 1000 })), { nodeId: uuidv7(), position: 0 }];
  await expect(new MariaDbUnitOfWork(pool).run((repositories) => repositories.tree.updatePositions(updates, fixtureIdentity.id)))
    .rejects.toThrow();
  const positions = await positionsOf(ids);
  ids.forEach((id, index) => expect(positions.get(id)).toBe(index));
});
