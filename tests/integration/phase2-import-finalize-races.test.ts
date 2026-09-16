import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { CreateFolderImportService, type ImportManifestEntry } from "@/modules/sources/application/create-folder-import";
import { UploadFolderImportEntriesService } from "@/modules/sources/application/upload-folder-import-entries";
import { FinalizeFolderImportService } from "@/modules/sources/application/finalize-folder-import";
import { DEFAULT_IMPORT_LIMITS } from "@/modules/sources/domain/import-limits";
import type { CanonicalImportState } from "@/modules/sources/domain/import-plan";
import type { SourceRepositories, SourceUnitOfWork } from "@/modules/sources/ports/unit-of-work";
import { createSourceFixture, fixtureCaller, fixtureIdentity } from "../fixtures/knowledge";
import { uuidv7 } from "@/shared/ids/uuidv7";

let pool: Pool;
const now = new Date("2026-09-12T14:00:00.000Z");
const clock = () => new Date(now);

beforeAll(() => { pool = createDatabasePool(databaseConfig("test")); });
afterAll(async () => { await pool.end(); });
beforeEach(async () => {
  await pool.query("DELETE FROM source_import_snapshot_entries");
  await pool.query("DELETE FROM source_import_snapshots");
});

function stack(uow?: SourceUnitOfWork) {
  const unit = uow ?? new MariaDbUnitOfWork(pool);
  return {
    create: new CreateFolderImportService(unit, { limits: DEFAULT_IMPORT_LIMITS, now: clock }),
    upload: new UploadFolderImportEntriesService(unit, { limits: DEFAULT_IMPORT_LIMITS, now: clock }),
    finalize: new FinalizeFolderImportService(unit, { limits: DEFAULT_IMPORT_LIMITS, now: clock }),
  };
}

function markdown(uploadKey: string, path: string, bytes: Uint8Array): ImportManifestEntry {
  return { uploadKey, relativePath: path, kind: "MARKDOWN", size: bytes.byteLength };
}

/** Directly plants an active READY row without paying parse cost. */
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

async function buildingInitial(workspaceId: string, name: string, path: string, text: string): Promise<string> {
  const { create, upload } = stack();
  const bytes = new TextEncoder().encode(text);
  const session = await create.createInitial(fixtureCaller(), {
    workspaceId, sourceName: name, rootName: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    manifest: [markdown("m1", path, bytes)],
  });
  await upload.upload(fixtureCaller(), { snapshotId: session.snapshotId, entries: [{ uploadKey: "m1", bytes }] });
  return session.snapshotId;
}

async function buildingResync(sourceId: string, path: string, text: string): Promise<string> {
  const { create, upload } = stack();
  const bytes = new TextEncoder().encode(text);
  const session = await create.createResync(fixtureCaller(), {
    sourceId, rootName: "wiki", manifest: [markdown("m1", path, bytes)],
  });
  await upload.upload(fixtureCaller(), { snapshotId: session.snapshotId, entries: [{ uploadKey: "m1", bytes }] });
  return session.snapshotId;
}

async function snapshotState(snapshotId: string): Promise<string> {
  return (await pool.query<{ state: string }[]>("SELECT state FROM source_import_snapshots WHERE id=?", [snapshotId]))[0].state;
}

/**
 * Advances the Source version at Phase B entry, i.e. after Phase A's plain
 * `run` transaction has committed and before the quota-locked re-verification
 * reads the Source row again. No finalize transaction is open at that point,
 * so the advance never contends with a held FOR UPDATE row lock.
 */
class AdvanceVersionOnPhaseBEntry implements SourceUnitOfWork {
  constructor(private readonly inner: SourceUnitOfWork, private readonly sourceId: string, private readonly basedOnVersion: number) {}

  run<T>(work: (repositories: SourceRepositories) => Promise<T>): Promise<T> {
    return this.inner.run(work);
  }

  async runWithCreatorQuotaLock<T>(creatorId: string, timeoutSeconds: number, work: (repositories: SourceRepositories) => Promise<T>): Promise<T> {
    await this.inner.run((repositories) => repositories.sources.guardAndAdvanceVersion(this.sourceId, this.basedOnVersion, fixtureIdentity.id));
    return this.inner.runWithCreatorQuotaLock(creatorId, timeoutSeconds, work);
  }
}

/** Counts canonical-load() calls to prove quota placement relative to it. */
class CountingCanonicalLoad implements SourceUnitOfWork {
  loadCalls = 0;
  constructor(private readonly inner: SourceUnitOfWork) {}

  private wrap(repositories: SourceRepositories): SourceRepositories {
    const canonical = repositories.importCanonicalState;
    return {
      ...repositories,
      importCanonicalState: {
        load: async (sourceId: string): Promise<CanonicalImportState> => {
          this.loadCalls += 1;
          return canonical.load(sourceId);
        },
      },
    };
  }

  run<T>(work: (repositories: SourceRepositories) => Promise<T>): Promise<T> {
    return this.inner.run((repositories) => work(this.wrap(repositories)));
  }

  runWithCreatorQuotaLock<T>(creatorId: string, timeoutSeconds: number, work: (repositories: SourceRepositories) => Promise<T>): Promise<T> {
    return this.inner.runWithCreatorQuotaLock(creatorId, timeoutSeconds, (repositories) => work(this.wrap(repositories)));
  }
}

