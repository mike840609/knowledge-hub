import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { CreateFolderImportService, type ImportManifestEntry } from "@/modules/sources/application/create-folder-import";
import { UploadFolderImportEntriesService } from "@/modules/sources/application/upload-folder-import-entries";
import { FinalizeFolderImportService } from "@/modules/sources/application/finalize-folder-import";
import { ApplyFolderImportService } from "@/modules/sources/application/apply-folder-import";
import { DEFAULT_IMPORT_LIMITS } from "@/modules/sources/domain/import-limits";
import { createDocumentForAnySource, createEntryFixture, createSourceFixture, fixtureCaller, fixtureIdentity } from "../fixtures/knowledge";

let pool: Pool;
const now = new Date("2026-09-12T12:30:00.000Z");
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

function markdown(uploadKey: string, path: string, bytes: Uint8Array): ImportManifestEntry {
  return { uploadKey, relativePath: path, kind: "MARKDOWN", size: bytes.byteLength };
}

async function previewExisting(sourceId: string, path: string, bytes: Uint8Array) {
  const { create, upload, finalize } = services();
  const session = await create.createResync(fixtureCaller(), { sourceId, rootName: "wiki", manifest: [markdown("m1", path, bytes)] });
  await upload.upload(fixtureCaller(), { snapshotId: session.snapshotId, entries: [{ uploadKey: "m1", bytes }] });
  return finalize.finalize(fixtureCaller(), session.snapshotId);
}

describe("Phase 2 import finalization edge contracts", () => {
  it("turns metadata above the exact 256 KiB default limit into a READY blocker", async () => {
    const fixture = await createSourceFixture(pool);
    const large = "x".repeat(DEFAULT_IMPORT_LIMITS.maxMetadataBytes + 1);
    const bytes = new TextEncoder().encode(`---\nlarge: ${large}\n---\n# Large\n`);
    const { create, upload, finalize } = services();
    const session = await create.createInitial(fixtureCaller(), {
      workspaceId: fixture.workspaceId,
      sourceName: "Large Metadata",
      rootName: "wiki",
      manifest: [markdown("m1", "large.md", bytes)],
    });
    await upload.upload(fixtureCaller(), { snapshotId: session.snapshotId, entries: [{ uploadKey: "m1", bytes }] });
    const preview = await finalize.finalize(fixtureCaller(), session.snapshotId);
    expect(preview.state).toBe("READY");
    expect(preview.hasBlockers).toBe(true);
    expect(preview.changes.flatMap((change) => change.diagnostics).map((diagnostic) => diagnostic.code)).toContain("METADATA_TOO_LARGE");
  });

  it("previews an archived exact-path document as RESTORED while keeping its stable identity", async () => {
    const fixture = await createSourceFixture(pool, { managed: true });
    const document = await createDocumentForAnySource(pool, fixture.source.id, fixture.folderId);
    const entry = await createEntryFixture(pool, fixture.source.id, document.documentId, "restore-me");
    const path = "docs/restored.md";
    await pool.query("UPDATE source_entries SET source_path=?, external_id=NULL, status='ARCHIVED', archived_by=?, archived_at=?, updated_by=? WHERE id=?", [path, fixtureIdentity.id, now, fixtureIdentity.id, entry.entryId]);
    await pool.query("UPDATE knowledge_documents SET status='ARCHIVED', archived_by=?, archived_at=?, updated_by=? WHERE id=?", [fixtureIdentity.id, now, fixtureIdentity.id, document.documentId]);
    await pool.query("UPDATE knowledge_tree_nodes SET status='ARCHIVED', archived_by=?, archived_at=?, updated_by=? WHERE source_id=? AND document_id=?", [fixtureIdentity.id, now, fixtureIdentity.id, fixture.source.id, document.documentId]);

    const preview = await previewExisting(fixture.source.id, path, new TextEncoder().encode("# Restored\n\nbody\n"));
    const change = preview.changes.find((item) => item.kind === "DOCUMENT" && item.sourcePath === path);
    expect(change?.labels).toContain("RESTORED");
    const plan = (await pool.query<{ plan: unknown }[]>("SELECT plan FROM source_import_snapshots WHERE source_id=? ORDER BY created_at DESC LIMIT 1", [fixture.source.id]))[0].plan;
    const parsed = typeof plan === "string" ? JSON.parse(plan) : plan as { documents: { restore: { entryId: string; documentId: string }[] } };
    expect(parsed.documents.restore).toEqual(expect.arrayContaining([expect.objectContaining({ entryId: entry.entryId, documentId: document.documentId })]));
  });

  it("converts duplicate canonical SourceEntry paths into a blocking READY Preview without guessing identity", async () => {    const fixture = await createSourceFixture(pool, { managed: true });
    const first = await createDocumentForAnySource(pool, fixture.source.id, fixture.folderId);
    const second = await createDocumentForAnySource(pool, fixture.source.id, fixture.folderId);
    const firstEntry = await createEntryFixture(pool, fixture.source.id, first.documentId, "first");
    const secondEntry = await createEntryFixture(pool, fixture.source.id, second.documentId, "second");
    await pool.query("UPDATE source_entries SET source_path='docs/conflict.md', external_id=NULL WHERE id IN (?,?)", [firstEntry.entryId, secondEntry.entryId]);

    const preview = await previewExisting(fixture.source.id, "docs/new.md", new TextEncoder().encode("# New\n"));
    expect(preview.state).toBe("READY");
    expect(preview.hasBlockers).toBe(true);
    expect(preview.changes.flatMap((change) => change.diagnostics).map((diagnostic) => diagnostic.code)).toContain("CANONICAL_SOURCE_PATH_CONFLICT");
    expect(preview.summary.changed).toBe(false);
  });

  it("surfaces a blank folder name as a READY blocker with its sourcePath instead of failing Apply", async () => {
    const fixture = await createSourceFixture(pool);
    const bytes = new TextEncoder().encode("# Title\n");
    const { create, upload, finalize, apply } = services();
    const session = await create.createInitial(fixtureCaller(), {
      workspaceId: fixture.workspaceId,
      sourceName: "Blank Folder",
      rootName: "wiki",
      manifest: [markdown("m1", " /a.md", bytes)],
    });
    await upload.upload(fixtureCaller(), { snapshotId: session.snapshotId, entries: [{ uploadKey: "m1", bytes }] });
    const preview = await finalize.finalize(fixtureCaller(), session.snapshotId);
    expect(preview.state).toBe("READY");
    expect(preview.hasBlockers).toBe(true);
    const blocker = preview.changes.flatMap((change) => change.diagnostics).find((diagnostic) => diagnostic.code === "INVALID_FOLDER_NAME");
    expect(blocker?.severity).toBe("BLOCKING");
    expect(blocker?.sourcePath).toBe(" ");

    await expect(apply.apply(fixtureCaller(), session.snapshotId)).rejects.toMatchObject({ code: "IMPORT_SNAPSHOT_BLOCKED" });
    expect(await pool.query("SELECT id FROM knowledge_sources WHERE workspace_id=? AND source_type='FOLDER_SYNC'", [fixture.workspaceId])).toHaveLength(0);
  });
});