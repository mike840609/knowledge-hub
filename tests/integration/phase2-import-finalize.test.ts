import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { CreateFolderImportService, type ImportManifestEntry } from "@/modules/sources/application/create-folder-import";
import { UploadFolderImportEntriesService } from "@/modules/sources/application/upload-folder-import-entries";
import { FinalizeFolderImportService } from "@/modules/sources/application/finalize-folder-import";
import { DEFAULT_IMPORT_LIMITS } from "@/modules/sources/domain/import-limits";
import { createDocumentForAnySource, createEntryFixture, createSourceFixture, fixtureCaller, fixtureIdentity } from "../fixtures/knowledge";
import { uuidv7 } from "@/shared/ids/uuidv7";

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
  };
}

function markdownEntry(uploadKey: string, relativePath: string, bytes: Uint8Array): ImportManifestEntry {
  return { uploadKey, relativePath, kind: "MARKDOWN", size: bytes.byteLength };
}

async function insertReadySnapshot(workspaceId: string): Promise<string> {
  const id = uuidv7();
  const summary = { documents: { added: 0, updated: 0, moved: 0, renamed: 0, archived: 0, restored: 0, unchanged: 0 }, folders: { added: 0, archived: 0, restored: 0 }, assets: { added: 0, updated: 0, removed: 0, unchanged: 0 }, warnings: 0, blockers: 0, affectedDocuments: 0, changed: false };
  const plan = { planVersion: "phase2:v1", sourceBinding: { workspaceId, sourceId: null, basedOnVersion: null }, folders: { create: [], restore: [], archive: [] }, documents: { create: [], restore: [], move: [], revise: [], archive: [], updateLocator: [] }, assets: { upsert: [], remove: [] }, ordering: [], preview: [], summary };
  await pool.query(
    `INSERT INTO source_import_snapshots (id,workspace_id,source_id,based_on_version,created_by,root_name,proposed_source_name,adapter_type,adapter_version,plan_version,state,manifest_hash,snapshot_hash,plan_hash,has_blockers,summary,plan,created_at,finalized_at,expires_at)
     VALUES (?, ?, NULL, NULL, ?, 'wiki', 'Wiki', 'GENERIC_MARKDOWN_FOLDER', 'phase2:v1', 'phase2:v1', 'READY', ?, ?, ?, FALSE, ?, ?, ?, ?, ?)`,
    [id, workspaceId, fixtureIdentity.id, "a".repeat(64), "b".repeat(64), "c".repeat(64), JSON.stringify(summary), JSON.stringify(plan), now, now, new Date(now.getTime() + 30 * 60_000)],
  );
  return id;
}

async function initialSession(files: { uploadKey: string; path: string; bytes: Uint8Array }[]) {
  const fixture = await createSourceFixture(pool);
  const { create, upload, finalize } = services();
  const manifest = files.map((file) => markdownEntry(file.uploadKey, file.path, file.bytes));
  const session = await create.createInitial(fixtureCaller(), { workspaceId: fixture.workspaceId, sourceName: "Imported Wiki", rootName: "wiki", manifest });
  if (files.length > 0) await upload.upload(fixtureCaller(), { snapshotId: session.snapshotId, entries: files.map((file) => ({ uploadKey: file.uploadKey, bytes: file.bytes })) });
  return { fixture, session, finalize };
}

