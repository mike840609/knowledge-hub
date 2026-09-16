import { describe, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { assertAssetProjectionReady } from "@/infrastructure/database/mariadb/asset-projection-validation";
import { migrations } from "@/infrastructure/database/mariadb/migrations";
import type { MigrationReadConnection } from "@/infrastructure/database/mariadb/migrations/types";
import { runMigrations, type IsolatedDatabaseHandle } from "../../scripts/db/migrate";
import { disposeIsolatedDatabase, provisionIsolatedDatabase } from "../../scripts/db/test-database";
import { uuidv7 } from "@/shared/ids/uuidv7";

function asReadConnection(pool: Pool): MigrationReadConnection {
  return {
    query: <T>(sql: string, params?: unknown[]): Promise<T> => pool.query(sql, params) as unknown as Promise<T>,
  };
}

async function createIsolatedPool(): Promise<{ handle: IsolatedDatabaseHandle; pool: Pool }> {
  const handle = await provisionIsolatedDatabase("test");
  const previous = process.env.KM_TEST_DB_NAME;
  process.env.KM_TEST_DB_NAME = handle.databaseName;
  try {
    return { handle, pool: createDatabasePool(databaseConfig("test")) };
  } finally {
    if (previous === undefined) delete process.env.KM_TEST_DB_NAME;
    else process.env.KM_TEST_DB_NAME = previous;
  }
}

async function disposePool(handle: IsolatedDatabaseHandle, pool: Pool): Promise<void> {
  await pool.end();
  await disposeIsolatedDatabase(handle);
}

async function seedScope(pool: Pool): Promise<{ sourceId: string }> {
  const userId = uuidv7();
  const workspaceId = uuidv7();
  const sourceId = uuidv7();
  await pool.query("INSERT INTO users (id, emp_id, name, org_code) VALUES (?, ?, 'Phase 2 Gate User', 'P2')", [userId, `p2-gate-${userId}`]);
  await pool.query("INSERT INTO workspaces (id, name) VALUES (?, 'Phase 2 Gate Workspace')", [workspaceId]);
  await pool.query("INSERT INTO workspace_memberships (workspace_id, user_id) VALUES (?, ?)", [workspaceId, userId]);
  await pool.query(
    "INSERT INTO knowledge_sources (id, name, workspace_id, source_type, ownership, status, sync_version, created_by, updated_by) VALUES (?, 'Phase 2 Gate Source', ?, 'FOLDER_SYNC', 'SOURCE_MANAGED', 'ACTIVE', 0, ?, ?)",
    [sourceId, workspaceId, userId, userId],
  );
  return { sourceId };
}

async function insertAsset(pool: Pool, sourceId: string, sourcePath: string): Promise<string> {
  const id = uuidv7();
  await pool.query("INSERT INTO knowledge_assets (id, source_id, source_path, metadata) VALUES (?, ?, ?, ?)", [
    id,
    sourceId,
    sourcePath,
    "{}",
  ]);
  return id;
}

describe("007 asset projection readiness gate", () => {
  it("rejects a non-canonical source_path and names the offending asset id", async () => {
    const { handle, pool } = await createIsolatedPool();
    try {
      await runMigrations(pool, migrations, { to: 6 });
      const { sourceId } = await seedScope(pool);
      const canonicalId = await insertAsset(pool, sourceId, "images/diagram.png");
      const badId = await insertAsset(pool, sourceId, "images//needs-canonical.png");
      await expect(assertAssetProjectionReady(asReadConnection(pool))).rejects.toThrow(new RegExp(`asset ${badId}`));
      expect(canonicalId).not.toBe(badId);
    } finally {
      await disposePool(handle, pool);
    }
  });

  it("rejects an invalid stored path and keeps the asset id plus the original error code", async () => {
    const { handle, pool } = await createIsolatedPool();
    try {
      await runMigrations(pool, migrations, { to: 6 });
      const { sourceId } = await seedScope(pool);
      const badId = await insertAsset(pool, sourceId, "/absolute/not-allowed.png");
      await expect(assertAssetProjectionReady(asReadConnection(pool))).rejects.toThrow(new RegExp(`asset ${badId}`));
      await expect(assertAssetProjectionReady(asReadConnection(pool))).rejects.toThrow(/INVALID_SOURCE_PATH/);
    } finally {
      await disposePool(handle, pool);
    }
  });

  it("rejects duplicate normalized paths within a source and names the offending asset id", async () => {
    const { handle, pool } = await createIsolatedPool();
    try {
      await runMigrations(pool, migrations, { to: 6 });
      const { sourceId } = await seedScope(pool);
      await insertAsset(pool, sourceId, "images/logo.png");
      const duplicateId = await insertAsset(pool, sourceId, "images/logo.png");
      await expect(assertAssetProjectionReady(asReadConnection(pool))).rejects.toThrow(new RegExp(`asset ${duplicateId}`));
    } finally {
      await disposePool(handle, pool);
    }
  });

  it("passes when every row is canonical and lets migration 007 apply", async () => {
    const { handle, pool } = await createIsolatedPool();
    try {
      await runMigrations(pool, migrations, { to: 6 });
      const { sourceId } = await seedScope(pool);
      await insertAsset(pool, sourceId, "images/diagram.png");
      await insertAsset(pool, sourceId, "docs/readme.png");
      await assertAssetProjectionReady(asReadConnection(pool));
      await runMigrations(pool, migrations, { to: 7 });
      const rows = await pool.query<{ version: number; state: string }[]>(
        "SELECT version, state FROM schema_migrations WHERE version = 7",
      );
      expect(rows.map((row) => [Number(row.version), row.state])).toEqual([[7, "APPLIED"]]);
    } finally {
      await disposePool(handle, pool);
    }
  });
});
