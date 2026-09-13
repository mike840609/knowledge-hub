import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { CreateFolderImportService } from "@/modules/sources/application/create-folder-import";
import { UploadFolderImportEntriesService } from "@/modules/sources/application/upload-folder-import-entries";
import { FinalizeFolderImportService } from "@/modules/sources/application/finalize-folder-import";
import { ApplyFolderImportService } from "@/modules/sources/application/apply-folder-import";
import { GetFolderImportPreviewService } from "@/modules/sources/application/get-folder-import-preview";
import { CleanupFolderImportsService } from "@/modules/sources/application/cleanup-folder-imports";
import { DEFAULT_IMPORT_LIMITS } from "@/modules/sources/domain/import-limits";
import { uuidv7 } from "@/shared/ids/uuidv7";
import { createSourceFixture, fixtureCaller, fixtureIdentity, secondFixtureIdentity } from "../fixtures/knowledge";

let pool: Pool;
const now = new Date("2026-09-12T12:00:00.000Z");
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
    preview: new GetFolderImportPreviewService(uow, { now: clock }),
    cleanup: new CleanupFolderImportsService(uow, { now: clock }),
  };
}

const BODY = "creator-private sync body 9f31";

async function readySession() {
  const fixture = await createSourceFixture(pool);
  const { create, upload, finalize } = services();
  const bytes = new TextEncoder().encode(`# Guide\n\n${BODY}\n`);
  const session = await create.createInitial(fixtureCaller(), {
    workspaceId: fixture.workspaceId, sourceName: "Imported Wiki", rootName: "wiki",
    manifest: [{ uploadKey: "m1", relativePath: "docs/guide.md", kind: "MARKDOWN", size: bytes.byteLength }],
  });
  await upload.upload(fixtureCaller(), { snapshotId: session.snapshotId, entries: [{ uploadKey: "m1", bytes }] });
  const preview = await finalize.finalize(fixtureCaller(), session.snapshotId);
  return { fixture, session, preview };
}

describe("Phase 2 creator-private preview reads", () => {
  it("lets the creator member read READY, APPLIED, and STALE previews without leaking staging Markdown", async () => {
    const { fixture, session } = await readySession();
    const { apply, preview } = services();

    const ready = await preview.get(fixtureCaller(), session.snapshotId);
    expect(ready.state).toBe("READY");
    expect(ready.expired).toBe(false);
    expect(ready.workspaceId).toBe(fixture.workspaceId);
    expect(ready.summary.documents.added).toBe(1);
    expect(JSON.stringify(ready.changes)).not.toContain(BODY);
    expect(ready).not.toHaveProperty("rawMarkdown");
    expect(ready).not.toHaveProperty("plan");

    const applied = await apply.apply(fixtureCaller(), session.snapshotId);
    if (applied.kind !== "APPLIED") throw new Error("Expected the initial import to apply.");
    const appliedPreview = await preview.get(fixtureCaller(), session.snapshotId);
    expect(appliedPreview.state).toBe("APPLIED");
    expect(appliedPreview.expired).toBe(false);

    const resyncFixture = await createSourceFixture(pool, { managed: true });
    await pool.query("UPDATE knowledge_sources SET sync_version=7 WHERE id=?", [resyncFixture.source.id]);
    const bytes = new TextEncoder().encode("# Resync\n");
    const resync = await services().create.createResync(fixtureCaller(), {
      sourceId: resyncFixture.source.id, rootName: "wiki",
      manifest: [{ uploadKey: "m1", relativePath: "docs/resync.md", kind: "MARKDOWN", size: bytes.byteLength }],
    });
    await services().upload.upload(fixtureCaller(), { snapshotId: resync.snapshotId, entries: [{ uploadKey: "m1", bytes }] });
    await services().finalize.finalize(fixtureCaller(), resync.snapshotId);
    await pool.query("UPDATE knowledge_sources SET sync_version=8 WHERE id=?", [resyncFixture.source.id]);
    const conflict = await services().apply.apply(fixtureCaller(), resync.snapshotId);
    expect(conflict.kind).toBe("VERSION_CONFLICT");
    const stale = await preview.get(fixtureCaller(), resync.snapshotId);
    expect(stale.state).toBe("STALE");
  });

  it("hides another member's snapshot as not-found", async () => {
    const { session } = await readySession();
    await expect(services().preview.get(fixtureCaller(secondFixtureIdentity), session.snapshotId)).rejects.toMatchObject({
      code: "IMPORT_SNAPSHOT_NOT_FOUND",
    });
    await expect(services().preview.get(fixtureCaller(), uuidv7())).rejects.toMatchObject({ code: "IMPORT_SNAPSHOT_NOT_FOUND" });
  });

  it("denies the creator after workspace membership removal", async () => {
    const { fixture, session } = await readySession();
    await pool.query("DELETE FROM workspace_memberships WHERE workspace_id=? AND user_id=?", [fixture.workspaceId, fixtureIdentity.id]);
    await expect(services().preview.get(fixtureCaller(), session.snapshotId)).rejects.toMatchObject({ code: "WORKSPACE_ACCESS_DENIED" });
  });

  it("derives expiry from expiresAt and rejects BUILDING snapshots without a persisted plan", async () => {
    const { session } = await readySession();
    expect((await services().preview.get(fixtureCaller(), session.snapshotId)).expired).toBe(false);
    await pool.query("UPDATE source_import_snapshots SET expires_at=? WHERE id=?", [new Date(now.getTime() - 1), session.snapshotId]);
    const expired = await services().preview.get(fixtureCaller(), session.snapshotId);
    expect(expired.expired).toBe(true);
    expect(expired.state).toBe("READY");

    const fixture = await createSourceFixture(pool);
    const building = await services().create.createInitial(fixtureCaller(), {
      workspaceId: fixture.workspaceId, sourceName: "Building", rootName: "wiki",
      manifest: [{ uploadKey: "m1", relativePath: "docs/pending.md", kind: "MARKDOWN", size: 8 }],
    });
    await expect(services().preview.get(fixtureCaller(), building.snapshotId)).rejects.toMatchObject({ code: "IMPORT_SNAPSHOT_NOT_READY" });
  });
});

