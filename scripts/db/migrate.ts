import { createHash, randomUUID } from "node:crypto";
import mariadb, { type Pool, type PoolConnection } from "mariadb";
import { adminDatabaseConfig, databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { migrations } from "@/infrastructure/database/mariadb/migrations";
import type { Migration, MigrationReadConnection } from "@/infrastructure/database/mariadb/migrations/types";

export type IsolatedDatabaseHandle = { kind: "test" | "e2e"; databaseName: string; ownershipToken: string };
const activeDatabaseHandles = new Map<string, IsolatedDatabaseHandle>();

function checksum(migration: Migration): string {
  return createHash("sha256").update(JSON.stringify(migration.statements), "utf8").digest("hex");
}

export async function ensureMigrationLedger(pool: Pool): Promise<void> {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INT UNSIGNED NOT NULL,
    name VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    checksum CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    state VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'RUNNING',
    error_message VARCHAR(1024) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
    started_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    applied_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (version)
  ) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
}

const READ_ONLY_STATEMENT = /^\s*(SELECT|SHOW|DESCRIBE|DESC|EXPLAIN)\b/i;

function asReadOnly(connection: PoolConnection): MigrationReadConnection {
  return {
    query: async <T>(sql: string, params?: unknown[]): Promise<T> => {
      if (!READ_ONLY_STATEMENT.test(sql)) {
        throw new Error("Migration pre-apply hooks accept read-only queries (SELECT/SHOW/DESCRIBE/EXPLAIN) only.");
      }
      return connection.query(sql, params) as Promise<T>;
    },
  };
}

export type MigrateOptions = { to?: number };

function resolveTarget(items: readonly Migration[], appliedVersions: number[], to: number | undefined): number | undefined {
  if (to === undefined) return undefined;
  if (!Number.isInteger(to) || to <= 0) throw new Error(`Invalid migration target: ${String(to)}. Expected a positive migration version.`);
  if (!items.some((migration) => migration.version === to)) {
    throw new Error(`Migration target ${to} is not a known migration version.`);
  }
  const above = appliedVersions.filter((version) => version > to);
  if (above.length > 0) {
    throw new Error(`Migration target ${to} is below already-applied migration ${Math.min(...above)}; explicit DDL/ledger repair is required instead of a target downgrade.`);
  }
  return to;
}

export async function runMigrations(pool: Pool, items: readonly Migration[] = migrations, options: MigrateOptions = {}): Promise<void> {
  await ensureMigrationLedger(pool);
  const connection = await pool.getConnection();
  const lockName = "hcm_km_schema_migrations";
  try {
    const lockRows = await connection.query<{ acquired: number }[]>("SELECT GET_LOCK(?, 60) AS acquired", [lockName]);
    if (Number(lockRows[0]?.acquired) !== 1) throw new Error("Could not acquire the schema migration lock within 60 seconds.");

    const applied = await connection.query<{ version: number; name: string; checksum: string; state: string }[]>(
      "SELECT version, name, checksum, state FROM schema_migrations ORDER BY version",
    );
    const expectedVersions = new Set(items.map((migration) => migration.version));
    for (const row of applied) {
      if (!expectedVersions.has(Number(row.version))) throw new Error(`Database contains migration ${row.version}, which is not present in the current migration manifest.`);
      if (row.state !== "APPLIED") throw new Error(`Migration ${row.version} is recorded as ${row.state}; rebuild the disposable database or repair it explicitly before continuing.`);
    }
    const target = resolveTarget(items, applied.map((row) => Number(row.version)), options.to);
    const executable = target === undefined ? items : items.filter((migration) => migration.version <= target);
    const appliedByVersion = new Map(applied.map((row) => [Number(row.version), row]));
    for (const migration of executable) {
      const existing = appliedByVersion.get(migration.version);
      const expectedChecksum = checksum(migration);
      if (existing) {
        if (existing.checksum !== expectedChecksum || existing.name !== migration.name) {
          throw new Error(`Migration ${migration.version} checksum/name mismatch; repair explicitly before continuing.`);
        }
        if (existing.state !== "APPLIED") throw new Error(`Migration ${migration.version} is recorded as ${existing.state}; rebuild the disposable database or repair it explicitly before continuing.`);
        continue;
      }
      const higherApplied = applied.some((row) => Number(row.version) > migration.version);
      if (higherApplied) throw new Error(`Migration ${migration.version} is missing while a later migration is recorded.`);
      if (migration.beforeApply) await migration.beforeApply(asReadOnly(connection));
      await connection.query(
        "INSERT INTO schema_migrations (version, name, checksum, state, error_message, started_at, applied_at) VALUES (?, ?, ?, 'RUNNING', NULL, CURRENT_TIMESTAMP(6), CURRENT_TIMESTAMP(6))",
        [migration.version, migration.name, expectedChecksum],
      );
      try {
        for (const statement of migration.statements) await connection.query(statement);
        await connection.query("UPDATE schema_migrations SET state = 'APPLIED', error_message = NULL, applied_at = CURRENT_TIMESTAMP(6) WHERE version = ?", [migration.version]);
      } catch (error) {
        const diagnostic = error instanceof Error ? error.message.slice(0, 1024) : "Migration failed.";
        try { await connection.query("UPDATE schema_migrations SET state = 'FAILED', error_message = ? WHERE version = ?", [diagnostic, migration.version]); } catch { /* retain original failure */ }
        throw error;
      }
    }
  } finally {
    try { await connection.query("SELECT RELEASE_LOCK(?)", [lockName]); } catch { /* connection cleanup is best effort */ }
    connection.release();
  }
}

