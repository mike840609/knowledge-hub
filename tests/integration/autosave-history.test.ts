import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { HubKnowledgeCommandServiceImpl } from "@/modules/knowledge/application/hub-knowledge-command-service";
import { uuidv7 } from "@/shared/ids/uuidv7";
import { RevisionConflictError } from "@/modules/knowledge/domain/errors";
import { disposeIsolatedDatabase, provisionIsolatedDatabase } from "../../scripts/db/test-database";
import { runMigrations, type IsolatedDatabaseHandle } from "../../scripts/db/migrate";
import { createSourceFixture, fixtureCaller, fixtureIdentity } from "../fixtures/knowledge";

let handle: IsolatedDatabaseHandle;
let pool: Pool;
beforeAll(async () => {
  handle = await provisionIsolatedDatabase("test");
  const previous = process.env.KM_TEST_DB_NAME;
  process.env.KM_TEST_DB_NAME = handle.databaseName;
  try { pool = createDatabasePool(databaseConfig("test")); }
  finally {
    if (previous === undefined) delete process.env.KM_TEST_DB_NAME;
    else process.env.KM_TEST_DB_NAME = previous;
  }
  await runMigrations(pool);
});
afterAll(async () => { await pool?.end(); if (handle) await disposeIsolatedDatabase(handle); });

async function setup() {
  const { source, folderId, workspaceId } = await createSourceFixture(pool);
  let now = new Date();
  const uow = new MariaDbUnitOfWork(pool);
  const hub = new HubKnowledgeCommandServiceImpl(uow, () => now);
  const created = await hub.createDocument(fixtureCaller(), { sourceId: source.id, parentId: folderId, title: "History", markdown: "initial", metadata: {} });
  let head = created.revisionId;
  const save = async (markdown: string, mode: "AUTOSAVE" | "CHECKPOINT" | "RESTORE" = "AUTOSAVE", versionName?: string) => {
    const result = await hub.createRevision(fixtureCaller(), { documentId: created.documentId, expectedCurrentRevisionId: head, title: "History", markdown, metadata: {}, saveMode: mode, versionName });
    head = result.revisionId;
    return result;
  };
  return { hub, created, workspaceId, save, advance: (ms: number) => { now = new Date(+now + ms); }, listed: () => uow.run(repositories => repositories.revisions.listByDocument(created.documentId)), rows: () => pool.query<Record<string, unknown>[]>("SELECT * FROM knowledge_revisions WHERE document_id = ? ORDER BY revision_no", [created.documentId]) };
}

describe("autosave history persistence", () => {
  it("stores bounded rows while every changed save gets a new CAS token", async () => {
    const f = await setup();
    const ids = new Set([f.created.revisionId]);
    for (let i = 1; i <= 40; i++) {
      f.advance(1000);
      const result = await f.save(`draft ${i}`);
      expect(result.changed).toBe(true);
      expect(ids.has(result.revisionId)).toBe(false);
      ids.add(result.revisionId);
      expect(await f.rows()).toHaveLength(2);
    }
    const before = await f.rows();
    await expect(f.hub.createRevision(fixtureCaller(), { documentId: f.created.documentId, expectedCurrentRevisionId: f.created.revisionId, title: "History", markdown: "stale", metadata: {}, saveMode: "AUTOSAVE" })).rejects.toBeInstanceOf(RevisionConflictError);
    expect(await f.rows()).toEqual(before);
  });

  it("retains the fixed ten-minute checkpoint while replacing subsequent working heads", async () => {
    const f = await setup();
    await f.save("start");
    let checkpoint;
    for (let i = 1; i <= 20; i++) {
      f.advance(30_000);
      checkpoint = await f.save(`continuous ${i}`);
    }
    expect(checkpoint?.history?.state).toBe("CHECKPOINT");
    f.advance(1000);
    await f.save("after checkpoint");
    f.advance(1000);
    await f.save("latest");
    expect(await f.rows()).toHaveLength(3);
    expect((await f.listed()).map(r => r.id)).toContain(checkpoint?.revisionId);
  });

  it("preserves the last working save after idle and starts a new activity after an hour", async () => {
    const f = await setup();
    const first = await f.save("before idle");
    f.advance(120_000);
    const resumed = await f.save("after idle");
    expect(resumed.history?.activityId).toBe(first.history?.activityId);
    expect((await f.listed()).find(r => r.id === first.revisionId)?.history).toMatchObject({ state: "CHECKPOINT", reason: "IDLE" });
    f.advance(3_600_000);
    const later = await f.save("next activity");
    expect(later.history?.activityId).not.toBe(resumed.history?.activityId);
    expect((await f.listed()).map(r => r.id)).toContain(resumed.revisionId);
  });

  it("retains referenced working rows but hides them from history and prunes released references", async () => {
    const f = await setup();
    const read = await f.save("read snapshot");
    await pool.query("INSERT INTO document_read_progress (user_id,workspace_id,document_id,revision_id,revision_no,read_at) VALUES (?,?,?,?,?,?)", [fixtureIdentity.id, f.workspaceId, f.created.documentId, read.revisionId, read.revisionNo, new Date()]);
    const reviewed = await f.save("review snapshot");
    await pool.query("INSERT INTO document_review_threads (id,document_id,created_revision_id,created_by,creation_idempotency_key,creation_request_hash,anchor_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)", [uuidv7(), f.created.documentId, reviewed.revisionId, fixtureIdentity.id, "retention-test", "a".repeat(64), "{}", new Date(), new Date()]);
    const latest = await f.save("latest snapshot");
    expect(await f.rows()).toHaveLength(4);
    expect((await f.listed()).map(r => r.id)).toEqual([f.created.revisionId, latest.revisionId]);
    await pool.query("DELETE FROM document_read_progress WHERE document_id = ?", [f.created.documentId]);
    await f.save("next snapshot");
    const ids = (await f.rows()).map(r => String(r.id));
    expect(ids).not.toContain(read.revisionId);
    expect(ids).toContain(reviewed.revisionId);
  });

  it("pins unchanged named versions and preserves content through later saves and restore", async () => {
    const f = await setup();
    const draft = await f.save("named body");
    const named = await f.save("named body", "CHECKPOINT", "Reviewed");
    expect(named.changed).toBe(false);
    expect(named.revisionId).toBe(draft.revisionId);
    await f.save("later body");
    const restored = await f.save("named body", "RESTORE");
    expect(restored.revisionId).not.toBe(named.revisionId);
    expect(restored.history).toMatchObject({ state: "CHECKPOINT", reason: "RESTORE" });
    const sameRestore = await f.save("named body", "RESTORE");
    expect(sameRestore.changed).toBe(true);
    expect(sameRestore.revisionId).not.toBe(restored.revisionId);
    const listed = await f.listed();
    expect(listed.find(r => r.id === named.revisionId)).toMatchObject({ markdown: "named body", history: { state: "CHECKPOINT", name: "Reviewed" } });
    expect(listed.map(r => r.id)).toContain(restored.revisionId);
  });
});
