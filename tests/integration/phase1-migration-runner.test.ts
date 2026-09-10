import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { runMigrations, type IsolatedDatabaseHandle } from "../../scripts/db/migrate";
import { migrations } from "@/infrastructure/database/mariadb/migrations";
import type { Migration } from "@/infrastructure/database/mariadb/migrations/types";
import { readFolderMappingFile } from "../../scripts/db/backfill-source-tree-mapping";
import { disposeIsolatedDatabase, provisionIsolatedDatabase } from "../../scripts/db/test-database";
import { uuidv7 } from "@/shared/ids/uuidv7";

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

async function appliedVersions(pool: Pool): Promise<number[]> {
  const rows = await pool.query<{ version: number }[]>("SELECT version FROM schema_migrations ORDER BY version");
  return rows.map((row) => Number(row.version));
}

describe("migration runner target versions and pre-apply hooks", () => {
  it("applies only up to the target version, then continues to the full manifest", async () => {
    const { handle, pool } = await createIsolatedPool();
    try {
      await runMigrations(pool, migrations, { to: 2 });
      expect(await appliedVersions(pool)).toEqual([1, 2]);
      await runMigrations(pool, migrations);
      expect(await appliedVersions(pool)).toEqual([1, 2, 3, 4, 5]);
    } finally {
      await disposePool(handle, pool);
    }
  });

  it("rejects targets below applied versions and unknown or invalid targets", async () => {
    const { handle, pool } = await createIsolatedPool();
    try {
      await runMigrations(pool, migrations);
      await expect(runMigrations(pool, migrations, { to: 4 })).rejects.toThrow(/below already-applied/);
      await expect(runMigrations(pool, migrations, { to: 99 })).rejects.toThrow(/not a known migration version/);
      await expect(runMigrations(pool, migrations, { to: 0 })).rejects.toThrow(/Invalid migration target/);
      expect(await appliedVersions(pool)).toEqual([1, 2, 3, 4, 5]);
    } finally {
      await disposePool(handle, pool);
    }
  });

  it("validates the ledger against the full manifest even for targeted runs", async () => {
    const { handle, pool } = await createIsolatedPool();
    try {
      await runMigrations(pool, migrations, { to: 2 });
      await pool.query("INSERT INTO schema_migrations (version, name, checksum, state, error_message) VALUES (90, 'unknown', ?, 'APPLIED', NULL)", ["f".repeat(64)]);
      await expect(runMigrations(pool, migrations, { to: 2 })).rejects.toThrow(/not present in the current migration manifest/);
      await pool.query("DELETE FROM schema_migrations WHERE version = 90");
      await runMigrations(pool, migrations);
      expect(await appliedVersions(pool)).toEqual([1, 2, 3, 4, 5]);
    } finally {
      await disposePool(handle, pool);
    }
  });

  it("runs the pre-apply hook under the lock before statements and the RUNNING ledger row", async () => {
    const { handle, pool } = await createIsolatedPool();
    const marker: Migration = {
      version: 90,
      name: "test-hook-order",
      statements: ["CREATE TABLE phase1_hook_order (id INT NOT NULL PRIMARY KEY)"],
      beforeApply: async (connection) => {
        const rows = await connection.query<{ table_name: string }[]>(
          "SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'phase1_hook_order'",
        );
        if (rows.length !== 0) throw new Error("Hook ran after the migration statements.");
      },
    };
    try {
      await runMigrations(pool, migrations);
      await runMigrations(pool, [...migrations, marker]);
      expect(await appliedVersions(pool)).toEqual([1, 2, 3, 4, 5, 90]);
    } finally {
      await pool.query("DROP TABLE IF EXISTS phase1_hook_order");
      await pool.query("DELETE FROM schema_migrations WHERE version = 90");
      await disposePool(handle, pool);
    }
  });

  it("leaves no ledger row behind when the pre-apply hook fails", async () => {
    const { handle, pool } = await createIsolatedPool();
    const failing: Migration = {
      version: 91,
      name: "test-hook-failure",
      statements: ["CREATE TABLE phase1_hook_failure (id INT NOT NULL PRIMARY KEY)"],
      beforeApply: async () => {
        throw new Error("Readiness gate refused this migration.");
      },
    };
    try {
      await runMigrations(pool, migrations);
      await expect(runMigrations(pool, [...migrations, failing])).rejects.toThrow(/Readiness gate refused/);
      expect(await pool.query("SELECT version FROM schema_migrations WHERE version = 91")).toEqual([]);
      const tables = await pool.query<{ table_name: string }[]>(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'phase1_hook_failure'",
      );
      expect(tables).toEqual([]);
      await runMigrations(pool, migrations);
      expect(await appliedVersions(pool)).toEqual([1, 2, 3, 4, 5]);
    } finally {
      await pool.query("DROP TABLE IF EXISTS phase1_hook_failure");
      await pool.query("DELETE FROM schema_migrations WHERE version = 91");
      await disposePool(handle, pool);
    }
  });

  it("restricts the pre-apply hook to read-only queries", async () => {
    const { handle, pool } = await createIsolatedPool();
    const writer: Migration = {
      version: 92,
      name: "test-hook-readonly",
      statements: ["CREATE TABLE phase1_hook_readonly (id INT NOT NULL PRIMARY KEY)"],
      beforeApply: async (connection) => {
        await connection.query("SELECT version FROM schema_migrations ORDER BY version");
        await connection.query("INSERT INTO schema_migrations (version, name, checksum, state) VALUES (93, 'sneaky', 'x', 'APPLIED')");
      },
    };
    try {
      await runMigrations(pool, migrations);
      await expect(runMigrations(pool, [...migrations, writer])).rejects.toThrow(/read-only/);
      expect(await pool.query("SELECT version FROM schema_migrations WHERE version IN (92, 93)")).toEqual([]);
    } finally {
      await pool.query("DROP TABLE IF EXISTS phase1_hook_readonly");
      await pool.query("DELETE FROM schema_migrations WHERE version IN (92, 93)");
      await disposePool(handle, pool);
    }
  });

  it("validates folder mapping files before any database work", async () => {
    const directory = await mkdtemp(join(tmpdir(), "hcm-km-mapping-"));
    try {
      const entryId = uuidv7();
      const nodeId = uuidv7();
      const validPath = join(directory, "valid.json");
      await writeFile(validPath, JSON.stringify({ folders: { [entryId]: nodeId } }));
      expect(await readFolderMappingFile(validPath)).toEqual({ [entryId]: nodeId });

      const emptyPath = join(directory, "empty.json");
      await writeFile(emptyPath, JSON.stringify({ folders: {} }));
      expect(await readFolderMappingFile(emptyPath)).toEqual({});

      const missingPath = join(directory, "missing.json");
      await writeFile(missingPath, JSON.stringify({}));
      await expect(readFolderMappingFile(missingPath)).rejects.toThrow(/folders/);

      const badUuidPath = join(directory, "bad-uuid.json");
      await writeFile(badUuidPath, JSON.stringify({ folders: { "not-a-uuid": nodeId } }));
      await expect(readFolderMappingFile(badUuidPath)).rejects.toThrow(/not a UUID/);

      const badJsonPath = join(directory, "bad-json.json");
      await writeFile(badJsonPath, "{oops");
      await expect(readFolderMappingFile(badJsonPath)).rejects.toThrow(/Cannot read folder mapping file/);

      await expect(readFolderMappingFile(join(directory, "does-not-exist.json"))).rejects.toThrow(/Cannot read folder mapping file/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
