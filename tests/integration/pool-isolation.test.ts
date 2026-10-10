import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";

// The unit of work no longer sets the isolation level before each transaction;
// it relies on every pooled connection already being READ COMMITTED.
let pool: Pool;

beforeAll(() => {
  pool = createDatabasePool({ ...databaseConfig("test"), connectionLimit: 1 });
});
afterAll(async () => {
  await pool.end();
});

async function isolationInsideTransaction(): Promise<string> {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const rows = await connection.query<{ level: string }[]>("SELECT @@tx_isolation AS level");
    await connection.rollback();
    return rows[0].level;
  } finally {
    connection.release();
  }
}

describe("pooled connections", () => {
  it("run transactions READ COMMITTED although the server default is not", async () => {
    const rows = await pool.query<{ level: string }[]>("SELECT @@global.tx_isolation AS level");
    expect(rows[0].level).toBe("REPEATABLE-READ");
    expect(await isolationInsideTransaction()).toBe("READ-COMMITTED");
  });

  it("stay READ COMMITTED when a connection is reused after a unit of work", async () => {
    const unitOfWork = new MariaDbUnitOfWork(pool);
    await unitOfWork.run(async () => undefined);
    await expect(unitOfWork.run(async () => { throw new Error("rolled back"); })).rejects.toThrow();
    expect(await isolationInsideTransaction()).toBe("READ-COMMITTED");
  });
});
