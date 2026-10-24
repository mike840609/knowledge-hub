import { beforeAll, afterAll, expect, it } from "vitest";
import type { Pool } from "mariadb";
import {
  provisionIsolatedDatabase,
  disposeIsolatedDatabase,
} from "../../scripts/db/test-database";
import {
  runMigrations,
  type IsolatedDatabaseHandle,
} from "../../scripts/db/migrate";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { createSourceFixture, fixtureCaller } from "../fixtures/knowledge";
import { prepareReadingImport } from "../fixtures/folder-reading";
import { buildApplicationServices } from "@/server/composition";
let pool: Pool,
  handle: IsolatedDatabaseHandle,
  uow: MariaDbUnitOfWork,
  s: ReturnType<typeof buildApplicationServices>,
  workspaceId: string;
beforeAll(async () => {
  handle = await provisionIsolatedDatabase("test");
  pool = createDatabasePool({
    ...databaseConfig("test"),
    database: handle.databaseName,
  });
  await runMigrations(pool);
  uow = new MariaDbUnitOfWork(pool);
  workspaceId = (await createSourceFixture(pool)).workspaceId;
  s = buildApplicationServices(pool);
});
afterAll(async () => {
  await pool?.end();
  if (handle) await disposeIsolatedDatabase(handle);
});
const FIRST_SOURCE_ID = "0199fb00-0000-7000-8000-000000000001";
const SECOND_SOURCE_ID = "0199fb00-0000-7000-8000-000000000002";
const A_OLDER_PREVIEW = "0199fb00-0000-7000-8000-000000000101";
const A_NEWER_LOW_ID = "0199fb00-0000-7000-8000-000000000102";
const A_NEWER_HIGH_ID = "0199fb00-0000-7000-8000-000000000103";
const A_APPLIED_OLD = "0199fb00-0000-7000-8000-000000000104";
const A_APPLIED_NEW = "0199fb00-0000-7000-8000-000000000105";
const B_APPLIED_NEWEST = "0199fb00-0000-7000-8000-000000000201";
const B_LATEST = "0199fb00-0000-7000-8000-000000000202";
const B_APPLIED_OLD = "0199fb00-0000-7000-8000-000000000203";

async function insertBatchSources(): Promise<void> {
  const now = new Date("2026-09-01T00:00:00Z");
  await uow.run(async (r) => {
    for (const [id, name] of [
      [FIRST_SOURCE_ID, "Batch source A"],
      [SECOND_SOURCE_ID, "Batch source B"],
    ] as const) {
      await r.sources.insert({
        id,
        name,
        workspaceId,
        sourceType: "FOLDER_SYNC",
        ownership: "SOURCE_MANAGED",
        status: "ACTIVE",
        syncVersion: 1,
        createdBy: fixtureCaller().identity.id,
        updatedBy: fixtureCaller().identity.id,
        archivedBy: null,
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
      });
    }
  });
}

function insertBatchRun(
  id: string,
  sourceId: string,
  status: "PREVIEWED" | "APPLIED" | "FAILED",
  startedAt: string,
  completedAt: string | null,
): Promise<void> {
  return uow.run((r) =>
    r.syncRuns.insert({
      id,
      sourceId,
      triggeredBy: fixtureCaller().identity.id,
      basedOnVersion: 1,
      resultVersion: status === "APPLIED" ? 2 : null,
      status,
      summary: {},
      startedAt: new Date(startedAt),
      completedAt: completedAt === null ? null : new Date(completedAt),
    }),
  );
}

