import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { migrations } from "@/infrastructure/database/mariadb/migrations";
import { runMigrations, type IsolatedDatabaseHandle } from "../../scripts/db/migrate";
import { disposeIsolatedDatabase, provisionIsolatedDatabase } from "../../scripts/db/test-database";
import { uuidv7 } from "@/shared/ids/uuidv7";
import { MariaDbUserRepository } from "@/infrastructure/database/mariadb/repositories/users";
import type { UserIdentity } from "@/modules/identity/domain/user-identity";

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

describe("users profile columns", () => {
  it("adds account and name_en to populated databases without changing existing rows", async () => {
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

    const [nameEn] = await pool.query<{ Type: string; Null: string; Key: string }[]>(
      "SHOW COLUMNS FROM users LIKE 'name_en'",
    );
    expect(nameEn).toMatchObject({ Type: "varchar(512)", Null: "YES", Key: "" });

    const [legacy] = await pool.query<{ account: string | null; name_en: string | null }[]>(
      "SELECT account, name_en FROM users WHERE id = ?",
      [legacyId],
    );
    expect(legacy.account).toBeNull();
    expect(legacy.name_en).toBeNull();

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

  it("stores an optional English name and rejects an empty one", async () => {
    const id = uuidv7();
    await pool.query(
      "INSERT INTO users (id, emp_id, name, name_en, org_code) VALUES (?, 'NAME-EN-1', 'Name', 'John Smith', 'RD')",
      [id],
    );

    const [row] = await pool.query<{ name_en: string | null }[]>(
      "SELECT name_en FROM users WHERE id = ?",
      [id],
    );
    expect(row.name_en).toBe("John Smith");

    await expect(
      pool.query(
        "INSERT INTO users (id, emp_id, name, name_en, org_code) VALUES (?, 'NAME-EN-2', 'Name', '', 'RD')",
        [uuidv7()],
      ),
    ).rejects.toThrow(/CONSTRAINT|Check/i);
  });
});

function identity(empId: string): UserIdentity {
  return { id: uuidv7(), emp_id: empId, name: "Account User", org_code: "RD" };
}

describe("MariaDbUserRepository account writes", () => {
  it("inserts an account and leaves it NULL when omitted", async () => {
    const users = new MariaDbUserRepository(pool);
    const withAccount = identity(`ACC-WITH-${uuidv7()}`);
    const withoutAccount = identity(`ACC-WITHOUT-${uuidv7()}`);
    const account = `alice-${uuidv7()}`;

    await users.insert(withAccount, account);
    await users.insert(withoutAccount);

    const rows = await pool.query<{ id: string; account: string | null }[]>(
      "SELECT id, account FROM users WHERE id IN (?, ?)",
      [withAccount.id, withoutAccount.id],
    );
    expect(rows.find((row) => row.id === withAccount.id)?.account).toBe(account);
    expect(rows.find((row) => row.id === withoutAccount.id)?.account).toBeNull();
  });

  it("updates only the account and never clears it through upsert or profile sync", async () => {
    const users = new MariaDbUserRepository(pool);
    const user = identity(`ACC-KEEP-${uuidv7()}`);
    const before = `alice-before-${uuidv7()}`;
    const after = `alice-after-${uuidv7()}`;

    await users.insert(user, before);
    await users.updateAccount(user.id, after);
    await users.upsertIdentity({ ...user, name: "Renamed" });
    await users.updateProfile(user.id, { name: "Renamed Again", org_code: "OPS" });

    const [row] = await pool.query<{ account: string; name: string; org_code: string }[]>(
      "SELECT account, name, org_code FROM users WHERE id = ?",
      [user.id],
    );
    expect(row).toMatchObject({ account: after, name: "Renamed Again", org_code: "OPS" });
  });

  it("rejects a duplicate account on insert or update", async () => {
    const users = new MariaDbUserRepository(pool);
    const first = identity(`ACC-FIRST-${uuidv7()}`);
    const second = identity(`ACC-SECOND-${uuidv7()}`);
    const shared = `shared-${uuidv7()}`;

    await users.insert(first, shared);
    await users.insert(second, `second-${uuidv7()}`);

    await expect(users.insert(identity(`ACC-THIRD-${uuidv7()}`), shared)).rejects.toMatchObject({
      code: "ER_DUP_ENTRY",
    });
    await expect(users.updateAccount(second.id, shared)).rejects.toMatchObject({
      code: "ER_DUP_ENTRY",
    });
  });
});
