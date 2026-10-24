import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { disposeIsolatedDatabase, provisionIsolatedDatabase } from "../../scripts/db/test-database";
import { runMigrations, type IsolatedDatabaseHandle } from "../../scripts/db/migrate";

// The read-path indexes are order-sensitive: the sync-run lookup relies on
// (source_id, status, completed_at) and the tree lookup on
// (source_id, parent_id, position). `information_schema.statistics` is the only
// place the declared column order is visible once the migration has run.
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

describe("query-path indexes", () => {
  it("declares the read-path indexes in the expected column order", async () => {
    const sync = await pool.query<{ column_name: string }[]>(
      `SELECT column_name FROM information_schema.statistics
       WHERE table_schema = ? AND table_name = 'sync_runs'
         AND index_name = 'idx_sync_runs_source_status_completed'
       ORDER BY seq_in_index`,
      [handle.databaseName],
    );
    expect(sync.map((row) => row.column_name))
      .toEqual(["source_id", "status", "completed_at"]);

    const tree = await pool.query<{ column_name: string }[]>(
      `SELECT column_name FROM information_schema.statistics
       WHERE table_schema = ? AND table_name = 'knowledge_tree_nodes'
         AND index_name = 'idx_tree_source_parent_position_order'
       ORDER BY seq_in_index`,
      [handle.databaseName],
    );
    expect(tree.map((row) => row.column_name))
      .toEqual(["source_id", "parent_id", "position"]);

    expect(await pool.query(
      "SELECT state FROM schema_migrations WHERE version = 25",
    )).toEqual([{ state: "APPLIED" }]);
  });
});
