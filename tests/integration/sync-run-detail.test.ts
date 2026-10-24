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
import { contentFingerprint } from "@/modules/knowledge/domain/content";
import { uuidv7 } from "@/shared/ids/uuidv7";
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

type RevisionBatchFixture = {
  workspaceId: string;
  sourceId: string;
  documentId: string;
  beforeRevisionId: string;
  afterRevisionId: string;
  /** A real revision belonging to a different document in the same source. */
  otherDocumentRevisionId: string;
};

/**
 * One document with revision 1 (`before`) and revision 2 (`after`), plus a
 * second document whose revision is used to hit the document-mismatch branch.
 */
async function seedRevisionBatchFixture(): Promise<RevisionBatchFixture> {
  const fixture = await createSourceFixture(pool, { managed: true });
  const actor = fixtureCaller().identity.id;
  const createdAt = new Date("2026-09-02T00:00:00Z");
  const documentId = uuidv7();
  const beforeRevisionId = uuidv7();
  const afterRevisionId = uuidv7();
  const otherDocumentId = uuidv7();
  const otherDocumentRevisionId = uuidv7();
  const before = {
    title: "Before",
    markdown: "# Before\nOld line",
    metadata: {},
  };
  const after = {
    title: "After",
    markdown: "# After\nNew line",
    metadata: {},
  };
  await uow.run(async (r) => {
    await r.documents.insertDraft({
      id: documentId,
      sourceId: fixture.source.id,
      currentRevisionId: null,
      status: "ACTIVE",
      createdBy: actor,
      updatedBy: actor,
      archivedBy: null,
      archivedAt: null,
      createdAt,
      updatedAt: createdAt,
    });
    await r.revisions.insert({
      id: beforeRevisionId,
      documentId,
      revisionNo: 1,
      ...before,
      contentHash: contentFingerprint(before),
      createdBy: actor,
      createdAt,
    });
    await r.revisions.insert({
      id: afterRevisionId,
      documentId,
      revisionNo: 2,
      ...after,
      contentHash: contentFingerprint(after),
      createdBy: actor,
      createdAt,
    });
    await r.documents.setCurrentRevision(documentId, afterRevisionId, actor);
    await r.documents.insertDraft({
      id: otherDocumentId,
      sourceId: fixture.source.id,
      currentRevisionId: null,
      status: "ACTIVE",
      createdBy: actor,
      updatedBy: actor,
      archivedBy: null,
      archivedAt: null,
      createdAt,
      updatedAt: createdAt,
    });
    await r.revisions.insert({
      id: otherDocumentRevisionId,
      documentId: otherDocumentId,
      revisionNo: 1,
      ...before,
      contentHash: contentFingerprint(before),
      createdBy: actor,
      createdAt,
    });
    await r.documents.setCurrentRevision(
      otherDocumentId,
      otherDocumentRevisionId,
      actor,
    );
  });
  return {
    workspaceId: fixture.workspaceId,
    sourceId: fixture.source.id,
    documentId,
    beforeRevisionId,
    afterRevisionId,
    otherDocumentRevisionId,
  };
}

it("loads a batch of revisions by id and none for an empty batch", async () => {
  const { beforeRevisionId, afterRevisionId } = await seedRevisionBatchFixture();

  const revisions = await uow.run((r) =>
    r.revisions.findByIds([beforeRevisionId, afterRevisionId]),
  );

  expect(revisions).toHaveLength(2);
  expect(revisions.map((revision) => revision.id).sort()).toEqual(
    [beforeRevisionId, afterRevisionId].sort(),
  );
  expect(
    revisions.find((revision) => revision.id === beforeRevisionId)?.markdown,
  ).toBe("# Before\nOld line");
  expect(
    revisions.find((revision) => revision.id === afterRevisionId)?.markdown,
  ).toBe("# After\nNew line");
  await expect(uow.run((r) => r.revisions.findByIds([]))).resolves.toEqual([]);
});

