export type HealthPool = {
  query(sql: string): Promise<unknown>;
};

/** One round trip is enough to prove the pool can reach the database. */
export async function pingDatabase(pool: HealthPool): Promise<void> {
  await pool.query("SELECT 1");
}
