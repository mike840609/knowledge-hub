import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { resolveGoogleIdentity } from "@/server/google-identity";

let pool: Pool;

beforeAll(() => {
  pool = createDatabasePool(databaseConfig("test"));
});

afterAll(async () => {
  await pool.end();
});

describe("resolveGoogleIdentity", () => {
  it("creates one user and one link, then reuses them and updates the name", async () => {
    const subject = `google-${Date.now()}-${Math.random()}`;
    const unitOfWork = new MariaDbUnitOfWork(pool);
    const first = await resolveGoogleIdentity({ subject, name: "First Name", email: "first@example.com" }, unitOfWork);
    expect(first.emp_id).toMatch(/^DEMO-[0-9A-F]{10}$/);
    expect(first.org_code).toBe("DEMO");

    const second = await resolveGoogleIdentity({ subject, name: "Updated Name", email: "first@example.com" }, unitOfWork);
    expect(second.id).toBe(first.id);
    expect(second.emp_id).toBe(first.emp_id);
    expect(second.name).toBe("Updated Name");

    const link = await unitOfWork.run((repositories) => repositories.identityLinks.findByProviderSubject("google", subject));
    expect(link?.hubUserId).toBe(first.id);

    const [created] = await pool.query<{ account: string | null; name_en: string | null }[]>(
      "SELECT account, name_en FROM users WHERE id = ?",
      [first.id],
    );
    expect(created).toMatchObject({ account: null, name_en: null });

    // A later Google profile update must not write or clear either company field.
    const existingAccount = `google-existing-${subject}`;
    const existingNameEn = `Google English ${subject}`;
    await pool.query("UPDATE users SET account = ?, name_en = ? WHERE id = ?", [existingAccount, existingNameEn, first.id]);
    const third = await resolveGoogleIdentity(
      { subject, name: "Third Name", email: "first@example.com" },
      unitOfWork,
    );
    expect(third.id).toBe(first.id);
    const [afterUpdate] = await pool.query<{ account: string | null; name_en: string | null }[]>(
      "SELECT account, name_en FROM users WHERE id = ?",
      [first.id],
    );
    expect(afterUpdate).toMatchObject({ account: existingAccount, name_en: existingNameEn });
  });
});
