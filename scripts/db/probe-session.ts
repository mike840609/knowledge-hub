import type { PoolConnection } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";

type Check = { name: string; pass: boolean; observed: unknown };

function record(checks: Check[], name: string, pass: boolean, observed: unknown): void {
  checks.push({ name, pass, observed });
}

function display(value: unknown): string {
  if (typeof value === "string") return value;
  try { return JSON.stringify(value) ?? String(value); } catch { return String(value); }
}

async function readSession(connection: PoolConnection): Promise<{ version: string; isolation: string; tz: string } | undefined> {
  const rows = await connection.query<{ version: string; isolation: string; tz: string }[]>(
    // MariaDB 10.11 spells this @@tx_isolation; @@transaction_isolation only
    // arrived in 11.1.1, so keep the 10.11 name here.
    "SELECT @@version AS version, @@tx_isolation AS isolation, @@session.time_zone AS tz",
  );
  return rows[0];
}

/**
 * Layerbase puts MySQL-family databases behind a pooler. Session-scoped state
 * (our READ COMMITTED / UTC init and the GET_LOCK used by migrations and the
 * import quota) is only safe if the pooler keeps a client on one backend. Run
 * this once against the real database before trusting the pooled URL:
 *
 *   KM_DB_URL="<pooled or direct>" npm run db:probe
 *
 * All PASS → the pooled URL is safe for the app. Any FAIL → point KM_DB_URL at
 * the direct URL instead. The deployment runbook carries the same rule.
 */
async function main(): Promise<void> {
  // Two connections so the probe can open a second one while the first is held;
  // otherwise the pool hands back the same socket and "fresh" proves nothing.
  const pool = createDatabasePool({ ...databaseConfig("dev"), connectionLimit: 2 });
  const checks: Check[] = [];
  let connection: PoolConnection | undefined;
  try {
    connection = await pool.getConnection();
    const first = await readSession(connection);
    record(checks, "server version", Boolean(first?.version), first?.version);
    record(checks, "session isolation", first?.isolation === "READ-COMMITTED", first?.isolation);
    record(checks, "session time zone", first?.tz === "+00:00", first?.tz);

    await connection.beginTransaction();
    const during = await readSession(connection);
    await connection.commit();
    record(checks, "isolation inside a transaction", during?.isolation === "READ-COMMITTED", during?.isolation);

    const lock = await connection.query<{ acquired: unknown }[]>("SELECT GET_LOCK('km_probe', 2) AS acquired");
    record(checks, "GET_LOCK acquired", Number(lock[0]?.acquired) === 1, lock[0]?.acquired);

    const holder = await connection.query<{ holder: unknown; id: unknown }[]>(
      "SELECT IS_USED_LOCK('km_probe') AS holder, CONNECTION_ID() AS id",
    );
    record(
      checks,
      "GET_LOCK holder is this connection",
      Number(holder[0]?.holder) === Number(holder[0]?.id),
      { holder: holder[0]?.holder, id: holder[0]?.id },
    );

    const released = await connection.query<{ released: unknown }[]>("SELECT RELEASE_LOCK('km_probe') AS released");
    record(checks, "RELEASE_LOCK", Number(released[0]?.released) === 1, released[0]?.released);

    const afterLock = await readSession(connection);
    record(checks, "isolation after lock round-trip", afterLock?.isolation === "READ-COMMITTED", afterLock?.isolation);

    // Held while acquiring: the pool must open a separate physical connection.
    const fresh = await pool.getConnection();
    try {
      const second = await readSession(fresh);
      record(checks, "new connection isolation", second?.isolation === "READ-COMMITTED", second?.isolation);
      record(checks, "new connection time zone", second?.tz === "+00:00", second?.tz);
    } finally {
      fresh.release();
    }

    connection.release();
    connection = undefined;
  } catch (error) {
    record(checks, "connection", false, error instanceof Error ? error.message : String(error));
  } finally {
    connection?.release();
    await pool.end();
  }

  for (const check of checks) {
    console.log(`${check.pass ? "PASS" : "FAIL"} ${check.name}: ${display(check.observed)}`);
  }
  const failed = checks.filter((check) => !check.pass);
  console.log(failed.length === 0 ? "Session probe passed." : `Session probe failed: ${failed.length} check(s).`);
  process.exitCode = failed.length === 0 ? 0 : 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