it("keeps run-detail hrefs and diffs for before-only, after-only, and both-present changes", async () => {
  const fixture = await seedRevisionBatchFixture();
  const runId = uuidv7();
  const now = new Date("2026-09-02T00:05:00Z");
  const base = {
    runId,
    sourceId: fixture.sourceId,
    workspaceId: fixture.workspaceId,
    kind: "DOCUMENT" as const,
    sourcePath: "docs/detail.md",
    previousPath: null,
    title: "Before",
    documentId: fixture.documentId,
    diagnostics: [],
  };
  await uow.run(async (r) => {
    await r.syncRuns.insert({
      id: runId,
      sourceId: fixture.sourceId,
      triggeredBy: fixtureCaller().identity.id,
      basedOnVersion: 1,
      resultVersion: 2,
      status: "APPLIED",
      summary: {},
      startedAt: now,
      completedAt: now,
    });
    await r.syncRunChanges.insertMany([
      {
        ...base,
        id: uuidv7(),
        ordinal: 1,
        labels: ["REMOVED"],
        beforeRevisionId: fixture.beforeRevisionId,
        afterRevisionId: null,
        beforeRevisionNo: 1,
        afterRevisionNo: null,
      },
      {
        ...base,
        id: uuidv7(),
        ordinal: 2,
        labels: ["ADDED"],
        beforeRevisionId: null,
        afterRevisionId: fixture.afterRevisionId,
        beforeRevisionNo: null,
        afterRevisionNo: 2,
      },
      {
        ...base,
        id: uuidv7(),
        ordinal: 3,
        labels: ["UPDATED"],
        beforeRevisionId: fixture.beforeRevisionId,
        afterRevisionId: fixture.afterRevisionId,
        beforeRevisionNo: 1,
        afterRevisionNo: 2,
      },
      {
        // A real revision that belongs to another document: the change's
        // before side resolves but is unusable, the `documentId` mismatch path.
        ...base,
        id: uuidv7(),
        ordinal: 4,
        labels: ["MOVED"],
        beforeRevisionId: fixture.otherDocumentRevisionId,
        afterRevisionId: null,
        beforeRevisionNo: 1,
        afterRevisionNo: null,
      },
    ]);
  });

  const detail = await s.syncReading.get(
    fixtureCaller(),
    fixture.workspaceId,
    fixture.sourceId,
    runId,
  );
  expect(detail.hasRecordedChanges).toBe(true);
  const changes = new Map(detail.changes.map((change) => [change.ordinal, change]));
  const href = (revisionNo: number) =>
    `/w/${fixture.workspaceId}/knowledge/${fixture.sourceId}/${fixture.documentId}?revision=${revisionNo}&includeArchived=true`;

  const beforeOnly = changes.get(1)!;
  expect(beforeOnly.revisionUnavailable).toBe(false);
  expect(beforeOnly.href).toBe(href(1));
  expect(beforeOnly.diff).toEqual({
    titleChanges: { before: "Before", after: null },
    metadataChanges: [],
    lines: [
      { kind: "removed", text: "# Before" },
      { kind: "removed", text: "Old line" },
    ],
    truncated: false,
  });

  const afterOnly = changes.get(2)!;
  expect(afterOnly.revisionUnavailable).toBe(false);
  expect(afterOnly.href).toBe(href(2));
  expect(afterOnly.diff).toEqual({
    titleChanges: { before: null, after: "After" },
    metadataChanges: [],
    lines: [
      { kind: "added", text: "# After" },
      { kind: "added", text: "New line" },
    ],
    truncated: false,
  });

  const bothPresent = changes.get(3)!;
  expect(bothPresent.revisionUnavailable).toBe(false);
  expect(bothPresent.href).toBe(href(2));
  expect(bothPresent.diff).toEqual({
    titleChanges: { before: "Before", after: "After" },
    metadataChanges: [],
    lines: [
      { kind: "removed", text: "# Before" },
      { kind: "removed", text: "Old line" },
      { kind: "added", text: "# After" },
      { kind: "added", text: "New line" },
    ],
    truncated: false,
  });

  const unavailable = changes.get(4)!;
  expect(unavailable.revisionUnavailable).toBe(true);
  expect(unavailable.href).toBeNull();
  expect(unavailable.diff).toBeNull();
});
