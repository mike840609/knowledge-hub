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
  expect(
    (
      await uow.run((r) =>
        r.importSnapshots.findLatestReadyBySourceForCreator(
          applied.sourceId,
          fixtureCaller().identity.id,
          new Date(),
          1,
        ),
      )
    )?.id,
  ).toBe(snapshot);
  expect(
    await uow.run((r) =>
      r.importSnapshots.findLatestReadyBySourceForCreator(
        applied.sourceId,
        "0199f000-0000-7000-8000-000000009999",
        new Date(),
        1,
      ),
    ),
  ).toBeNull();
  expect(
    await uow.run((r) =>
      r.importSnapshots.findLatestReadyBySourceForCreator(
        applied.sourceId,
        fixtureCaller().identity.id,
        new Date(Date.now() + 86400_000),
        1,
      ),
    ),
  ).toBeNull();
  expect(
    await uow.run((r) =>
      r.importSnapshots.findLatestReadyBySourceForCreator(
        applied.sourceId,
        fixtureCaller().identity.id,
        new Date(),
        2,
      ),
    ),
  ).toBeNull();
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
