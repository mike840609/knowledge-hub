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
