import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { creatorQuotaLockName } from "@/infrastructure/database/mariadb/repositories/import-snapshots";
import { CreateFolderImportService, type ImportManifestEntry } from "@/modules/sources/application/create-folder-import";
import { UploadFolderImportEntriesService } from "@/modules/sources/application/upload-folder-import-entries";
import { FinalizeFolderImportService } from "@/modules/sources/application/finalize-folder-import";
import { ApplyFolderImportService } from "@/modules/sources/application/apply-folder-import";
import { DEFAULT_IMPORT_LIMITS } from "@/modules/sources/domain/import-limits";
import type { ImportApplyFailurePoint } from "@/modules/sources/application/source-import-plan-executor";
import { createSourceFixture, fixtureCaller, fixtureIdentity } from "../fixtures/knowledge";

let pool: Pool;
const now = new Date("2026-09-12T13:30:00.000Z");
const clock = () => new Date(now);

beforeAll(() => { pool = createDatabasePool(databaseConfig("test")); });
afterAll(async () => { await pool.end(); });
beforeEach(async () => {
  await pool.query("DELETE FROM source_import_snapshot_entries");
  await pool.query("DELETE FROM source_import_snapshots");
});

function stack(failurePoint?: ImportApplyFailurePoint) {
  const uow = new MariaDbUnitOfWork(pool);
  return {
    create: new CreateFolderImportService(uow, { limits: DEFAULT_IMPORT_LIMITS, now: clock }),
    upload: new UploadFolderImportEntriesService(uow, { limits: DEFAULT_IMPORT_LIMITS, now: clock }),
    finalize: new FinalizeFolderImportService(uow, { limits: DEFAULT_IMPORT_LIMITS, now: clock }),
    apply: new ApplyFolderImportService(uow, { now: clock, failurePoint }),
  };
}

function markdown(uploadKey: string, path: string, bytes: Uint8Array): ImportManifestEntry {
  return { uploadKey, relativePath: path, kind: "MARKDOWN", size: bytes.byteLength };
}
function asset(uploadKey: string, path: string, hash: string): ImportManifestEntry {
  return { uploadKey, relativePath: path, kind: "ASSET", size: 10, contentHash: hash, mimeType: "image/png", lastModified: now };
}

async function readyInitial(workspaceId: string, path: string, text: string, assetHash?: string): Promise<string> {
  const { create, upload, finalize } = stack();
  const bytes = new TextEncoder().encode(text);
  const manifest: ImportManifestEntry[] = [markdown("m1", path, bytes)];
  if (assetHash) manifest.push(asset("a1", "assets/logo.png", assetHash));
  const session = await create.createInitial(fixtureCaller(), { workspaceId, sourceName: "Imported Wiki", rootName: "wiki", manifest });
  await upload.upload(fixtureCaller(), { snapshotId: session.snapshotId, entries: [{ uploadKey: "m1", bytes }] });
  await finalize.finalize(fixtureCaller(), session.snapshotId);
  return session.snapshotId;
}

async function readyResync(sourceId: string, path: string, text: string, assetHash?: string): Promise<string> {
  const { create, upload, finalize } = stack();
  const bytes = new TextEncoder().encode(text);
  const manifest: ImportManifestEntry[] = [markdown("m1", path, bytes)];
  if (assetHash) manifest.push(asset("a1", "assets/logo.png", assetHash));
  const session = await create.createResync(fixtureCaller(), { sourceId, rootName: "wiki", manifest });
  await upload.upload(fixtureCaller(), { snapshotId: session.snapshotId, entries: [{ uploadKey: "m1", bytes }] });
  await finalize.finalize(fixtureCaller(), session.snapshotId);
  return session.snapshotId;
}

type CommitGate = { armed: boolean; entered: { promise: Promise<void>; resolve: () => void }; release: { promise: Promise<void>; resolve: () => void } };

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((runner) => {
    resolve = runner;
  });
  return { promise, resolve };
}