describe("Phase 2 staging cleanup", () => {
  const summary = {
    documents: { added: 0, updated: 0, moved: 0, renamed: 0, archived: 0, restored: 0, unchanged: 0 },
    folders: { added: 0, archived: 0, restored: 0 },
    assets: { added: 0, updated: 0, removed: 0, unchanged: 0 },
    warnings: 0, blockers: 0, affectedDocuments: 0, changed: false,
  };
  const plan = {
    planVersion: "phase2:v1", sourceBinding: { workspaceId: "", sourceId: null, basedOnVersion: null },
    folders: { create: [], restore: [], archive: [] },
    documents: { create: [], restore: [], move: [], revise: [], archive: [], updateLocator: [] },
    assets: { upsert: [], remove: [] }, ordering: [], preview: [], summary,
  };

  async function insertSnapshot(options: {
    state: "BUILDING" | "READY" | "STALE" | "APPLIED";
    workspaceId: string;
    expiresAt: Date;
    finalizedAt?: Date;
    appliedAt?: Date;
    staleAt?: Date;
    resultSourceId?: string;
    resultVersion?: number;
  }): Promise<string> {
    const id = uuidv7();
    const ready = options.state !== "BUILDING";
    await pool.query(
      `INSERT INTO source_import_snapshots (id,workspace_id,source_id,based_on_version,created_by,root_name,proposed_source_name,adapter_type,adapter_version,plan_version,state,manifest_hash,snapshot_hash,plan_hash,has_blockers,summary,plan,created_at,finalized_at,expires_at,applied_at,stale_at,result_source_id,result_version)
       VALUES (?, ?, NULL, NULL, ?, 'wiki', 'Wiki', 'GENERIC_MARKDOWN_FOLDER', 'phase2:v1', 'phase2:v1', ?, ?, ?, ?, FALSE, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, options.workspaceId, fixtureIdentity.id, options.state, "a".repeat(64),
        ready ? "b".repeat(64) : null, ready ? "c".repeat(64) : null,
        ready ? JSON.stringify(summary) : null, ready ? JSON.stringify({ ...plan, sourceBinding: { workspaceId: options.workspaceId, sourceId: null, basedOnVersion: null } }) : null,
        now, options.finalizedAt ?? (ready ? now : null), options.expiresAt,
        options.state === "APPLIED" ? (options.appliedAt ?? now) : null,
        options.state === "STALE" ? (options.staleAt ?? now) : null,
        options.resultSourceId ?? null,
        options.resultVersion ?? null,
      ],
    );
    return id;
  }

  async function insertEntry(snapshotId: string): Promise<void> {
    await pool.query(
      `INSERT INTO source_import_snapshot_entries (id,snapshot_id,upload_key,client_relative_path,source_path,source_path_hash,entry_type,upload_status,declared_size,source_file_hash,raw_markdown,resolved_title,title_source,markdown,metadata,revision_content_hash,reconciliation_fingerprint,mime_type,asset_content_hash,asset_size,asset_last_modified,diagnostics,preview_change)
       VALUES (?, ?, 'm1', 'docs/guide.md', 'docs/guide.md', ?, 'DOCUMENT', 'RECEIVED', 8, ?, NULL, 'Guide', 'H1', '# Guide', '{}', ?, ?, NULL, NULL, NULL, NULL, '[]', NULL)`,
      [uuidv7(), snapshotId, "d".repeat(64), "e".repeat(64), "f".repeat(64), "0".repeat(64)],
    );
  }

  async function canonicalCounts(): Promise<Record<string, number>> {
    const tables = ["knowledge_sources", "knowledge_documents", "knowledge_revisions", "knowledge_tree_nodes", "source_entries", "knowledge_assets", "sync_runs"];
    const counts: Record<string, number> = {};
    for (const table of tables) {
      counts[table] = Number((await pool.query<{ count: unknown }[]>(`SELECT COUNT(*) AS count FROM ${table}`))[0].count);
    }
    return counts;
  }

  it("deletes only eligible staging snapshots with entry cascade and leaves canonical history untouched", async () => {
    const fixture = await createSourceFixture(pool, { managed: true });
    const past = new Date(now.getTime() - 1);
    const future = new Date(now.getTime() + 60_000);
    const old = new Date(now.getTime() - 25 * 3_600_000);

    const expiredBuilding = await insertSnapshot({ state: "BUILDING", workspaceId: fixture.workspaceId, expiresAt: past });
    const expiredReady = await insertSnapshot({ state: "READY", workspaceId: fixture.workspaceId, expiresAt: past, finalizedAt: past });
    const freshReady = await insertSnapshot({ state: "READY", workspaceId: fixture.workspaceId, expiresAt: future, finalizedAt: now });
    const oldStale = await insertSnapshot({ state: "STALE", workspaceId: fixture.workspaceId, expiresAt: future, finalizedAt: old, staleAt: old });
    const recentStale = await insertSnapshot({ state: "STALE", workspaceId: fixture.workspaceId, expiresAt: future, finalizedAt: now, staleAt: now });
    const oldApplied = await insertSnapshot({ state: "APPLIED", workspaceId: fixture.workspaceId, expiresAt: future, finalizedAt: old, appliedAt: old, resultSourceId: fixture.source.id, resultVersion: 1 });
    const recentApplied = await insertSnapshot({ state: "APPLIED", workspaceId: fixture.workspaceId, expiresAt: future, finalizedAt: now, appliedAt: now, resultSourceId: fixture.source.id, resultVersion: 1 });

    await insertEntry(oldApplied);
    await insertEntry(freshReady);

    const before = await canonicalCounts();
    const result = await services().cleanup.cleanup();
    expect(result.deleted).toBe(4);

    const remaining = (await pool.query<{ id: unknown }[]>("SELECT id FROM source_import_snapshots ORDER BY id")).map((row) => String(row.id));
    for (const id of [expiredBuilding, expiredReady, oldStale, oldApplied]) expect(remaining).not.toContain(id);
    for (const id of [freshReady, recentStale, recentApplied]) expect(remaining).toContain(id);

    expect(await pool.query("SELECT id FROM source_import_snapshot_entries WHERE snapshot_id=?", [oldApplied])).toHaveLength(0);
    expect(await pool.query("SELECT id FROM source_import_snapshot_entries WHERE snapshot_id=?", [freshReady])).toHaveLength(1);
    expect(await canonicalCounts()).toEqual(before);
  });
});
