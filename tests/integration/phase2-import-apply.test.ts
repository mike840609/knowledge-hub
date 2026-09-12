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
import { createSourceFixture, fixtureCaller } from "../fixtures/knowledge";

let pool: Pool;
const now = new Date("2026-09-12T13:00:00.000Z");
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

function markdown(path: string, bytes: Uint8Array): ImportManifestEntry {
  return { uploadKey: "m1", relativePath: path, kind: "MARKDOWN", size: bytes.byteLength };
}

async function readyInitial(workspaceId: string, path = "docs/readme.md", text = "# Readme\n\nbody\n") {
  const { create, upload, finalize } = services();
  const bytes = new TextEncoder().encode(text);
  const session = await create.createInitial(fixtureCaller(), { workspaceId, sourceName: "Imported Wiki", rootName: "wiki", manifest: [markdown(path, bytes)] });
  await upload.upload(fixtureCaller(), { snapshotId: session.snapshotId, entries: [{ uploadKey: "m1", bytes }] });
  await finalize.finalize(fixtureCaller(), session.snapshotId);
  return session.snapshotId;
}

async function readyResync(sourceId: string, path = "docs/readme.md", text = "# Readme\n\nbody\n") {
  const { create, upload, finalize } = services();
  const bytes = new TextEncoder().encode(text);
  const session = await create.createResync(fixtureCaller(), { sourceId, rootName: "wiki", manifest: [markdown(path, bytes)] });
  await upload.upload(fixtureCaller(), { snapshotId: session.snapshotId, entries: [{ uploadKey: "m1", bytes }] });
  await finalize.finalize(fixtureCaller(), session.snapshotId);
  return session.snapshotId;
}

async function readyResyncFiles(sourceId: string, files: { path: string; text: string }[]) {
  const { create, upload, finalize } = services();
  const manifest = files.map((file, index) => {
    const bytes = new TextEncoder().encode(file.text);
    return { manifest: { uploadKey: `f${index}`, relativePath: file.path, kind: "MARKDOWN", size: bytes.byteLength } as ImportManifestEntry, bytes };
  });
  const session = await create.createResync(fixtureCaller(), { sourceId, rootName: "wiki", manifest: manifest.map((entry) => entry.manifest) });
  await upload.upload(fixtureCaller(), { snapshotId: session.snapshotId, entries: manifest.map((entry, index) => ({ uploadKey: `f${index}`, bytes: entry.bytes })) });
  const preview = await finalize.finalize(fixtureCaller(), session.snapshotId);
  return { snapshotId: session.snapshotId, preview };
}

async function readyInitialFiles(workspaceId: string, files: { path: string; text: string }[]) {
  const { create, upload, finalize, apply } = services();
  const manifest = files.map((file, index) => {
    const bytes = new TextEncoder().encode(file.text);
    return { manifest: { uploadKey: `f${index}`, relativePath: file.path, kind: "MARKDOWN", size: bytes.byteLength } as ImportManifestEntry, bytes };
  });
  const session = await create.createInitial(fixtureCaller(), { workspaceId, sourceName: "Imported Wiki", rootName: "wiki", manifest: manifest.map((entry) => entry.manifest) });
  await upload.upload(fixtureCaller(), { snapshotId: session.snapshotId, entries: manifest.map((entry, index) => ({ uploadKey: `f${index}`, bytes: entry.bytes })) });
  await finalize.finalize(fixtureCaller(), session.snapshotId);
  const result = await apply.apply(fixtureCaller(), session.snapshotId);
  if (result.kind !== "APPLIED") throw new Error("expected initial APPLIED");
  return result.sourceId;
}