it("batches the newest run and newest APPLIED run per source without cross-source leakage", async () => {
  await insertBatchSources();
  // Interleaved on purpose: B finishes later than every A run, so a missing
  // PARTITION BY would return B's rows for A.
  await insertBatchRun(A_OLDER_PREVIEW, FIRST_SOURCE_ID, "PREVIEWED", "2026-09-01T10:00:00Z", null);
  await insertBatchRun(A_APPLIED_OLD, FIRST_SOURCE_ID, "APPLIED", "2026-09-01T10:01:00Z", "2026-09-01T10:03:00Z");
  await insertBatchRun(A_APPLIED_NEW, FIRST_SOURCE_ID, "APPLIED", "2026-09-01T10:00:30Z", "2026-09-01T10:04:00Z");
  await insertBatchRun(A_NEWER_LOW_ID, FIRST_SOURCE_ID, "FAILED", "2026-09-01T10:02:00Z", null);
  await insertBatchRun(A_NEWER_HIGH_ID, FIRST_SOURCE_ID, "FAILED", "2026-09-01T10:02:00Z", null);
  await insertBatchRun(B_APPLIED_OLD, SECOND_SOURCE_ID, "APPLIED", "2026-09-01T09:00:00Z", "2026-09-01T10:01:00Z");
  await insertBatchRun(B_APPLIED_NEWEST, SECOND_SOURCE_ID, "APPLIED", "2026-09-01T10:00:00Z", "2026-09-01T10:09:00Z");
  await insertBatchRun(B_LATEST, SECOND_SOURCE_ID, "FAILED", "2026-09-01T10:05:00Z", null);

  const { latest, applied } = await uow.run(async (r) => ({
    latest: await r.syncRuns.listLatestBySourceIds([FIRST_SOURCE_ID, SECOND_SOURCE_ID]),
    applied: await r.syncRuns.listLatestAppliedBySourceIds([FIRST_SOURCE_ID, SECOND_SOURCE_ID]),
  }));

  expect(
    latest.map((run) => [run.sourceId, run.id]).sort((a, b) => a[0].localeCompare(b[0])),
  ).toEqual([
    [FIRST_SOURCE_ID, A_NEWER_HIGH_ID],
    [SECOND_SOURCE_ID, B_LATEST],
  ]);
  expect(
    applied.map((run) => [run.sourceId, run.id]).sort((a, b) => a[0].localeCompare(b[0])),
  ).toEqual([
    [FIRST_SOURCE_ID, A_APPLIED_NEW],
    [SECOND_SOURCE_ID, B_APPLIED_NEWEST],
  ]);
});

it("returns no rows for an empty source-id batch", async () => {
  await expect(uow.run((r) => r.syncRuns.listLatestBySourceIds([]))).resolves.toEqual([]);
  await expect(uow.run((r) => r.syncRuns.listLatestAppliedBySourceIds([]))).resolves.toEqual([]);
});

it("reads durable moved revisions after staging cleanup and rejects a foreign scope", async () => {
  const first = await prepareReadingImport(uow, workspaceId, null, [
    { path: "a.md", text: "---\nknowledge_id: stable\n---\n# Before\nOld" },
  ]);
  const result = await s.imports.apply.apply(fixtureCaller(), first);
  if (result.kind !== "APPLIED") throw Error("fixture");
  const second = await prepareReadingImport(uow, workspaceId, result.sourceId, [
    {
      path: "moved/a.md",
      text: "---\nknowledge_id: stable\n---\n# After\nNew",
    },
  ]);
  const applied = await s.imports.apply.apply(fixtureCaller(), second);
  if (applied.kind !== "APPLIED" || !applied.runId) throw Error("fixture");
  await pool.query(
    "DELETE FROM source_import_snapshot_entries WHERE snapshot_id IN (?,?)",
    [first, second],
  );
  const detail = await s.syncReading.get(
    fixtureCaller(),
    workspaceId,
    result.sourceId,
    applied.runId,
  );
  expect(detail.hasRecordedChanges).toBe(true);
  expect(detail.changes.find((c) => c.kind === "DOCUMENT")!.href).toContain(
    "revision=2",
  );
  expect(
    detail.changes.find((c) => c.kind === "DOCUMENT")!.diff?.lines,
  ).toContainEqual({ kind: "added", text: "New" });
  await expect(
    s.syncReading.get(
      fixtureCaller(),
      "0199f000-0000-7000-8000-000000009999",
      result.sourceId,
      applied.runId,
    ),
  ).rejects.toBeDefined();
  const legacyId = "0199f000-0000-7000-8000-000000009998";
  await uow.run(async (r) =>
    r.syncRuns.insert({
      ...detail.run,
      id: legacyId,
      summary: { documentsUpdated: 2 },
    }),
  );
  expect(
    (
      await s.syncReading.get(
        fixtureCaller(),
        workspaceId,
        result.sourceId,
        legacyId,
      )
    ).hasRecordedChanges,
  ).toBe(false);
  const document = detail.changes.find((c) => c.kind === "DOCUMENT")!;
  await uow.run((r) =>
    r.documents.updateStatus(
      document.documentId!,
      "ARCHIVED",
      fixtureCaller().identity.id,
    ),
  );
  expect(
    (
      await s.syncReading.get(
        fixtureCaller(),
        workspaceId,
        result.sourceId,
        applied.runId,
      )
    ).changes.find((c) => c.kind === "DOCUMENT")!.href,
  ).toContain("includeArchived=true");
  await pool.query("DELETE FROM workspace_memberships WHERE workspace_id=?", [
    workspaceId,
  ]);
  await expect(
    s.syncReading.get(
      fixtureCaller(),
      workspaceId,
      result.sourceId,
      applied.runId,
    ),
  ).rejects.toBeDefined();
});
