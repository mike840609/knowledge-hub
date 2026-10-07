import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { CreateFolderImportService, type ImportManifestEntry } from "@/modules/sources/application/create-folder-import";
import { UploadFolderImportEntriesService } from "@/modules/sources/application/upload-folder-import-entries";
import { FinalizeFolderImportService } from "@/modules/sources/application/finalize-folder-import";
import { DEFAULT_IMPORT_LIMITS } from "@/modules/sources/domain/import-limits";
import { createSourceFixture, fixtureCaller } from "../fixtures/knowledge";

/**
 * Phase 2 spec §6.2: a client may prefilter ignored paths, and the server re-evaluates them. The
 * browser now prefilters every ignored path; these cases hold the server to the half that must not
 * change: a client that does not prefilter still imports, and the source's own exclusion rules
 * are still enforced. Widening the ignore rule must not turn an ignored entry into an
 * "excluded path" refusal.
 */
let pool: Pool;
const now = new Date("2026-10-07T09:00:00.000Z");
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
  };
}

const keptBytes = new TextEncoder().encode("# Kept\nbody\n");
const ignoredBytes = new TextEncoder().encode("# Package readme\n");
const kept: ImportManifestEntry = { uploadKey: "keep", relativePath: "notes/kept.md", kind: "MARKDOWN", size: keptBytes.byteLength };
const ignored: ImportManifestEntry = { uploadKey: "readme", relativePath: "node_modules/pkg/README.md", kind: "MARKDOWN", size: ignoredBytes.byteLength };

describe("ignored paths from a client that does not prefilter", () => {
  it("imports the kept notes on resync with exclusion settings, and leaves the ignored file out of the result", async () => {
    const fixture = await createSourceFixture(pool, { managed: true });
    const { create, upload, finalize } = services();

    const session = await create.createResync(fixtureCaller(), {
      sourceId: fixture.source.id, rootName: "repo",
      manifest: [ignored, kept],
      importScope: { paths: ["drafts"], excludedCount: 0 },
    });
    await upload.upload(fixtureCaller(), { snapshotId: session.snapshotId, entries: [{ uploadKey: "readme", bytes: ignoredBytes }, { uploadKey: "keep", bytes: keptBytes }] });
    const preview = await finalize.finalize(fixtureCaller(), session.snapshotId);

    expect(preview.state).toBe("READY");
    expect(preview.hasBlockers).toBe(false);
    expect(preview.changes.map((change) => change.sourcePath)).toContain("notes/kept.md");
    expect(preview.changes.some((change) => change.sourcePath.includes("node_modules"))).toBe(false);
  });

  it("still refuses a manifest that lists a path the source's own rules exclude", async () => {
    const fixture = await createSourceFixture(pool, { managed: true });
    const { create } = services();
    const draft: ImportManifestEntry = { uploadKey: "draft", relativePath: "drafts/wip.md", kind: "MARKDOWN", size: 4 };

    await expect(create.createResync(fixtureCaller(), {
      sourceId: fixture.source.id, rootName: "repo",
      manifest: [draft, kept],
      importScope: { paths: ["drafts"], excludedCount: 0 },
    })).rejects.toMatchObject({ code: "INVALID_IMPORT_MANIFEST" });
  });
});
