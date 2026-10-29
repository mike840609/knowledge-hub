import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { migrations } from "@/infrastructure/database/mariadb/migrations";
import { runMigrations, type IsolatedDatabaseHandle } from "../../scripts/db/migrate";
import { disposeIsolatedDatabase, provisionIsolatedDatabase } from "../../scripts/db/test-database";
import { uuidv7 } from "@/shared/ids/uuidv7";

let handle: IsolatedDatabaseHandle;
let pool: Pool;

beforeAll(async () => {
  handle = await provisionIsolatedDatabase("test");
  pool = createDatabasePool({ ...databaseConfig("test"), database: handle.databaseName });
});

afterAll(async () => {
  await pool?.end();
  if (handle) await disposeIsolatedDatabase(handle);
});

describe("users.account schema", () => {
  it("adds the column to populated databases without changing existing rows", async () => {
    await runMigrations(pool, migrations, { to: 26 });
    const legacyId = uuidv7();
    await pool.query(
      "INSERT INTO users (id, emp_id, name, org_code) VALUES (?, 'LEGACY-ACCOUNT-1', 'Legacy User', 'RD')",
      [legacyId],
    );

    await runMigrations(pool);

    const [column] = await pool.query<{ Type: string; Null: string; Key: string }[]>(
      "SHOW COLUMNS FROM users LIKE 'account'",
    );
    expect(column).toMatchObject({ Type: "varchar(128)", Null: "YES", Key: "UNI" });

    const [legacy] = await pool.query<{ account: string | null }[]>(
      "SELECT account FROM users WHERE id = ?",
      [legacyId],
    );
    expect(legacy.account).toBeNull();

    const indexes = await pool.query<{ Non_unique: number; Column_name: string }[]>(
      "SHOW INDEX FROM users WHERE Key_name = 'uq_users_account'",
    );
    expect(indexes).toHaveLength(1);
    expect(indexes[0]).toMatchObject({ Non_unique: 0, Column_name: "account" });
  });

  it("allows multiple NULLs but rejects duplicate and empty accounts", async () => {
    const insert = (empId: string, account: string | null) =>
      pool.query("INSERT INTO users (id, emp_id, account, name, org_code) VALUES (?, ?, ?, 'User', 'RD')", [
        uuidv7(),
        empId,
        account,
      ]);

    await insert("NULL-ACCOUNT-1", null);
    await insert("NULL-ACCOUNT-2", null);
    await insert("DUP-ACCOUNT-1", "alice");

    await expect(insert("DUP-ACCOUNT-2", "alice")).rejects.toMatchObject({ code: "ER_DUP_ENTRY" });
    await expect(insert("DUP-ACCOUNT-3", "ALICE")).rejects.toMatchObject({ code: "ER_DUP_ENTRY" });
    await expect(insert("EMPTY-ACCOUNT-1", "")).rejects.toThrow(/CONSTRAINT|Check/i);
  });
});