/** Fills the READY quota on Phase B entry, after Phase A's advisory check. */
class FillQuotaOnPhaseBEntry implements SourceUnitOfWork {
  constructor(private readonly inner: SourceUnitOfWork, private readonly workspaceId: string, private readonly fill: number) {}

  run<T>(work: (repositories: SourceRepositories) => Promise<T>): Promise<T> {
    return this.inner.run(work);
  }

  async runWithCreatorQuotaLock<T>(creatorId: string, timeoutSeconds: number, work: (repositories: SourceRepositories) => Promise<T>): Promise<T> {
    for (let index = 0; index < this.fill; index += 1) await insertReadySnapshot(this.workspaceId);
    return this.inner.runWithCreatorQuotaLock(creatorId, timeoutSeconds, work);
  }
}

describe("Phase 2 finalize quota-lock split races (issue #9 item 17c)", () => {
  it("serializes a concurrent double-finalize into one READY and one IMPORT_SNAPSHOT_STATE_CONFLICT", async () => {
    const fixture = await createSourceFixture(pool);
    const snapshotId = await buildingInitial(fixture.workspaceId, "Double", "double.md", "# Double\n");
    const first = stack().finalize.finalize(fixtureCaller(), snapshotId);
    const second = stack().finalize.finalize(fixtureCaller(), snapshotId);
    const outcomes = await Promise.allSettled([first, second]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.filter((outcome) => outcome.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ code: "IMPORT_SNAPSHOT_STATE_CONFLICT" });
    expect(await snapshotState(snapshotId)).toBe("READY");
  });

  it("rejects with SOURCE_VERSION_CONFLICT when the Source advances between Phase A and Phase B", async () => {
    const fixture = await createSourceFixture(pool, { managed: true });
    const snapshotId = await buildingResync(fixture.source.id, "docs/drifted.md", "# Drifted\n\nbody\n");
    const basedOn = Number((await pool.query<{ based_on_version: number }[]>("SELECT based_on_version FROM source_import_snapshots WHERE id=?", [snapshotId]))[0].based_on_version);
    // Phase A must run to completion (canonical load included) before the
    // writer lands; only the Phase B re-check may report the conflict.
    const counting = new CountingCanonicalLoad(new MariaDbUnitOfWork(pool));
    const unit = new AdvanceVersionOnPhaseBEntry(counting, fixture.source.id, basedOn);
    await expect(stack(unit).finalize.finalize(fixtureCaller(), snapshotId)).rejects.toMatchObject({
      code: "SOURCE_VERSION_CONFLICT",
      details: { snapshotVersion: basedOn, currentVersion: basedOn + 1 },
    });
    expect(counting.loadCalls).toBe(1);
    expect(await snapshotState(snapshotId)).toBe("BUILDING");
  });

  it("throws IMPORT_READY_QUOTA_EXCEEDED before the canonical load for an over-quota resync", async () => {
    const fixture = await createSourceFixture(pool, { managed: true });
    const snapshotId = await buildingResync(fixture.source.id, "docs/steady.md", "# Steady\n\nbody\n");
    for (let index = 0; index < DEFAULT_IMPORT_LIMITS.maxReadySnapshotsPerUser; index += 1) {
      await insertReadySnapshot(fixture.workspaceId);
    }
    const unit = new CountingCanonicalLoad(new MariaDbUnitOfWork(pool));
    await expect(stack(unit).finalize.finalize(fixtureCaller(), snapshotId)).rejects.toMatchObject({ code: "IMPORT_READY_QUOTA_EXCEEDED" });
    expect(unit.loadCalls).toBe(0);
    expect(await snapshotState(snapshotId)).toBe("BUILDING");
  });

  it("fails Phase B with IMPORT_READY_QUOTA_EXCEEDED when quota fills between the advisory check and the lock", async () => {
    const fixture = await createSourceFixture(pool);
    const room = 1;
    for (let index = 0; index < DEFAULT_IMPORT_LIMITS.maxReadySnapshotsPerUser - room; index += 1) {
      await insertReadySnapshot(fixture.workspaceId);
    }
    const snapshotId = await buildingInitial(fixture.workspaceId, "Late", "late.md", "# Late\n");
    const unit = new FillQuotaOnPhaseBEntry(new MariaDbUnitOfWork(pool), fixture.workspaceId, room);
    await expect(stack(unit).finalize.finalize(fixtureCaller(), snapshotId)).rejects.toMatchObject({ code: "IMPORT_READY_QUOTA_EXCEEDED" });
    expect(await snapshotState(snapshotId)).toBe("BUILDING");
  });

  it("finalizes two concurrent snapshots to READY when both fit under the quota", async () => {
    const fixture = await createSourceFixture(pool);
    for (let index = 0; index < DEFAULT_IMPORT_LIMITS.maxReadySnapshotsPerUser - 2; index += 1) {
      await insertReadySnapshot(fixture.workspaceId);
    }
    const firstId = await buildingInitial(fixture.workspaceId, "First", "first.md", "# First\n");
    const secondId = await buildingInitial(fixture.workspaceId, "Second", "second.md", "# Second\n");
    const service = stack().finalize;
    const [first, second] = await Promise.all([
      service.finalize(fixtureCaller(), firstId),
      service.finalize(fixtureCaller(), secondId),
    ]);
    expect(first.state).toBe("READY");
    expect(second.state).toBe("READY");
    expect(await snapshotState(firstId)).toBe("READY");
    expect(await snapshotState(secondId)).toBe("READY");
  });
});
