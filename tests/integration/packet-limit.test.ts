import { afterAll, beforeAll, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { guardPool, knownPacketLimit } from "@/infrastructure/database/mariadb/packet-limit";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { HubKnowledgeCommandServiceImpl } from "@/modules/knowledge/application/hub-knowledge-command-service";
import { disposeIsolatedDatabase, provisionIsolatedDatabase } from "../../scripts/db/test-database";
import { runMigrations, type IsolatedDatabaseHandle } from "../../scripts/db/migrate";
import { createSourceFixture, fixtureCaller } from "../fixtures/knowledge";

let handle: IsolatedDatabaseHandle;
let pool: Pool;
beforeAll(async () => {
  handle = await provisionIsolatedDatabase("test");
  const previous = process.env.KM_TEST_DB_NAME;
  process.env.KM_TEST_DB_NAME = handle.databaseName;
  try { pool = createDatabasePool(databaseConfig("test")); }
  finally {
    if (previous === undefined) delete process.env.KM_TEST_DB_NAME;
    else process.env.KM_TEST_DB_NAME = previous;
  }
  await runMigrations(pool);
});
afterAll(async () => { await pool?.end(); if (handle) await disposeIsolatedDatabase(handle); });

it("reads the server's max_allowed_packet, through a connection, when none is known", async () => {
  const store = globalThis as { __khPacketLimit?: number };
  delete store.__khPacketLimit;
  const connection = await pool.getConnection();
  try { await connection.query("SELECT 1"); } finally { connection.release(); }
  const [{ limit }] = await pool.query<{ limit: number }[]>("SELECT @@max_allowed_packet AS `limit`");
  expect(knownPacketLimit()).toBe(Number(limit));
});

// A server below the write closes the connection, which the driver reports as ECONNRESET: a
// 500 with no reason, retried by the import form. Refused before sending, it is a reason.
it("refuses a write over the limit with a reason, and the connection stays usable", async () => {
  const { source, folderId } = await createSourceFixture(pool);
  const previous = process.env.KM_TEST_DB_NAME;
  process.env.KM_TEST_DB_NAME = handle.databaseName;
  const small = guardPool(createDatabasePool(databaseConfig("test")), 1024 * 1024);
  if (previous === undefined) delete process.env.KM_TEST_DB_NAME; else process.env.KM_TEST_DB_NAME = previous;
  const hub = new HubKnowledgeCommandServiceImpl(new MariaDbUnitOfWork(small));
  await expect(hub.createDocument(fixtureCaller(), { sourceId: source.id, parentId: folderId, title: "Large", markdown: "line\n".repeat(400_000), metadata: {} }))
    .rejects.toMatchObject({ code: "CONTENT_TOO_LARGE", message: expect.stringContaining("1 MiB at once") });
  const created = await hub.createDocument(fixtureCaller(), { sourceId: source.id, parentId: folderId, title: "Small", markdown: "fits", metadata: {} });
  expect(created.documentId).toBeTruthy();
  await small.end();
});
