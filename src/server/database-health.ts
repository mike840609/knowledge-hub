import { databaseConfig } from "@/infrastructure/database/mariadb/config";

export type HealthPool = {
  query(sql: string): Promise<unknown>;
};

/** Follow KM_DB_CONNECT_TIMEOUT_MS so a deliberately longer wake window is
 * not reported as a failed health check. */
export function healthTimeoutMs(): number {
  return databaseConfig("dev").connectTimeout ?? 30_000;
}

/** One round trip proves the pool can reach the database. The deadline also
 * covers a socket that connects but never answers, which driver timeouts do
 * not: the route must answer 503 rather than run to the platform limit. */
export async function pingDatabase(pool: HealthPool, timeoutMs = healthTimeoutMs()): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      pool.query("SELECT 1"),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Database ping timed out.")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
