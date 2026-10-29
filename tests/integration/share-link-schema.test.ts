import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { uuidv7 } from "@/shared/ids/uuidv7";
import { createDocumentFixture, createSourceFixture, fixtureIdentity } from "../fixtures/knowledge";

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

describe("migrations 011 and 027 (share-link spec §7)", () => {
  it("stores no workspace or source scope on the link", async () => {
    expect(await columns("document_share_links")).toEqual([
      "id", "document_id", "folder_node_id", "token", "label", "created_by", "created_at", "expires_at", "revoked_by", "revoked_at",
    ]);
  });

  it("counts views without any column that identifies the viewer", async () => {
    expect(await columns("document_share_link_views")).toEqual([
      "share_link_id", "view_date", "first_viewed_at", "last_viewed_at", "view_count",
    ]);
  });

  describe("one target per link (folder share link spec)", () => {
    async function insertLink(documentId: string | null, folderNodeId: string | null): Promise<void> {
      await pool.query(
        `INSERT INTO document_share_links (id, document_id, folder_node_id, token, created_by, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, NOW(), NOW() + INTERVAL 1 DAY)`,
        [uuidv7(), documentId, folderNodeId, crypto.randomUUID(), fixtureIdentity.id],
      );
    }

    it("accepts a row with only a folder target and refuses both targets or neither", async () => {
      const { source, folderId } = await createSourceFixture(pool);
      const { documentId } = await createDocumentFixture(pool, source.id, folderId);

      await expect(insertLink(null, folderId)).resolves.toBeUndefined();
      await expect(insertLink(documentId, folderId)).rejects.toThrow(/ck_share_links_one_target|CONSTRAINT/);
      await expect(insertLink(null, null)).rejects.toThrow(/ck_share_links_one_target|CONSTRAINT/);
    });
  });
});
