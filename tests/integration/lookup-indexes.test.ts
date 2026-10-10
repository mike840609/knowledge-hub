import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { uuidv7 } from "@/shared/ids/uuidv7";
import { disposeIsolatedDatabase, provisionIsolatedDatabase } from "../../scripts/db/test-database";
import { runMigrations, type IsolatedDatabaseHandle } from "../../scripts/db/migrate";

// Lookups that run on every request, or against a table that grows with every
// document, must have an index to use. `possible_keys` says whether one exists
// for a non-unique lookup even on an empty table; the plan chosen there does not.
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

async function usableIndexes(sql: string, params: unknown[]): Promise<string[]> {
  const rows = await pool.query<{ possible_keys: string | null }[]>(`EXPLAIN ${sql}`, params);
  return (rows[0].possible_keys ?? "").split(",").filter(Boolean);
}

describe("lookup indexes", () => {
  it("finds the workspaces a caller's SSO groups map to by index", async () => {
    expect(await usableIndexes(
      "SELECT * FROM workspace_group_mappings WHERE external_group_id IN (?, ?) ORDER BY created_at, id",
      ["group-a", "group-b"],
    )).toContain("idx_group_mappings_external_group");
  });

  it("finds the source entry of a tree node by index", async () => {
    expect(await usableIndexes("SELECT * FROM source_entries WHERE tree_node_id = ?", [uuidv7()])).toContain("idx_entries_tree_node");
  });

  it("still finds a source entry by document by index", async () => {
    expect(await usableIndexes("SELECT * FROM source_entries WHERE document_id = ?", [uuidv7()])).toContain("fk_entries_tree_document");
  });
});