describe("Phase 2 folder import Apply", () => {
  it("creates an initial SOURCE_MANAGED Source atomically at version 1 with one APPLIED SyncRun", async () => {
    const fixture = await createSourceFixture(pool);
    const snapshotId = await readyInitial(fixture.workspaceId);
    const result = await services().apply.apply(fixtureCaller(), snapshotId);
    expect(result).toMatchObject({ kind: "APPLIED", resultVersion: 1, alreadyApplied: false });
    if (result.kind !== "APPLIED") throw new Error("expected APPLIED");

    const source = (await pool.query<{ source_type:string; ownership:string; sync_version:number }[]>("SELECT source_type,ownership,sync_version FROM knowledge_sources WHERE id=?", [result.sourceId]))[0];
    expect(source).toEqual({ source_type: "FOLDER_SYNC", ownership: "SOURCE_MANAGED", sync_version: 1 });
    expect(await pool.query("SELECT id FROM knowledge_documents WHERE source_id=?", [result.sourceId])).toHaveLength(1);
    expect(await pool.query("SELECT id FROM sync_runs WHERE source_id=? AND status='APPLIED'", [result.sourceId])).toHaveLength(1);
    expect((await pool.query<{ state:string; result_source_id:string; result_version:number }[]>("SELECT state,result_source_id,result_version FROM source_import_snapshots WHERE id=?", [snapshotId]))[0]).toEqual({ state:"APPLIED", result_source_id:result.sourceId, result_version:1 });
  });

  it("returns idempotent success for a second Apply without another version increment or SyncRun", async () => {
    const fixture = await createSourceFixture(pool);
    const snapshotId = await readyInitial(fixture.workspaceId);
    const first = await services().apply.apply(fixtureCaller(), snapshotId);
    const second = await services().apply.apply(fixtureCaller(), snapshotId);
    expect(second).toMatchObject({ kind:"APPLIED", alreadyApplied:true, resultVersion:1, runId:null });
    if (first.kind !== "APPLIED") throw new Error("expected APPLIED");
    expect(await pool.query("SELECT id FROM sync_runs WHERE source_id=?", [first.sourceId])).toHaveLength(1);
    expect((await pool.query<{ sync_version:number }[]>("SELECT sync_version FROM knowledge_sources WHERE id=?", [first.sourceId]))[0].sync_version).toBe(1);
  });

  it("advances a no-op resync exactly once without creating another Revision", async () => {
    const fixture = await createSourceFixture(pool);
    const initialId = await readyInitial(fixture.workspaceId);
    const initial = await services().apply.apply(fixtureCaller(), initialId);
    if (initial.kind !== "APPLIED") throw new Error("expected APPLIED");
    const before = Number((await pool.query<{ count:unknown }[]>("SELECT COUNT(*) AS count FROM knowledge_revisions r JOIN knowledge_documents d ON d.id=r.document_id WHERE d.source_id=?", [initial.sourceId]))[0].count);

    const resyncId = await readyResync(initial.sourceId);
    const resync = await services().apply.apply(fixtureCaller(), resyncId);
    expect(resync).toMatchObject({ kind:"APPLIED", resultVersion:2, alreadyApplied:false });
    const after = Number((await pool.query<{ count:unknown }[]>("SELECT COUNT(*) AS count FROM knowledge_revisions r JOIN knowledge_documents d ON d.id=r.document_id WHERE d.source_id=?", [initial.sourceId]))[0].count);
    expect(after).toBe(before);
    expect(await pool.query("SELECT id FROM sync_runs WHERE source_id=? AND status='APPLIED'", [initial.sourceId])).toHaveLength(2);
  });

  it("marks a stale competing Preview and records FAILED without mutating Knowledge", async () => {
    const fixture = await createSourceFixture(pool);
    const initialId = await readyInitial(fixture.workspaceId);
    const initial = await services().apply.apply(fixtureCaller(), initialId);
    if (initial.kind !== "APPLIED") throw new Error("expected APPLIED");

    const firstId = await readyResync(initial.sourceId, "docs/readme.md", "# Readme\n\nfirst\n");
    const secondId = await readyResync(initial.sourceId, "docs/readme.md", "# Readme\n\nsecond\n");
    const first = await services().apply.apply(fixtureCaller(), firstId);
    expect(first).toMatchObject({ kind:"APPLIED", resultVersion:2 });
    const revisionCount = Number((await pool.query<{ count:unknown }[]>("SELECT COUNT(*) AS count FROM knowledge_revisions r JOIN knowledge_documents d ON d.id=r.document_id WHERE d.source_id=?", [initial.sourceId]))[0].count);

    const second = await services().apply.apply(fixtureCaller(), secondId);
    expect(second).toMatchObject({ kind:"VERSION_CONFLICT", sourceId:initial.sourceId, currentVersion:2 });
    expect((await pool.query<{ state:string }[]>("SELECT state FROM source_import_snapshots WHERE id=?", [secondId]))[0].state).toBe("STALE");
    expect(Number((await pool.query<{ count:unknown }[]>("SELECT COUNT(*) AS count FROM knowledge_revisions r JOIN knowledge_documents d ON d.id=r.document_id WHERE d.source_id=?", [initial.sourceId]))[0].count)).toBe(revisionCount);
    expect(await pool.query("SELECT id FROM sync_runs WHERE source_id=? AND status='FAILED'", [initial.sourceId])).toHaveLength(1);
  });

  it("applies RESTORED+MOVED when the old parent folder is archived", async () => {
    const fixture = await createSourceFixture(pool);
    const movedBody = "# Archived Move\n\nsame body\n";
    const sourceId = await readyInitialFiles(fixture.workspaceId, [
      { path: "old/a.md", text: movedBody },
      { path: "keep.md", text: "# Keep\n\nkeep body\n" },
    ]);
    const before = (await pool.query<{ id: string }[]>("SELECT id FROM knowledge_documents WHERE source_id=?", [sourceId]));
    expect(before).toHaveLength(2);
    const movedDocumentId = String((await pool.query<{ document_id: string }[]>(
      "SELECT e.document_id FROM source_entries e WHERE e.source_id=? AND e.source_path=?", [sourceId, "old/a.md"],
    ))[0].document_id);

    const archived = await readyResyncFiles(sourceId, [{ path: "keep.md", text: "# Keep\n\nkeep body\n" }]);
    const archivedApply = await services().apply.apply(fixtureCaller(), archived.snapshotId);
    expect(archivedApply).toMatchObject({ kind: "APPLIED", resultVersion: 2 });
    expect((await pool.query<{ status: string }[]>("SELECT status FROM knowledge_documents WHERE id=?", [movedDocumentId]))[0].status).toBe("ARCHIVED");

    const revived = await readyResyncFiles(sourceId, [
      { path: "new/a.md", text: movedBody },
      { path: "keep.md", text: "# Keep\n\nkeep body\n" },
    ]);
    expect(revived.preview.hasBlockers).toBe(false);
    const movedChange = revived.preview.changes.find((change) => change.sourcePath === "new/a.md");
    expect(movedChange?.labels).toContain("RESTORED");
    expect(movedChange?.labels).toContain("MOVED");

    const result = await services().apply.apply(fixtureCaller(), revived.snapshotId);
    expect(result).toMatchObject({ kind: "APPLIED", resultVersion: 3, alreadyApplied: false });

    expect((await pool.query<{ status: string }[]>("SELECT status FROM knowledge_documents WHERE id=?", [movedDocumentId]))[0].status).toBe("ACTIVE");
    const entry = (await pool.query<{ source_path: string; status: string }[]>("SELECT source_path,status FROM source_entries WHERE source_id=? AND document_id=?", [sourceId, movedDocumentId]))[0];
    expect(entry).toMatchObject({ source_path: "new/a.md", status: "ACTIVE" });
    const node = (await pool.query<{ status: string; parent_id: string | null }[]>("SELECT status,parent_id FROM knowledge_tree_nodes WHERE source_id=? AND document_id=?", [sourceId, movedDocumentId]))[0];
    expect(node.status).toBe("ACTIVE");
    const parent = (await pool.query<{ name: string | null; status: string }[]>("SELECT name,status FROM knowledge_tree_nodes WHERE id=?", [node.parent_id]))[0];
    expect(parent.status).toBe("ACTIVE");
    expect((await pool.query<{ status: string }[]>("SELECT status FROM source_entries WHERE source_id=? AND source_path=?", [sourceId, "old"]))[0].status).toBe("ARCHIVED");
  });

  it("blocks a file replaced by a folder at Preview and refuses Apply without touching canonical state", async () => {
    const fixture = await createSourceFixture(pool);
    const initialId = await readyInitial(fixture.workspaceId, "guide.md", "# Guide\n");
    const initial = await services().apply.apply(fixtureCaller(), initialId);
    if (initial.kind !== "APPLIED") throw new Error("expected APPLIED");

    const replacement = await readyResyncFiles(initial.sourceId, [{ path: "guide.md/child.md", text: "# Child\n" }]);
    expect(replacement.preview.hasBlockers).toBe(true);
    const blocker = replacement.preview.changes.flatMap((change) => change.diagnostics).find((diagnostic) => diagnostic.code === "SOURCE_PATH_TYPE_CONFLICT");
    expect(blocker?.severity).toBe("BLOCKING");
    expect(blocker?.sourcePath).toBe("guide.md");

    await expect(services().apply.apply(fixtureCaller(), replacement.snapshotId)).rejects.toMatchObject({ code: "IMPORT_SNAPSHOT_BLOCKED" });
    expect((await pool.query<{ sync_version: number }[]>("SELECT sync_version FROM knowledge_sources WHERE id=?", [initial.sourceId]))[0].sync_version).toBe(1);
    expect(await pool.query<{ source_path: string; entry_type: string; status: string }[]>(
      "SELECT source_path,entry_type,status FROM source_entries WHERE source_id=? ORDER BY source_path",
      [initial.sourceId],
    )).toEqual([{ source_path: "guide.md", entry_type: "DOCUMENT", status: "ACTIVE" }]);
  });

  it("blocks a folder replaced by a file at Preview and refuses Apply without touching canonical state", async () => {
    const fixture = await createSourceFixture(pool);
    const sourceId = await readyInitialFiles(fixture.workspaceId, [{ path: "guide.md/child.md", text: "# Child\n" }]);

    const replacement = await readyResyncFiles(sourceId, [{ path: "guide.md", text: "# Guide\n" }]);
    expect(replacement.preview.hasBlockers).toBe(true);
    const blocker = replacement.preview.changes.flatMap((change) => change.diagnostics).find((diagnostic) => diagnostic.code === "SOURCE_PATH_TYPE_CONFLICT");
    expect(blocker?.severity).toBe("BLOCKING");
    expect(blocker?.sourcePath).toBe("guide.md");

    await expect(services().apply.apply(fixtureCaller(), replacement.snapshotId)).rejects.toMatchObject({ code: "IMPORT_SNAPSHOT_BLOCKED" });
    expect((await pool.query<{ sync_version: number }[]>("SELECT sync_version FROM knowledge_sources WHERE id=?", [sourceId]))[0].sync_version).toBe(1);
  });

  it("applies a clean second no-op sync after the same content is resubmitted", async () => {
    const fixture = await createSourceFixture(pool);
    const initialId = await readyInitial(fixture.workspaceId, "guide.md", "# Guide\n");
    const initial = await services().apply.apply(fixtureCaller(), initialId);
    if (initial.kind !== "APPLIED") throw new Error("expected APPLIED");

    const resync = await readyResyncFiles(initial.sourceId, [{ path: "guide.md", text: "# Guide\n" }]);
    expect(resync.preview.hasBlockers).toBe(false);
    const result = await services().apply.apply(fixtureCaller(), resync.snapshotId);
    expect(result).toMatchObject({ kind: "APPLIED", resultVersion: 2, alreadyApplied: false });
  });
});