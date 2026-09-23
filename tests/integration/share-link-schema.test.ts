import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";

let pool: Pool;
beforeAll(() => { pool = createDatabasePool(databaseConfig("test")); });
afterAll(async () => { await pool.end(); });

async function columns(table: string): Promise<string[]> {
  const rows = await pool.query<{ column_name: string }[]>(
    "SELECT column_name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? ORDER BY ordinal_position",
    [table],
  );
  return rows.map((row) => row.column_name);
}

describe("migration 011 (share-link spec §7)", () => {
  it("stores no workspace or source scope on the link", async () => {
    expect(await columns("document_share_links")).toEqual([
      "id", "document_id", "token", "label", "created_by", "created_at", "expires_at", "revoked_by", "revoked_at",
    ]);
  });

  it("counts views without any column that identifies the viewer", async () => {
    expect(await columns("document_share_link_views")).toEqual([
      "share_link_id", "view_date", "first_viewed_at", "last_viewed_at", "view_count",
    ]);
  });
});
