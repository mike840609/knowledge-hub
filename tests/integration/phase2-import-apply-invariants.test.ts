import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { CreateFolderImportService, type ImportManifestEntry } from "@/modules/sources/application/create-folder-import";
import { UploadFolderImportEntriesService } from "@/modules/sources/application/upload-folder-import-entries";
import { FinalizeFolderImportService } from "@/modules/sources/application/finalize-folder-import";
import { ApplyFolderImportService } from "@/modules/sources/application/apply-folder-import";
import type { ImportApplyFailurePoint } from "@/modules/sources/application/source-import-plan-executor";
import { DEFAULT_IMPORT_LIMITS } from "@/modules/sources/domain/import-limits";
import { createSourceFixture, fixtureCaller } from "../fixtures/knowledge";

let pool: Pool;
const now = new Date("2026-09-13T09:00:00.000Z");
const clock = () => new Date(now);

beforeAll(() => { pool = createDatabasePool(databaseConfig("test")); });
afterAll(async () => { await pool.end(); });
beforeEach(async () => {
  await pool.query("DELETE FROM source_import_snapshot_entries");
  await pool.query("DELETE FROM source_import_snapshots");
});

type SourceFile = { path: string; text: string };

function services(failurePoint?: ImportApplyFailurePoint) {
  const uow = new MariaDbUnitOfWork(pool);
  return {
    create: new CreateFolderImportService(uow, { limits: DEFAULT_IMPORT_LIMITS, now: clock }),
    upload: new UploadFolderImportEntriesService(uow, { limits: DEFAULT_IMPORT_LIMITS, now: clock }),
    finalize: new FinalizeFolderImportService(uow, { limits: DEFAULT_IMPORT_LIMITS, now: clock }),
    apply: new ApplyFolderImportService(uow, { now: clock, failurePoint }),
  };
}

function manifestOf(files: SourceFile[]) {
  return files.map((file, index) => {
    const bytes = new TextEncoder().encode(file.text);
    return {
      manifest: { uploadKey: `f${index}`, relativePath: file.path, kind: "MARKDOWN", size: bytes.byteLength } as ImportManifestEntry,
      bytes,
    };
  });
}

async function readyInitial(workspaceId: string, files: SourceFile[]): Promise<string> {
  const { create, upload, finalize } = services();
  const entries = manifestOf(files);
  const session = await create.createInitial(fixtureCaller(), {
    workspaceId, sourceName: "Imported Wiki", rootName: "wiki", manifest: entries.map((entry) => entry.manifest),
  });
  await upload.upload(fixtureCaller(), { snapshotId: session.snapshotId, entries: entries.map((entry, index) => ({ uploadKey: `f${index}`, bytes: entry.bytes })) });
  await finalize.finalize(fixtureCaller(), session.snapshotId);
  return session.snapshotId;
}

async function readyResync(sourceId: string, files: SourceFile[]): Promise<string> {
  const { create, upload, finalize } = services();
  const entries = manifestOf(files);
  const session = await create.createResync(fixtureCaller(), { sourceId, rootName: "wiki", manifest: entries.map((entry) => entry.manifest) });
  await upload.upload(fixtureCaller(), { snapshotId: session.snapshotId, entries: entries.map((entry, index) => ({ uploadKey: `f${index}`, bytes: entry.bytes })) });
  await finalize.finalize(fixtureCaller(), session.snapshotId);
  return session.snapshotId;
}

async function importSource(workspaceId: string, files: SourceFile[]): Promise<string> {
  const snapshotId = await readyInitial(workspaceId, files);
  const result = await services().apply.apply(fixtureCaller(), snapshotId);
  if (result.kind !== "APPLIED") throw new Error("expected an APPLIED initial import");
  return result.sourceId;
}

async function resyncSource(sourceId: string, files: SourceFile[]): Promise<void> {
  const snapshotId = await readyResync(sourceId, files);
  const result = await services().apply.apply(fixtureCaller(), snapshotId);
  if (result.kind !== "APPLIED") throw new Error("expected an APPLIED resync");
}

type SiblingRow = { id: string; position: number; status: string; label: string };

/** Every node in one sibling group, ACTIVE and ARCHIVED alike, in `ORDER BY position, id`. */
async function siblingGroup(sourceId: string, parentId: string | null): Promise<SiblingRow[]> {
  const rows = await pool.query<{ id: string; position: unknown; status: string; name: string | null; source_path: string | null }[]>(
    `SELECT n.id, n.position, n.status, n.name, e.source_path
       FROM knowledge_tree_nodes n
       LEFT JOIN source_entries e ON e.tree_node_id = n.id
      WHERE n.source_id = ? AND ${parentId === null ? "n.parent_id IS NULL" : "n.parent_id = ?"}
      ORDER BY n.position, n.id`,
    parentId === null ? [sourceId] : [sourceId, parentId],
  );
  return rows.map((row) => ({ id: row.id, position: Number(row.position), status: row.status, label: row.source_path ?? row.name ?? row.id }));
}

