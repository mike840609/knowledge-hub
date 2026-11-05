import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";

// mariadb 3.5 reads and writes DATETIME in the Node process's zone whatever
// `timezone` says. A developer outside UTC then saw every CURRENT_TIMESTAMP
// default shifted by their offset (Taipei: 8 hours early) while production,
// whose Node runs in UTC, did not.
let pool: Pool;
let zone: string | undefined;

beforeAll(() => {
  zone = process.env.TZ;
  process.env.TZ = "Asia/Taipei"; // a developer's machine, not production's UTC
  pool = createDatabasePool({ ...databaseConfig("test"), connectionLimit: 1 });
});
afterAll(async () => {
  await pool.end();
  if (zone === undefined) delete process.env.TZ;
  else process.env.TZ = zone;
});

describe("dates through the pool, in a process outside UTC", () => {
  it("reads a database default as the instant it is", async () => {
    const [row] = await pool.query<{ now: Date }[]>("SELECT UTC_TIMESTAMP(3) AS now");
    expect(Math.abs(row.now.getTime() - Date.now())).toBeLessThan(60_000);
  });

  it("writes a Date as UTC, so it agrees with the database's own defaults", async () => {
    const connection = await pool.getConnection();
    try {
      await connection.query("CREATE TEMPORARY TABLE utc_probe (d DATETIME(0))");
      const instant = new Date(Date.UTC(2026, 10, 5, 4, 31, 24));
      await connection.query("INSERT INTO utc_probe VALUES (?)", [instant]);
      const [row] = await connection.query<{ d: Date; text: string }[]>("SELECT d, CAST(d AS CHAR) AS text FROM utc_probe");
      expect(row.text).toBe("2026-11-05 04:31:24");
      expect(row.d.getTime()).toBe(instant.getTime());
    } finally {
      connection.release();
    }
  });
});