describe("Phase 2 import finalization", () => {
  it("finalizes a valid BUILDING snapshot into immutable READY content and clears raw Markdown", async () => {
    const bytes = new TextEncoder().encode("---\ntitle: Canonical\n---\n# Different\n\nBody\n");
    const { session, finalize } = await initialSession([{ uploadKey: "m1", path: "docs/readme.md", bytes }]);
    const preview = await finalize.finalize(fixtureCaller(), session.snapshotId);
    expect(preview.state).toBe("READY");
    expect(preview.hasBlockers).toBe(false);
    expect(preview.summary.documents.added).toBe(1);
    expect(preview.summary.warnings).toBe(1);
    expect(preview.changes.flatMap((change) => change.diagnostics).map((diagnostic) => diagnostic.code)).toContain("TITLE_CONFLICT");

    const rows = await pool.query<{ raw_markdown: string | null; markdown: string | null; snapshot_hash: string; plan_hash: string; plan: unknown }[]>(
      `SELECT e.raw_markdown,e.markdown,s.snapshot_hash,s.plan_hash,s.plan
       FROM source_import_snapshot_entries e JOIN source_import_snapshots s ON s.id=e.snapshot_id WHERE s.id=?`,
      [session.snapshotId],
    );
    expect(rows[0].raw_markdown).toBeNull();
    expect(rows[0].markdown).toBe("# Different\n\nBody\n");
    expect(rows[0].snapshot_hash).toMatch(/^[a-f0-9]{64}$/u);
    expect(rows[0].plan_hash).toMatch(/^[a-f0-9]{64}$/u);
    expect(rows[0].plan).not.toBeNull();

    const retry = await finalize.finalize(fixtureCaller(), session.snapshotId);
    expect(retry).toEqual(preview);
  });

  it("refuses incomplete Markdown upload and keeps the snapshot BUILDING", async () => {
    const fixture = await createSourceFixture(pool);
    const { create, finalize } = services();
    const bytes = new TextEncoder().encode("# Pending\n");
    const session = await create.createInitial(fixtureCaller(), {
      workspaceId: fixture.workspaceId, sourceName: "Wiki", rootName: "wiki",
      manifest: [markdownEntry("m1", "pending.md", bytes)],
    });
    await expect(finalize.finalize(fixtureCaller(), session.snapshotId)).rejects.toMatchObject({ code: "UPLOAD_INCOMPLETE" });
    expect((await pool.query<{ state: string }[]>("SELECT state FROM source_import_snapshots WHERE id=?", [session.snapshotId]))[0].state).toBe("BUILDING");
  });

  it("turns malformed frontmatter and invalid UTF-8 into READY blockers instead of failing finalization", async () => {
    const malformed = new TextEncoder().encode("---\ntitle: [broken\n---\n# Broken\n");
    const malformedSession = await initialSession([{ uploadKey: "bad", path: "bad.md", bytes: malformed }]);
    const malformedPreview = await malformedSession.finalize.finalize(fixtureCaller(), malformedSession.session.snapshotId);
    expect(malformedPreview.state).toBe("READY");
    expect(malformedPreview.hasBlockers).toBe(true);
    expect(malformedPreview.changes.flatMap((change) => change.diagnostics).map((diagnostic) => diagnostic.code)).toContain("INVALID_FRONTMATTER");

    const fixture = await createSourceFixture(pool);
    const { create, upload, finalize } = services();
    const invalid = new Uint8Array([0xc3, 0x28]);
    const session = await create.createInitial(fixtureCaller(), {
      workspaceId: fixture.workspaceId, sourceName: "Invalid UTF8", rootName: "wiki",
      manifest: [markdownEntry("invalid", "invalid.md", invalid)],
    });
    await upload.upload(fixtureCaller(), { snapshotId: session.snapshotId, entries: [{ uploadKey: "invalid", bytes: invalid }] });
    const utfPreview = await finalize.finalize(fixtureCaller(), session.snapshotId);
    expect(utfPreview.state).toBe("READY");
    expect(utfPreview.hasBlockers).toBe(true);
    expect(utfPreview.changes.flatMap((change) => change.diagnostics).map((diagnostic) => diagnostic.code)).toContain("INVALID_MARKDOWN_ENCODING");
  });

  it("persists normalized path collisions as blockers while keeping every colliding path hash NULL", async () => {
    const left = new TextEncoder().encode("# Left\n");
    const right = new TextEncoder().encode("# Right\n");
    const { session, finalize } = await initialSession([
      { uploadKey: "left", path: "docs//a.md", bytes: left },
      { uploadKey: "right", path: "docs/./a.md", bytes: right },
    ]);
    const preview = await finalize.finalize(fixtureCaller(), session.snapshotId);
    expect(preview.hasBlockers).toBe(true);
    expect(preview.changes.flatMap((change) => change.diagnostics).map((diagnostic) => diagnostic.code)).toContain("PATH_COLLISION");
    const rows = await pool.query<{ source_path: string | null; source_path_hash: string | null }[]>(
      "SELECT source_path,source_path_hash FROM source_import_snapshot_entries WHERE snapshot_id=? ORDER BY upload_key",
      [session.snapshotId],
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.source_path === "docs/a.md" && row.source_path_hash === null)).toBe(true);
  });

  it("omits ignored files from READY content and does not preserve empty directories", async () => {
    const hidden = new TextEncoder().encode("# Hidden\n");
    const visible = new TextEncoder().encode("# Visible\n");
    const { session, finalize } = await initialSession([
      { uploadKey: "hidden", path: ".obsidian/private.md", bytes: hidden },
      { uploadKey: "visible", path: "docs/visible.md", bytes: visible },
    ]);
    const preview = await finalize.finalize(fixtureCaller(), session.snapshotId);
    expect(preview.summary.documents.added).toBe(1);
    expect(preview.changes.some((change) => change.sourcePath.includes(".obsidian"))).toBe(false);
    const rows = await pool.query<{ client_relative_path: string }[]>("SELECT client_relative_path FROM source_import_snapshot_entries WHERE snapshot_id=? ORDER BY client_relative_path", [session.snapshotId]);
    expect(rows.map((row) => row.client_relative_path)).toEqual(["docs/visible.md"]);
    expect(preview.changes.some((change) => change.kind === "FOLDER" && change.sourcePath === "docs")).toBe(true);
  });

  it("reconciles an existing source into rename/update plus archive actions", async () => {
    const fixture = await createSourceFixture(pool, { managed: true });
    const existing = await createDocumentForAnySource(pool, fixture.source.id, fixture.folderId);
    const missing = await createDocumentForAnySource(pool, fixture.source.id, fixture.folderId);
    const existingEntry = await createEntryFixture(pool, fixture.source.id, existing.documentId, "existing");
    await createEntryFixture(pool, fixture.source.id, missing.documentId, "missing");
    await pool.query("UPDATE source_entries SET source_path='docs/old.md', external_id=NULL WHERE id=?", [existingEntry.entryId]);
    await pool.query("UPDATE source_entries SET source_path='docs/missing.md', external_id=NULL WHERE document_id=?", [missing.documentId]);
    await pool.query("UPDATE knowledge_revisions SET title='old', markdown='body', metadata='{}' WHERE id=?", [existing.revisionId]);
    await pool.query("UPDATE knowledge_revisions SET title='missing', markdown='gone', metadata='{}' WHERE id=?", [missing.revisionId]);

    const bytes = new TextEncoder().encode("body");
    const { create, upload, finalize } = services();
    const session = await create.createResync(fixtureCaller(), {
      sourceId: fixture.source.id, rootName: "wiki", manifest: [markdownEntry("m1", "docs/new.md", bytes)],
    });
    await upload.upload(fixtureCaller(), { snapshotId: session.snapshotId, entries: [{ uploadKey: "m1", bytes }] });
    const preview = await finalize.finalize(fixtureCaller(), session.snapshotId);
    const renamed = preview.changes.find((change) => change.sourcePath === "docs/new.md");
    expect(renamed?.previousPath).toBe("docs/old.md");
    expect(renamed?.labels).toEqual(expect.arrayContaining(["RENAMED", "UPDATED"]));
    expect(preview.changes.find((change) => change.sourcePath === "docs/missing.md")?.labels).toContain("ARCHIVED");
  });

  it("refuses to finalize beyond the READY quota and keeps overflow snapshots BUILDING", async () => {
    const fixture = await createSourceFixture(pool);
    const { create, upload, finalize } = services();
    for (let index = 0; index < 9; index += 1) await insertReadySnapshot(fixture.workspaceId);
    const snapshotIds: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      const bytes = new TextEncoder().encode(`# Quota ${index}\n\nbody ${index}\n`);
      const session = await create.createInitial(fixtureCaller(), {
        workspaceId: fixture.workspaceId, sourceName: `Quota ${index}`, rootName: "wiki",
        manifest: [markdownEntry(`q${index}`, `quota${index}.md`, bytes)],
      });
      await upload.upload(fixtureCaller(), { snapshotId: session.snapshotId, entries: [{ uploadKey: `q${index}`, bytes }] });
      snapshotIds.push(session.snapshotId);
    }
    const first = await finalize.finalize(fixtureCaller(), snapshotIds[0]);
    expect(first.state).toBe("READY");
    await expect(finalize.finalize(fixtureCaller(), snapshotIds[1])).rejects.toMatchObject({ code: "IMPORT_READY_QUOTA_EXCEEDED" });
    await expect(finalize.finalize(fixtureCaller(), snapshotIds[2])).rejects.toMatchObject({ code: "IMPORT_READY_QUOTA_EXCEEDED" });
    const states = await pool.query<{ id: string; state: string }[]>("SELECT id,state FROM source_import_snapshots WHERE created_by=? ORDER BY created_at", [fixtureIdentity.id]);
    expect(states.filter((row) => row.state === "READY")).toHaveLength(10);
    expect(states.filter((row) => row.state === "BUILDING").map((row) => row.id).sort()).toEqual([snapshotIds[1], snapshotIds[2]].sort());
  });

  it("turns an overlong resolved title into a READY blocker without failing finalization", async () => {
    const bad = new TextEncoder().encode(`# ${"a".repeat(513)}\n\nbody\n`);
    const good = new TextEncoder().encode("# Good\n\nbody\n");
    const { session, finalize } = await initialSession([
      { uploadKey: "bad", path: "bad.md", bytes: bad },
      { uploadKey: "good", path: "good.md", bytes: good },
    ]);
    const preview = await finalize.finalize(fixtureCaller(), session.snapshotId);
    expect(preview.state).toBe("READY");
    expect(preview.hasBlockers).toBe(true);
    expect(preview.changes.flatMap((change) => change.diagnostics).map((diagnostic) => diagnostic.code)).toContain("TITLE_TOO_LONG");
    expect(preview.summary.documents.added).toBe(1);
    const rows = await pool.query<{ client_relative_path: string; resolved_title: string | null }[]>(
      "SELECT client_relative_path,resolved_title FROM source_import_snapshot_entries WHERE snapshot_id=? ORDER BY client_relative_path",
      [session.snapshotId],
    );
    expect(rows).toEqual([
      { client_relative_path: "bad.md", resolved_title: null },
      { client_relative_path: "good.md", resolved_title: "Good" },
    ]);
  });
});