function commitBarrierPool(inner: Pool, gate: CommitGate): Pool {
  return new Proxy(inner, {
    get(target, property, receiver) {
      if (property === "getConnection") {
        return async () => {
          const connection = await target.getConnection();
          const commit = connection.commit.bind(connection);
          connection.commit = async () => {
            if (gate.armed) {
              gate.entered.resolve();
              await gate.release.promise;
            }
            return commit();
          };
          return connection;
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

async function buildingCount(): Promise<number> {
  return Number((await pool.query<{ count: unknown }[]>(
    "SELECT COUNT(*) AS count FROM source_import_snapshots WHERE created_by=? AND state='BUILDING' AND expires_at>?",
    [fixtureCaller().identity.id, now],
  ))[0].count);
}

async function readyCount(): Promise<number> {
  return Number((await pool.query<{ count: unknown }[]>(
    "SELECT COUNT(*) AS count FROM source_import_snapshots WHERE created_by=? AND state='READY' AND expires_at>?",
    [fixtureCaller().identity.id, now],
  ))[0].count);
}

async function quotaLockHeld(): Promise<boolean> {
  const lockName = creatorQuotaLockName(fixtureCaller().identity.id);
  const connection = await pool.getConnection();
  try {
    const rows = await connection.query<{ acquired: unknown }[]>("SELECT GET_LOCK(?, 0) AS acquired", [lockName]);
    const acquired = Number(rows[0]?.acquired ?? 0);
    if (acquired === 1) await connection.query("SELECT RELEASE_LOCK(?)", [lockName]);
    return acquired === 0;
  } finally {
    connection.release();
  }
}

describe("Phase 2 Apply concurrency and rollback", () => {
  it("serializes parallel double Apply into one mutation and one idempotent result", async () => {
    const fixture = await createSourceFixture(pool);
    const snapshotId = await readyInitial(fixture.workspaceId, "readme.md", "# Readme\n");
    const firstService = stack().apply;
    const secondService = stack().apply;
    const [first, second] = await Promise.all([
      firstService.apply(fixtureCaller(), snapshotId),
      secondService.apply(fixtureCaller(), snapshotId),
    ]);
    expect([first, second].filter((result) => result.kind === "APPLIED" && !result.alreadyApplied)).toHaveLength(1);
    expect([first, second].filter((result) => result.kind === "APPLIED" && result.alreadyApplied)).toHaveLength(1);
    const sourceId = first.kind === "APPLIED" ? first.sourceId : second.kind === "APPLIED" ? second.sourceId : "";
    expect((await pool.query<{ sync_version:number }[]>("SELECT sync_version FROM knowledge_sources WHERE id=?", [sourceId]))[0].sync_version).toBe(1);
    expect(await pool.query("SELECT id FROM sync_runs WHERE source_id=?", [sourceId])).toHaveLength(1);
  });

  it("preserves SourceEntry, Document, and TreeNode identity across filename fallback rename while creating a title Revision", async () => {
    const fixture = await createSourceFixture(pool);
    const initialId = await readyInitial(fixture.workspaceId, "docs/foo.md", "body\n");
    const initial = await stack().apply.apply(fixtureCaller(), initialId);
    if (initial.kind !== "APPLIED") throw new Error("expected APPLIED");
    const before = (await pool.query<{ entry_id:string; document_id:string; tree_node_id:string; revisions:number }[]>(
      `SELECT e.id AS entry_id,e.document_id,e.tree_node_id,(SELECT COUNT(*) FROM knowledge_revisions r WHERE r.document_id=e.document_id) AS revisions
       FROM source_entries e WHERE e.source_id=? AND e.entry_type='DOCUMENT'`, [initial.sourceId]))[0];

    const resyncId = await readyResync(initial.sourceId, "docs/bar.md", "body\n");
    await stack().apply.apply(fixtureCaller(), resyncId);
    const after = (await pool.query<{ entry_id:string; document_id:string; tree_node_id:string; source_path:string; title:string; revisions:number }[]>(
      `SELECT e.id AS entry_id,e.document_id,e.tree_node_id,e.source_path,r.title,(SELECT COUNT(*) FROM knowledge_revisions x WHERE x.document_id=e.document_id) AS revisions
       FROM source_entries e JOIN knowledge_documents d ON d.id=e.document_id JOIN knowledge_revisions r ON r.id=d.current_revision_id
       WHERE e.source_id=? AND e.entry_type='DOCUMENT'`, [initial.sourceId]))[0];
    expect(after).toMatchObject({ entry_id:before.entry_id, document_id:before.document_id, tree_node_id:before.tree_node_id, source_path:"docs/bar.md", title:"bar" });
    expect(Number(after.revisions)).toBe(Number(before.revisions) + 1);
  });

  it("updates an Asset at the same path without replacing its row identity", async () => {
    const fixture = await createSourceFixture(pool);
    const initialId = await readyInitial(fixture.workspaceId, "readme.md", "# Readme\n", "a".repeat(64));
    const initial = await stack().apply.apply(fixtureCaller(), initialId);
    if (initial.kind !== "APPLIED") throw new Error("expected APPLIED");
    const before = (await pool.query<{ id:string }[]>("SELECT id FROM knowledge_assets WHERE source_id=? AND source_path='assets/logo.png'", [initial.sourceId]))[0];
    const resyncId = await readyResync(initial.sourceId, "readme.md", "# Readme\n", "b".repeat(64));
    await stack().apply.apply(fixtureCaller(), resyncId);
    const after = (await pool.query<{ id:string; content_hash:string }[]>("SELECT id,content_hash FROM knowledge_assets WHERE source_id=? AND source_path='assets/logo.png'", [initial.sourceId]))[0];
    expect(after).toEqual({ id:before.id, content_hash:"b".repeat(64) });
  });

  it("rolls back every initial canonical write on injected failure and creates no SyncRun", async () => {
    const fixture = await createSourceFixture(pool);
    const beforeSources = Number((await pool.query<{ count:unknown }[]>("SELECT COUNT(*) AS count FROM knowledge_sources WHERE workspace_id=?", [fixture.workspaceId]))[0].count);
    const snapshotId = await readyInitial(fixture.workspaceId, "docs/readme.md", "# Readme\n");
    await expect(stack("after-documents").apply.apply(fixtureCaller(), snapshotId)).rejects.toMatchObject({ code:"TEST_IMPORT_FAILURE" });
    expect(Number((await pool.query<{ count:unknown }[]>("SELECT COUNT(*) AS count FROM knowledge_sources WHERE workspace_id=?", [fixture.workspaceId]))[0].count)).toBe(beforeSources);
    expect((await pool.query<{ state:string }[]>("SELECT state FROM source_import_snapshots WHERE id=?", [snapshotId]))[0].state).toBe("READY");
  });

  it("rolls back an existing-source failure, keeps READY, and writes one separate FAILED SyncRun", async () => {
    const fixture = await createSourceFixture(pool);
    const initialId = await readyInitial(fixture.workspaceId, "readme.md", "# Readme\nold\n");
    const initial = await stack().apply.apply(fixtureCaller(), initialId);
    if (initial.kind !== "APPLIED") throw new Error("expected APPLIED");
    const snapshotId = await readyResync(initial.sourceId, "readme.md", "# Readme\nnew\n");
    await expect(stack("after-revisions").apply.apply(fixtureCaller(), snapshotId)).rejects.toMatchObject({ code:"TEST_IMPORT_FAILURE" });
    expect((await pool.query<{ sync_version:number }[]>("SELECT sync_version FROM knowledge_sources WHERE id=?", [initial.sourceId]))[0].sync_version).toBe(1);
    expect((await pool.query<{ state:string }[]>("SELECT state FROM source_import_snapshots WHERE id=?", [snapshotId]))[0].state).toBe("READY");
    expect(await pool.query("SELECT id FROM sync_runs WHERE source_id=? AND status='FAILED'", [initial.sourceId])).toHaveLength(1);
    const current = (await pool.query<{ markdown:string }[]>(`SELECT r.markdown FROM knowledge_documents d JOIN knowledge_revisions r ON r.id=d.current_revision_id WHERE d.source_id=?`, [initial.sourceId]))[0];
    expect(current.markdown).toContain("old");
  });

  it("rechecks membership and Source authority after Preview before any canonical mutation", async () => {
    const fixture = await createSourceFixture(pool);
    const initialId = await readyInitial(fixture.workspaceId, "readme.md", "# Readme\n");
    await pool.query("DELETE FROM workspace_memberships WHERE workspace_id=? AND user_id=?", [fixture.workspaceId, fixtureIdentity.id]);
    await expect(stack().apply.apply(fixtureCaller(), initialId)).rejects.toThrow();
    const imported = await pool.query("SELECT id FROM knowledge_sources WHERE workspace_id=? AND source_type='FOLDER_SYNC'", [fixture.workspaceId]);
    expect(imported).toHaveLength(0);

    await pool.query("INSERT INTO workspace_memberships (workspace_id,user_id) VALUES (?,?)", [fixture.workspaceId, fixtureIdentity.id]);
    const goodId = await readyInitial(fixture.workspaceId, "second.md", "# Second\n");
    const good = await stack().apply.apply(fixtureCaller(), goodId);
    if (good.kind !== "APPLIED") throw new Error("expected APPLIED");
    const resyncId = await readyResync(good.sourceId, "second.md", "# Changed\n");
    await pool.query("UPDATE knowledge_sources SET status='ARCHIVED', archived_by=?, archived_at=?, updated_by=? WHERE id=?", [fixtureIdentity.id, now, fixtureIdentity.id, good.sourceId]);
    await expect(stack().apply.apply(fixtureCaller(), resyncId)).rejects.toMatchObject({ code:"SOURCE_IMPORT_NOT_ALLOWED" });
    expect((await pool.query<{ sync_version:number }[]>("SELECT sync_version FROM knowledge_sources WHERE id=?", [good.sourceId]))[0].sync_version).toBe(1);
  });

  it("holds the BUILDING quota lock across commit so a concurrent create cannot use the release window", async () => {
    const fixture = await createSourceFixture(pool);
    const plain = stack();
    const bytes = (name: string) => new TextEncoder().encode(`# ${name}\n`);
    await plain.create.createInitial(fixtureCaller(), {
      workspaceId: fixture.workspaceId, sourceName: "Quota One", rootName: "q1",
      manifest: [markdown("m1", "a.md", bytes("one"))],
    });
    await plain.create.createInitial(fixtureCaller(), {
      workspaceId: fixture.workspaceId, sourceName: "Quota Two", rootName: "q2",
      manifest: [markdown("m1", "b.md", bytes("two"))],
    });

    const gate: CommitGate = { armed: true, entered: deferred(), release: deferred() };
    const gatedCreate = new CreateFolderImportService(new MariaDbUnitOfWork(commitBarrierPool(pool, gate)), {
      limits: DEFAULT_IMPORT_LIMITS, now: clock,
    });
    const third = gatedCreate.createInitial(fixtureCaller(), {
      workspaceId: fixture.workspaceId, sourceName: "Quota Three", rootName: "q3",
      manifest: [markdown("m1", "c.md", bytes("three"))],
    });
    await gate.entered.promise;
    expect(await buildingCount()).toBe(2);
    expect(await quotaLockHeld()).toBe(true);

    gate.armed = false;
    gate.release.resolve();
    await expect(third).resolves.toMatchObject({ state: "BUILDING" });
    expect(await quotaLockHeld()).toBe(false);

    await expect(plain.create.createInitial(fixtureCaller(), {
      workspaceId: fixture.workspaceId, sourceName: "Quota Four", rootName: "q4",
      manifest: [markdown("m1", "d.md", bytes("four"))],
    })).rejects.toMatchObject({ code: "IMPORT_BUILDING_QUOTA_EXCEEDED" });
    expect(await buildingCount()).toBe(3);
  });

  it("holds the READY quota lock across commit so a concurrent finalize cannot use the release window", async () => {
    const fixture = await createSourceFixture(pool);
    const plain = stack();
    for (let index = 0; index < 9; index += 1) {
      const bytes = new TextEncoder().encode(`# Ready ${index}\n`);
      const session = await plain.create.createInitial(fixtureCaller(), {
        workspaceId: fixture.workspaceId, sourceName: `Ready ${index}`, rootName: `ready-${index}`,
        manifest: [markdown("m1", `ready-${index}.md`, bytes)],
      });
      await plain.upload.upload(fixtureCaller(), { snapshotId: session.snapshotId, entries: [{ uploadKey: "m1", bytes }] });
      await plain.finalize.finalize(fixtureCaller(), session.snapshotId);
    }
    expect(await readyCount()).toBe(9);

    const firstBytes = new TextEncoder().encode("# Tenth\n");
    const firstSession = await plain.create.createInitial(fixtureCaller(), {
      workspaceId: fixture.workspaceId, sourceName: "Tenth", rootName: "tenth",
      manifest: [markdown("m1", "tenth.md", firstBytes)],
    });
    await plain.upload.upload(fixtureCaller(), { snapshotId: firstSession.snapshotId, entries: [{ uploadKey: "m1", bytes: firstBytes }] });
    const secondBytes = new TextEncoder().encode("# Eleventh\n");
    const secondSession = await plain.create.createInitial(fixtureCaller(), {
      workspaceId: fixture.workspaceId, sourceName: "Eleventh", rootName: "eleventh",
      manifest: [markdown("m1", "eleventh.md", secondBytes)],
    });
    await plain.upload.upload(fixtureCaller(), { snapshotId: secondSession.snapshotId, entries: [{ uploadKey: "m1", bytes: secondBytes }] });

    const gate: CommitGate = { armed: true, entered: deferred(), release: deferred() };
    const gatedFinalize = new FinalizeFolderImportService(new MariaDbUnitOfWork(commitBarrierPool(pool, gate)), {
      limits: DEFAULT_IMPORT_LIMITS, now: clock,
    });
    const tenth = gatedFinalize.finalize(fixtureCaller(), firstSession.snapshotId);
    await gate.entered.promise;
    expect(await readyCount()).toBe(9);
    expect(await quotaLockHeld()).toBe(true);

    gate.armed = false;
    gate.release.resolve();
    const preview = await tenth;
    expect(preview.hasBlockers).toBe(false);
    expect(await quotaLockHeld()).toBe(false);

    await expect(plain.finalize.finalize(fixtureCaller(), secondSession.snapshotId)).rejects.toMatchObject({ code: "IMPORT_READY_QUOTA_EXCEEDED" });
    expect(await readyCount()).toBe(10);
  });
});