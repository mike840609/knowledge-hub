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
  // Guard both handles so a beforeAll failure surfaces its original error
  // instead of a cleanup error.
  if (pool) await pool.end();
  if (handle) await disposeIsolatedDatabase(handle);
});

describe("query-path indexes", () => {
  it("declares the read-path indexes in the expected column order", async () => {
    const sync = await pool.query<{ column_name: string; non_unique: number }[]>(
      `SELECT column_name, non_unique FROM information_schema.statistics
       WHERE table_schema = ? AND table_name = 'sync_runs'
         AND index_name = 'idx_sync_runs_source_status_completed'
       ORDER BY seq_in_index`,
      [handle.databaseName],
    );
    expect(sync.map((row) => row.column_name))
      .toEqual(["source_id", "status", "completed_at"]);
    expect(sync.map((row) => Number(row.non_unique))).toEqual([1, 1, 1]);

    const tree = await pool.query<{ column_name: string; non_unique: number }[]>(
      `SELECT column_name, non_unique FROM information_schema.statistics
       WHERE table_schema = ? AND table_name = 'knowledge_tree_nodes'
         AND index_name = 'idx_tree_source_parent_position_order'
       ORDER BY seq_in_index`,
      [handle.databaseName],
    );
    expect(tree.map((row) => row.column_name))
      .toEqual(["source_id", "parent_id", "position"]);
    expect(tree.map((row) => Number(row.non_unique))).toEqual([1, 1, 1]);
  });

  it("records migration 25 as the named query-path migration", async () => {
    expect(await pool.query(
      "SELECT name, state FROM schema_migrations WHERE version = 25",
    )).toEqual([{ name: "query-path-indexes", state: "APPLIED" }]);
  });

  it("keeps the pre-existing sync-run and tree indexes", async () => {
    const surviving = await pool.query<{ index_name: string }[]>(
      `SELECT DISTINCT index_name FROM information_schema.statistics
       WHERE table_schema = ?
         AND ((table_name = 'sync_runs'
               AND index_name IN ('idx_sync_runs_source_started', 'sync_runs_applied_cursor'))
           OR (table_name = 'knowledge_tree_nodes'
               AND index_name = 'idx_tree_source_parent_position'))`,
      [handle.databaseName],
    );
    expect(surviving.map((row) => row.index_name).sort()).toEqual([
      "idx_sync_runs_source_started",
      "idx_tree_source_parent_position",
      "sync_runs_applied_cursor",
    ]);
  });
});
