import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { CreateFolderImportService, type ImportManifestEntry } from "@/modules/sources/application/create-folder-import";
import { DEFAULT_IMPORT_LIMITS } from "@/modules/sources/domain/import-limits";
import { createSourceFixture, fixtureCaller } from "../fixtures/knowledge";

let pool: Pool;
const now = new Date("2026-09-13T07:00:00.000Z");
const clock = () => new Date(now);

beforeAll(() => { pool = createDatabasePool(databaseConfig("test")); });
afterAll(async () => { await pool.end(); });

function asset(mimeType: string): ImportManifestEntry {
  return {
    uploadKey: "asset-1",
    relativePath: "diagram.bin",
    kind: "ASSET",
    size: 1,
    contentHash: "a".repeat(64),
    mimeType,
    lastModified: null,
  };
}

describe("Phase 2 manifest storage boundaries", () => {
  it("rejects an Asset MIME value that cannot fit the canonical VARCHAR(255) column", async () => {
    const fixture = await createSourceFixture(pool);
    const create = new CreateFolderImportService(new MariaDbUnitOfWork(pool), { limits: DEFAULT_IMPORT_LIMITS, now: clock });
    const before = Number((await pool.query<{ count: unknown }[]>("SELECT COUNT(*) AS count FROM source_import_snapshots"))[0].count);

    await expect(create.createInitial(fixtureCaller(), {
      workspaceId: fixture.workspaceId,
      sourceName: "MIME bounds",
      rootName: "wiki",
      manifest: [asset("x".repeat(256))],
    })).rejects.toMatchObject({ code: "INVALID_ASSET_MANIFEST" });

    const after = Number((await pool.query<{ count: unknown }[]>("SELECT COUNT(*) AS count FROM source_import_snapshots"))[0].count);
    expect(after).toBe(before);
  });

  it("accepts an Asset MIME value exactly at the 255-character storage boundary", async () => {
    const fixture = await createSourceFixture(pool);
    const create = new CreateFolderImportService(new MariaDbUnitOfWork(pool), { limits: DEFAULT_IMPORT_LIMITS, now: clock });

    await expect(create.createInitial(fixtureCaller(), {
      workspaceId: fixture.workspaceId,
      sourceName: "MIME boundary",
      rootName: "wiki",
      manifest: [asset("x".repeat(255))],
    })).resolves.toMatchObject({ state: "BUILDING" });
  });
});
