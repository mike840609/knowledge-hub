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
const files = Array.from({ length: 10 }, (_, i) => ({
  path: `docs/${i}.md`,
  text: `---\nknowledge_id: doc-${i}\n---\n# Document ${i}\nbody`,
}));
it("requires the correct snapshot plan and source name on server before archiving", async () => {
  const initial = await prepareReadingImport(uow, workspaceId, null, files);
  const applied = await s.imports.apply.apply(fixtureCaller(), initial);
  if (applied.kind !== "APPLIED") throw new Error("fixture failed");
  const snapshot = await prepareReadingImport(
    uow,
    workspaceId,
    applied.sourceId,
    files.slice(0, 5),
  );
  const preview = await s.imports.preview.get(fixtureCaller(), snapshot);
  expect(preview.safety).toMatchObject({
    previousDocuments: 10,
    incomingDocuments: 5,
    matchedDocuments: 5,
    archivedDocuments: 5,
    highRisk: true,
  });
  await expect(
    s.imports.apply.apply(fixtureCaller(), snapshot),
  ).rejects.toMatchObject({ code: "IMPORT_RISK_CONFIRMATION_REQUIRED" });
  await expect(
    s.imports.apply.apply(fixtureCaller(), snapshot, {
      planHash: "wrong",
      sourceName: "Reading",
    }),
  ).rejects.toMatchObject({ code: "IMPORT_RISK_CONFIRMATION_REQUIRED" });
  await expect(
    s.imports.apply.apply(fixtureCaller(), snapshot, {
      planHash: preview.planHash!,
      sourceName: "Wrong",
    }),
  ).rejects.toMatchObject({ code: "IMPORT_RISK_CONFIRMATION_REQUIRED" });
  expect(
    await pool.query("SELECT id FROM sync_runs WHERE source_id=?", [
      applied.sourceId,
    ]),
  ).toHaveLength(1);
  expect(
    (await uow.run((r) => r.sources.findById(applied.sourceId)))?.syncVersion,
  ).toBe(1);
  const result = await s.imports.apply.apply(fixtureCaller(), snapshot, {
    planHash: preview.planHash!,
    sourceName: "Reading",
  });
  expect(result.kind).toBe("APPLIED");
  expect(
    (
      await uow.run((r) => r.importCanonicalState.load(applied.sourceId))
    ).documents.filter((d) => d.status === "ACTIVE"),
  ).toHaveLength(5);
});
it("assesses ordinary and legacy previews without depending on client safety fields", async () => {
  const initial = await prepareReadingImport(uow, workspaceId, null, files);
  const applied = await s.imports.apply.apply(fixtureCaller(), initial);
  if (applied.kind !== "APPLIED") throw new Error("fixture failed");
  const snapshot = await prepareReadingImport(
    uow,
    workspaceId,
    applied.sourceId,
    files.map((f) => ({ ...f, path: f.path.replace("docs/", "moved/") })),
  );
  const preview = await s.imports.preview.get(fixtureCaller(), snapshot);
  expect(preview.safety).toMatchObject({
    matchedDocuments: 10,
    archivedDocuments: 0,
    highRisk: false,
  });
  expect((await s.imports.apply.apply(fixtureCaller(), snapshot)).kind).toBe(
    "APPLIED",
  );
});
it("returns the latest ready snapshot id per source, creator, version, and time", async () => {
  const initial = await prepareReadingImport(uow, workspaceId, null, files);
  const applied = await s.imports.apply.apply(fixtureCaller(), initial);
  if (applied.kind !== "APPLIED") throw new Error("fixture failed");

  const older = await prepareReadingImport(
    uow, workspaceId, applied.sourceId,
    files.map((f) => ({ ...f, path: f.path.replace("docs/", "older/") })),
  );
  const newer = await prepareReadingImport(
    uow, workspaceId, applied.sourceId,
    files.map((f) => ({ ...f, path: f.path.replace("docs/", "newer/") })),
  );

  // A second source whose READY snapshot is based on a different version: the
  // batch must omit it rather than return a stale preview.
  const otherInitial = await prepareReadingImport(uow, workspaceId, null, files.slice(0, 3));
  const otherApplied = await s.imports.apply.apply(fixtureCaller(), otherInitial);
  if (otherApplied.kind !== "APPLIED") throw new Error("fixture failed");
  await prepareReadingImport(
    uow, workspaceId, otherApplied.sourceId,
    files.slice(0, 3).map((f) => ({ ...f, path: f.path.replace("docs/", "other/") })),
  );

  const ids = await uow.run((r) =>
    r.importSnapshots.findLatestReadyIdsBySourceForCreator(
      [
        { sourceId: applied.sourceId, basedOnVersion: 1 },
        { sourceId: otherApplied.sourceId, basedOnVersion: 2 },
      ],
      fixtureCaller().identity.id,
      new Date(),
    ),
  );
  expect(ids.get(applied.sourceId)).toBe(newer);
  expect(ids.get(applied.sourceId)).not.toBe(older);
  expect(ids.has(otherApplied.sourceId)).toBe(false); // wrong-version fixture

  expect((await uow.run((r) =>
    r.importSnapshots.findLatestReadyIdsBySourceForCreator(
      [{ sourceId: applied.sourceId, basedOnVersion: 1 }],
      "0199f000-0000-7000-8000-000000009999",
      new Date(),
    ),
  )).has(applied.sourceId)).toBe(false); // foreign creator

  // READY snapshots expire after 30 minutes.
  expect((await uow.run((r) =>
    r.importSnapshots.findLatestReadyIdsBySourceForCreator(
      [{ sourceId: applied.sourceId, basedOnVersion: 1 }],
      fixtureCaller().identity.id,
      new Date(Date.now() + 86400_000),
    ),
  )).has(applied.sourceId)).toBe(false); // expired

  expect((await uow.run((r) =>
    r.importSnapshots.findLatestReadyIdsBySourceForCreator(
      [{ sourceId: applied.sourceId, basedOnVersion: 2 }],
      fixtureCaller().identity.id,
      new Date(),
    ),
  )).has(applied.sourceId)).toBe(false); // wrong version

  expect((await uow.run((r) =>
    r.importSnapshots.findLatestReadyIdsBySourceForCreator(
      [],
      fixtureCaller().identity.id,
      new Date(),
    ),
  )).size).toBe(0);
});
