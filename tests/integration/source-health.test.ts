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
it("reports unresolved and ambiguous links without claiming stale indexes are healthy", async () => {
  const snapshot = await prepareReadingImport(uow, workspaceId, null, [
    { path: "a.md", text: "# Origin\n[[Missing]] [[Same]]" },
    { path: "one.md", text: "# Same\none" },
    { path: "two.md", text: "# Same\ntwo" },
  ]);
  const a = await s.imports.apply.apply(fixtureCaller(), snapshot);
  if (a.kind !== "APPLIED") throw Error("fixture");
  const health = await s.sourceHealth.get(
    fixtureCaller(),
    workspaceId,
    a.sourceId,
  );
  expect(health.diagnostics.map((d) => d.code)).toContain("UNRESOLVED_LINK");
  expect(health.diagnostics.map((d) => d.code)).toContain("AMBIGUOUS_LINK");
  expect(health.indexIncomplete).toBe(false);
  await pool.query(
    "UPDATE knowledge_link_index SET extractor_version=0 WHERE document_id=?",
    [health.diagnostics[0].documentId],
  );
  expect(
    (await s.sourceHealth.get(fixtureCaller(), workspaceId, a.sourceId))
      .indexIncomplete,
  ).toBe(true);
  await expect(
    s.sourceHealth.get(
      fixtureCaller(),
      "0199f000-0000-7000-8000-000000009999",
      a.sourceId,
    ),
  ).rejects.toBeDefined();
});
it("pages stored source links and diagnostics without crossing source boundaries", async () => {
  const files = Array.from({ length: 52 }, (_, i) => ({
    path: `p${i}.md`,
    text: `# Page ${i}\n[[Missing ${i}]]`,
  }));
  const a = await s.imports.apply.apply(
    fixtureCaller(),
    await prepareReadingImport(uow, workspaceId, null, files),
  );
  if (a.kind !== "APPLIED") throw Error("fixture");
  const edges = await uow.run((r) =>
    r.links.loadHealthEdges(workspaceId, a.sourceId, null, 10),
  );
  expect(edges).toHaveLength(10);
  const last = edges[9];
  const next = await uow.run((r) =>
    r.links.loadHealthEdges(
      workspaceId,
      a.sourceId,
      { documentId: last.documentId, ordinal: last.link.ordinal },
      10,
    ),
  );
  expect(next.map((e) => e.documentId)).not.toContain(last.documentId);
  const first = await s.sourceHealth.get(
    fixtureCaller(),
    workspaceId,
    a.sourceId,
  );
  expect(first.diagnostics).toHaveLength(50);
  expect(first.nextCursor).toBeTruthy();
  const rest = await s.sourceHealth.get(
    fixtureCaller(),
    workspaceId,
    a.sourceId,
    first.nextCursor!,
  );
  expect(rest.diagnostics).toHaveLength(2);
  expect(rest.nextCursor).toBeNull();
  expect(
    rest.diagnostics.some((d) => first.diagnostics.some((f) => f.id === d.id)),
  ).toBe(false);
});