const MIGRATE_HELP = `Usage: npm run db:migrate [-- --to <version>] [--help]

Applies the committed migration manifest in version order under the schema
migration lock. The ledger is always validated against the full manifest;
--to only limits how far forward this run executes.

  --to <version>   Apply pending migrations up to and including <version>.
                   Targets below an already-applied version are rejected;
                   downgrades require explicit DDL/ledger repair, never a
                   target flag. Unknown versions are rejected.

Phase 1 populated-upgrade runbook (stop canonical writes + back up first,
hold write quiescence through the final step):

  npm run db:migrate -- --to 4
  npx tsx scripts/db/backfill-source-tree-mapping.ts --mapping /path/to/verified-mapping.json --dry-run
  npx tsx scripts/db/backfill-source-tree-mapping.ts --mapping /path/to/verified-mapping.json --apply
  npm run db:migrate -- --to 5

An untargeted run on a populated database safely stops at the 005 readiness
gate (004 stays APPLIED, 005 gets no ledger row); backfill, then rerun.
DDL failures keep the FAILED/RUNNING ledger diagnostics: repair the schema
explicitly and clear only the affected ledger row — never edit checksums.
`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(MIGRATE_HELP);
    return;
  }
  const toIndex = args.indexOf("--to");
  const to = toIndex === -1 ? undefined : Number(args[toIndex + 1]);
  if (toIndex !== -1 && (args[toIndex + 1] === undefined || !Number.isInteger(to))) {
    throw new Error("Invalid --to value. Expected: npm run db:migrate -- --to <version>.");
  }
  const kind = process.env.KM_MIGRATION_TARGET === "test" ? "test" : process.env.KM_MIGRATION_TARGET === "e2e" ? "e2e" : "dev";
  const pool = createDatabasePool(databaseConfig(kind));
  try {
    await runMigrations(pool, migrations, { to });
    console.log(`Migrations are up to date for ${databaseConfig(kind).database}${to === undefined ? "" : ` (target ${to})`}.`);
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

export async function createIsolatedDatabase(kind: "test" | "e2e", databaseName: string): Promise<IsolatedDatabaseHandle> {
  if (!/^(hcm_km_test_|hcm_km_e2e_)[a-z0-9_]+$/.test(databaseName)) {
    throw new Error(`Refusing to create an unscoped test database name: ${databaseName}`);
  }
  const config = adminDatabaseConfig(kind);
  const pool = mariadb.createPool({ ...config, connectionLimit: 2 });
  try {
    await pool.query(`CREATE DATABASE \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  } finally {
    await pool.end();
  }
  const handle = { kind, databaseName, ownershipToken: `${kind}:${databaseName}:${process.pid}:${Date.now()}:${randomUUID()}` } as IsolatedDatabaseHandle;
  activeDatabaseHandles.set(handle.ownershipToken, handle);
  return handle;
}

export async function dropIsolatedDatabase(handle: IsolatedDatabaseHandle): Promise<void> {
  const owned = activeDatabaseHandles.get(handle.ownershipToken);
  if (!owned || owned !== handle || owned.kind !== handle.kind || owned.databaseName !== handle.databaseName) {
    throw new Error("Refusing to drop a test database without the current process ownership handle.");
  }
  if (!/^(hcm_km_test_|hcm_km_e2e_)[a-z0-9_]+$/.test(handle.databaseName) || !handle.ownershipToken.startsWith(`${handle.kind}:${handle.databaseName}:`)) {
    throw new Error(`Refusing to drop an unscoped test database name: ${handle.databaseName}`);
  }
  const config = adminDatabaseConfig(handle.kind);
  const pool = mariadb.createPool({ ...config, connectionLimit: 2 });
  try {
    await pool.query(`DROP DATABASE \`${handle.databaseName}\``);
    activeDatabaseHandles.delete(handle.ownershipToken);
  } finally {
    await pool.end();
  }
}