/**
 * Phase 1's tree invariant (tree-rules.ts §8 / tree-transaction.renumberSiblingPositions):
 * one sibling group is numbered 0..n-1 over ALL siblings, whatever their status.
 */
function expectContiguousSiblings(group: SiblingRow[]): void {
  expect(group.map((row) => `${row.label}@${row.position}`)).toEqual(
    group.map((row, index) => `${row.label}@${index}`),
  );
}

async function folderNodeId(sourceId: string, sourcePath: string): Promise<string> {
  const rows = await pool.query<{ tree_node_id: string }[]>(
    "SELECT tree_node_id FROM source_entries WHERE source_id=? AND source_path=? AND entry_type='FOLDER'",
    [sourceId, sourcePath],
  );
  if (!rows[0]) throw new Error(`no folder entry for ${sourcePath}`);
  return rows[0].tree_node_id;
}

function parseSummary(value: unknown): Record<string, unknown> {
  return (typeof value === "string" ? JSON.parse(value) : value) as Record<string, unknown>;
}

async function runSummary(sourceId: string, status: "APPLIED" | "FAILED"): Promise<Record<string, unknown>[]> {
  const rows = await pool.query<{ summary: unknown }[]>(
    "SELECT summary FROM sync_runs WHERE source_id=? AND status=? ORDER BY started_at, id",
    [sourceId, status],
  );
  return rows.map((row) => parseSummary(row.summary));
}

async function snapshotHashes(snapshotId: string): Promise<{ snapshotHash: string; planHash: string }> {
  const row = (await pool.query<{ snapshot_hash: string; plan_hash: string }[]>(
    "SELECT snapshot_hash, plan_hash FROM source_import_snapshots WHERE id=?", [snapshotId],
  ))[0];
  return { snapshotHash: row.snapshot_hash, planHash: row.plan_hash };
}

describe("Phase 2 Apply keeps Phase 1 contiguous sibling positions (design §23)", () => {
  it("renumbers the sibling group when a document is archived out of it", async () => {
    const fixture = await createSourceFixture(pool);
    const sourceId = await importSource(fixture.workspaceId, [
      { path: "docs/a.md", text: "# A\n\nbody a\n" },
      { path: "docs/b.md", text: "# B\n\nbody b\n" },
    ]);
    const docsId = await folderNodeId(sourceId, "docs");
    expect((await siblingGroup(sourceId, docsId)).map((row) => [row.label, row.position, row.status])).toEqual([
      ["docs/a.md", 0, "ACTIVE"],
      ["docs/b.md", 1, "ACTIVE"],
    ]);

    await resyncSource(sourceId, [{ path: "docs/b.md", text: "# B\n\nbody b\n" }]);

    const group = await siblingGroup(sourceId, docsId);
    expect(group).toHaveLength(2);
    expect(group.filter((row) => row.status === "ARCHIVED").map((row) => row.label)).toEqual(["docs/a.md"]);
    expectContiguousSiblings(group);
    // No two siblings may share a position.
    expect(new Set(group.map((row) => row.position)).size).toBe(group.length);

    // A further no-op resync must be a fixed point: `placeNodeAtIndex` reads
    // this group on every later sync, so renumbering may not oscillate.
    await resyncSource(sourceId, [{ path: "docs/b.md", text: "# B\n\nbody b\n" }]);
    expect(await siblingGroup(sourceId, docsId)).toEqual(group);
  });

  it("renumbers both the old and the new sibling group when a document moves between parents", async () => {
    const fixture = await createSourceFixture(pool);
    const sourceId = await importSource(fixture.workspaceId, [
      { path: "one/a.md", text: "# A\n\nbody a\n" },
      { path: "one/b.md", text: "# B\n\nbody b\n" },
      { path: "two/c.md", text: "# C\n\nbody c\n" },
      { path: "two/d.md", text: "# D\n\nbody d\n" },
    ]);
    const oneId = await folderNodeId(sourceId, "one");
    const twoId = await folderNodeId(sourceId, "two");

    // `one/a.md` disappears while `two/c.md` moves into `one` with unchanged content.
    await resyncSource(sourceId, [
      { path: "one/b.md", text: "# B\n\nbody b\n" },
      { path: "one/c.md", text: "# C\n\nbody c\n" },
      { path: "two/d.md", text: "# D\n\nbody d\n" },
    ]);

    const one = await siblingGroup(sourceId, oneId);
    const two = await siblingGroup(sourceId, twoId);
    expectContiguousSiblings(one);
    expectContiguousSiblings(two);
    expectContiguousSiblings(await siblingGroup(sourceId, null));
    expect(one.filter((row) => row.status === "ACTIVE").map((row) => row.label)).toEqual(["one/b.md", "one/c.md"]);
    expect(two.filter((row) => row.status === "ACTIVE").map((row) => row.label)).toEqual(["two/d.md"]);
  });

  it("renumbers the root group when an obsolete folder is archived in the middle of it", async () => {
    const fixture = await createSourceFixture(pool);
    const sourceId = await importSource(fixture.workspaceId, [
      { path: "alpha/a.md", text: "# A\n\nbody a\n" },
      { path: "beta/b.md", text: "# B\n\nbody b\n" },
      { path: "gamma/c.md", text: "# C\n\nbody c\n" },
    ]);
    expect((await siblingGroup(sourceId, null)).map((row) => [row.label, row.position])).toEqual([
      ["alpha", 0], ["beta", 1], ["gamma", 2],
    ]);

    // Dropping every entry under `alpha` archives the folder, which used to keep position 0.
    await resyncSource(sourceId, [
      { path: "beta/b.md", text: "# B\n\nbody b\n" },
      { path: "gamma/c.md", text: "# C\n\nbody c\n" },
    ]);

    const root = await siblingGroup(sourceId, null);
    expect(root).toHaveLength(3);
    expect(root.filter((row) => row.status === "ARCHIVED").map((row) => row.label)).toEqual(["alpha"]);
    expectContiguousSiblings(root);
    expect(new Set(root.map((row) => row.position)).size).toBe(3);
    // The archived folder's own group stays contiguous too.
    expectContiguousSiblings(await siblingGroup(sourceId, await folderNodeId(sourceId, "alpha")));
  });
});

