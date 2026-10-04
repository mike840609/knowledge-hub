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
import {
  createSourceFixture,
  createDocumentForAnySource,
  fixtureCaller,
  fixtureIdentity,
  secondFixtureIdentity,
} from "../fixtures/knowledge";
import { buildApplicationServices } from "@/server/composition";
import { uuidv7 } from "@/shared/ids/uuidv7";
let handle: IsolatedDatabaseHandle,
  pool: Pool,
  uow: MariaDbUnitOfWork,
  s: ReturnType<typeof buildApplicationServices>;
let workspaceId: string, documentId: string, revisionId: string;
beforeAll(async () => {
  handle = await provisionIsolatedDatabase("test");
  pool = createDatabasePool({
    ...databaseConfig("test"),
    database: handle.databaseName,
  });
  await runMigrations(pool);
  uow = new MariaDbUnitOfWork(pool);
  const fixture = await createSourceFixture(pool);
  workspaceId = fixture.workspaceId;
  await pool.query(
    "UPDATE workspaces SET name='My Space',workspace_type='PERSONAL',personal_owner_user_id=? WHERE id=?",
    [fixtureIdentity.id, workspaceId],
  );
  ({ documentId, revisionId } = await createDocumentForAnySource(
    pool,
    fixture.source.id,
    fixture.folderId,
  ));
  s = buildApplicationServices(pool);
});
afterAll(async () => {
  await pool?.end();
  if (handle) await disposeIsolatedDatabase(handle);
});
it("exposes a dedicated read-progress service without changing favorite keys", () => {
  expect(s).toHaveProperty("documentReadProgress");
});
it("advances current and historical reads without moving backward", async () => {
  const newerId = uuidv7();
  await uow.run(async (r) => {
    const rev = await r.revisions.findById(revisionId);
    await r.revisions.insert({ ...rev!, id: newerId, revisionNo: 2 });
  });
  await s.documentReadProgress.markRead(fixtureCaller(), {
    workspaceId,
    documentId,
    revisionId: newerId,
  });
  await s.documentReadProgress.markRead(fixtureCaller(), {
    workspaceId,
    documentId,
    revisionId,
  });
  await s.documentReadProgress.markRead(fixtureCaller(), {
    workspaceId,
    documentId,
    revisionId: newerId,
  });
  expect(
    await uow.run((r) =>
      r.documentReadProgress.getMany(fixtureIdentity.id, workspaceId, [
        documentId,
      ]),
    ),
  ).toMatchObject([{ revisionId: newerId, revisionNo: 2 }]);
});
it("rejects foreign revisions, workspace mismatch, and another personal owner", async () => {
  await expect(
    s.documentReadProgress.markRead(fixtureCaller(), {
      workspaceId,
      documentId,
      revisionId: uuidv7(),
    }),
  ).rejects.toMatchObject({ code: "REVISION_NOT_FOUND" });
  await expect(
    s.documentReadProgress.markRead(fixtureCaller(), {
      workspaceId: uuidv7(),
      documentId,
      revisionId,
    }),
  ).rejects.toMatchObject({ code: "WORKSPACE_NOT_FOUND" });
  await expect(
    s.documentReadProgress.markRead(fixtureCaller(secondFixtureIdentity), {
      workspaceId,
      documentId,
      revisionId,
    }),
  ).rejects.toMatchObject({ code: "WORKSPACE_NOT_FOUND" });
  const other = await createSourceFixture(pool);
  const doc = await createDocumentForAnySource(
    pool,
    other.source.id,
    other.folderId,
  );
  await expect(
    s.documentReadProgress.markRead(fixtureCaller(), {
      workspaceId,
      documentId,
      revisionId: doc.revisionId,
    }),
  ).rejects.toMatchObject({ code: "REVISION_NOT_FOUND" });
});
it("rejects Team reads and archived personal workspaces without leaking markers", async () => {
  const team = await createSourceFixture(pool);
  const doc = await createDocumentForAnySource(
    pool,
    team.source.id,
    team.folderId,
  );
  await expect(
    s.documentReadProgress.markRead(fixtureCaller(), {
      workspaceId: team.workspaceId,
      ...doc,
    }),
  ).rejects.toMatchObject({ code: "WORKSPACE_NOT_FOUND" });
  await pool.query(
    "UPDATE workspaces SET lifecycle_state='ARCHIVED',archived_by=?,archived_at=NOW() WHERE id=?",
    [fixtureIdentity.id, workspaceId],
  );
  await expect(
    s.documentReadProgress.markRead(fixtureCaller(), {
      workspaceId,
      documentId,
      revisionId,
    }),
  ).rejects.toThrow();
});
