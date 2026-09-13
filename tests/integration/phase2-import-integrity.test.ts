import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { ApplyFolderImportService } from "@/modules/sources/application/apply-folder-import";
import { CreateFolderImportService } from "@/modules/sources/application/create-folder-import";
import { FinalizeFolderImportService } from "@/modules/sources/application/finalize-folder-import";
import { UploadFolderImportEntriesService } from "@/modules/sources/application/upload-folder-import-entries";
import { DEFAULT_IMPORT_LIMITS } from "@/modules/sources/domain/import-limits";
import { createSourceFixture, fixtureCaller } from "../fixtures/knowledge";

let pool: Pool;
const now = new Date("2026-09-13T06:00:00.000Z");
const clock = () => new Date(now);

beforeAll(() => { pool = createDatabasePool(databaseConfig("test")); });
afterAll(async () => { await pool.end(); });
beforeEach(async () => {
  await pool.query("DELETE FROM source_import_snapshot_entries");
  await pool.query("DELETE FROM source_import_snapshots");
});

function services() {
  const uow = new MariaDbUnitOfWork(pool);
  return {
    create: new CreateFolderImportService(uow, { limits: DEFAULT_IMPORT_LIMITS, now: clock }),
    upload: new UploadFolderImportEntriesService(uow, { limits: DEFAULT_IMPORT_LIMITS, now: clock }),
    finalize: new FinalizeFolderImportService(uow, { limits: DEFAULT_IMPORT_LIMITS, now: clock }),
    apply: new ApplyFolderImportService(uow, { now: clock }),
  };
}

async function readyInitial(): Promise<{ snapshotId: string; workspaceId: string }> {
  const fixture = await createSourceFixture(pool);
  const body = new TextEncoder().encode("# Integrity\n\ntrusted body\n");
  const svc = services();
  const session = await svc.create.createInitial(fixtureCaller(), {
    workspaceId: fixture.workspaceId,
    sourceName: "Integrity Wiki",
    rootName: "wiki",
    manifest: [{ uploadKey: "m1", relativePath: "docs/integrity.md", kind: "MARKDOWN", size: body.byteLength }],
  });
  await svc.upload.upload(fixtureCaller(), { snapshotId: session.snapshotId, entries: [{ uploadKey: "m1", bytes: body }] });
  await svc.finalize.finalize(fixtureCaller(), session.snapshotId);
  return { snapshotId: session.snapshotId, workspaceId: fixture.workspaceId };
}

async function expectReadyAndUnconsumed(snapshotId: string): Promise<void> {
  const row = (await pool.query<{ state: string; result_source_id: string | null }[]>(
    "SELECT state,result_source_id FROM source_import_snapshots WHERE id=?",
    [snapshotId],
  ))[0];
  expect(row).toEqual({ state: "READY", result_source_id: null });
}

describe("Phase 2 READY snapshot integrity", () => {
  it("rejects a persisted action plan whose bytes no longer match plan_hash", async () => {
    const { snapshotId } = await readyInitial();
    await pool.query(
      "UPDATE source_import_snapshots SET plan=JSON_SET(plan, '$.documents.create[0].content.title', 'Tampered title') WHERE id=?",
      [snapshotId],
    );

    await expect(services().apply.apply(fixtureCaller(), snapshotId)).rejects.toMatchObject({
      code: "IMPORT_SNAPSHOT_INTEGRITY_MISMATCH",
    });
    await expectReadyAndUnconsumed(snapshotId);
  });

  it("rejects finalized snapshot entry drift whose bytes no longer match snapshot_hash", async () => {
    const { snapshotId } = await readyInitial();
    await pool.query(
      "UPDATE source_import_snapshot_entries SET markdown=CONCAT(markdown, 'tampered') WHERE snapshot_id=? AND entry_type='DOCUMENT'",
      [snapshotId],
    );

    await expect(services().apply.apply(fixtureCaller(), snapshotId)).rejects.toMatchObject({
      code: "IMPORT_SNAPSHOT_INTEGRITY_MISMATCH",
    });
    await expectReadyAndUnconsumed(snapshotId);
  });
});