describe("Phase 2 Apply writes SyncRun provenance and failure codes (design §22, §17.1)", () => {
  it("stores the snapshot id and both integrity hashes on an APPLIED run", async () => {
    const fixture = await createSourceFixture(pool);
    const snapshotId = await readyInitial(fixture.workspaceId, [{ path: "docs/a.md", text: "# A\n\nbody\n" }]);
    const hashes = await snapshotHashes(snapshotId);
    const result = await services().apply.apply(fixtureCaller(), snapshotId);
    if (result.kind !== "APPLIED") throw new Error("expected APPLIED");

    const [summary] = await runSummary(result.sourceId, "APPLIED");
    expect(summary.snapshotId).toBe(snapshotId);
    expect(summary.snapshotHash).toBe(hashes.snapshotHash);
    expect(summary.planHash).toBe(hashes.planHash);
    expect(summary.changed).toBe(true);
    expect(summary.documents).toMatchObject({ added: 1 });
  });

  it("keeps provenance and records SOURCE_VERSION_CONFLICT as a code on the conflicting run", async () => {
    const fixture = await createSourceFixture(pool);
    const sourceId = await importSource(fixture.workspaceId, [{ path: "docs/a.md", text: "# A\n\nbody\n" }]);
    const firstId = await readyResync(sourceId, [{ path: "docs/a.md", text: "# A\n\nfirst\n" }]);
    const secondId = await readyResync(sourceId, [{ path: "docs/a.md", text: "# A\n\nsecond\n" }]);
    const secondHashes = await snapshotHashes(secondId);

    expect(await services().apply.apply(fixtureCaller(), firstId)).toMatchObject({ kind: "APPLIED" });
    expect(await services().apply.apply(fixtureCaller(), secondId)).toMatchObject({ kind: "VERSION_CONFLICT" });

    const failed = await runSummary(sourceId, "FAILED");
    expect(failed).toHaveLength(1);
    expect(failed[0].failureCode).toBe("SOURCE_VERSION_CONFLICT");
    expect(failed[0].snapshotId).toBe(secondId);
    expect(failed[0].snapshotHash).toBe(secondHashes.snapshotHash);
    expect(failed[0].planHash).toBe(secondHashes.planHash);
    expect(failed[0].changed).toBe(true);
  });

  it("records a failure code and never the raw error message on a rolled-back run", async () => {
    const fixture = await createSourceFixture(pool);
    const sourceId = await importSource(fixture.workspaceId, [{ path: "docs/a.md", text: "# A\n\nbody\n" }]);
    const snapshotId = await readyResync(sourceId, [{ path: "docs/a.md", text: "# A\n\nchanged\n" }]);
    const hashes = await snapshotHashes(snapshotId);

    await expect(services("after-assets").apply.apply(fixtureCaller(), snapshotId)).rejects.toMatchObject({ code: "TEST_IMPORT_FAILURE" });

    const failed = await runSummary(sourceId, "FAILED");
    expect(failed).toHaveLength(1);
    expect(failed[0].failureCode).toBe("TEST_IMPORT_FAILURE");
    expect(failed[0].snapshotId).toBe(snapshotId);
    expect(failed[0].snapshotHash).toBe(hashes.snapshotHash);
    expect(failed[0].planHash).toBe(hashes.planHash);
    // §22/§18.4: canonical history stores a code, never driver or plan prose.
    const serialized = JSON.stringify(failed[0]);
    expect(serialized).not.toContain("Injected import failure");
    expect(serialized).not.toMatch(/after-assets/u);
    expect(Object.keys(failed[0])).not.toContain("failure");
  });
});
