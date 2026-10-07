import { afterAll, beforeAll, describe, expect, it } from "vitest";
import mariadb, { type Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { HubKnowledgeCommandServiceImpl } from "@/modules/knowledge/application/hub-knowledge-command-service";
import { WorkspaceBusyError } from "@/shared/domain/errors";
import { createSourceFixture, fixtureCaller } from "../fixtures/knowledge";

/**
 * A large folder import holds its workspace for the whole Apply (about a minute at
 * 6,000 notes), longer than MariaDB's 50-second lock wait. A note saved meanwhile
 * used to fail as an import error, then as a 500. It must fail as WORKSPACE_BUSY,
 * having written nothing, and succeed once the workspace is free. The waiting
 * connection's lock wait is cut to 1 second so the case runs in a test.
 */
let pool: Pool;
let waiterPool: Pool;

beforeAll(() => {
  const config = databaseConfig("test");
  pool = createDatabasePool(config);
  waiterPool = mariadb.createPool({
    host: config.host, port: config.port, user: config.user, password: config.password, database: config.database,
    connectionLimit: 2, timezone: "Z", bigIntAsNumber: true,
    initSql: "SET SESSION innodb_lock_wait_timeout = 1",
  });
});
afterAll(async () => {
  await waiterPool.end();
  await pool.end();
});

describe("a write that waits on a busy workspace", () => {
  it("fails as WORKSPACE_BUSY without writing, and succeeds once the workspace is free", async () => {
    const fixture = await createSourceFixture(pool);
    const hub = new HubKnowledgeCommandServiceImpl(new MariaDbUnitOfWork(waiterPool));
    const save = () => hub.createDocument(fixtureCaller(), { sourceId: fixture.source.id, parentId: null, title: "Saved while busy", markdown: "body", metadata: {} });
    const countSaved = async () => Number((await pool.query<{ n: number }[]>(
      "SELECT COUNT(*) AS n FROM knowledge_revisions r JOIN knowledge_documents d ON d.current_revision_id = r.id WHERE d.source_id = ? AND r.title = 'Saved while busy'",
      [fixture.source.id],
    ))[0].n);

    // Another writer, as Apply does, holds the workspace row.
    const holder = await pool.getConnection();
    try {
      await holder.beginTransaction();
      await holder.query("SELECT id FROM workspaces WHERE id = ? FOR UPDATE", [fixture.workspaceId]);

      await expect(save()).rejects.toBeInstanceOf(WorkspaceBusyError);
      expect(await countSaved()).toBe(0);
    } finally {
      await holder.rollback();
      holder.release();
    }

    await expect(save()).resolves.toMatchObject({ documentId: expect.any(String) });
    expect(await countSaved()).toBe(1);
  });
});
