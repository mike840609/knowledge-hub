import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";

type GlobalPoolSlot = { __kmDbPool?: Pool };

/**
 * The shared pool, pinned on `globalThis`.
 *
 * `next dev` re-evaluates server modules on every HMR reload; a plain
 * module-level singleton would orphan a full pool per reload and exhaust
 * MariaDB max_connections over a session. The slot is the single source of
 * truth — no module-level mirror — so a future one-sided edit cannot
 * reintroduce the HMR pool leak.
 */
export function getDatabasePool(): Pool {
  const slot = globalThis as unknown as GlobalPoolSlot;
  slot.__kmDbPool ??= createDatabasePool(databaseConfig("dev"));
  return slot.__kmDbPool;
}

export async function closeDatabasePool(): Promise<void> {
  const slot = globalThis as unknown as GlobalPoolSlot;
  if (slot.__kmDbPool) await slot.__kmDbPool.end();
  delete slot.__kmDbPool;
}
