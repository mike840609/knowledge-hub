import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { MariaDbSourceRepository } from "@/infrastructure/database/mariadb/repositories/sources";
import { SourceApplicationService } from "@/modules/sources/application/source-version-guard";
import { VersionConflictError } from "@/modules/knowledge/domain/errors";
import { contentFingerprint } from "@/modules/knowledge/domain/content";
import { createDocumentForAnySource, createEntryFixture, createSourceFixture, fixtureCaller, fixtureIdentity, secondFixtureIdentity } from "../fixtures/knowledge";
import { uuidv7 } from "@/shared/ids/uuidv7";

let pool: Pool;
beforeAll(() => { pool = createDatabasePool(databaseConfig("test")); });
afterAll(async () => { await pool.end(); });

function sourceService(identity = fixtureIdentity) {
  const uow = new MariaDbUnitOfWork(pool);
  const service = new SourceApplicationService(uow);
  const caller = fixtureCaller(identity);
  return {
    listSources: (workspaceId?: string) => service.listSources(caller, workspaceId),
    applyKnownEntry: (input: Parameters<SourceApplicationService["applyKnownEntry"]>[1]) => service.applyKnownEntry(caller, input),
    archiveKnownEntry: (input: Parameters<SourceApplicationService["archiveKnownEntry"]>[1]) => service.archiveKnownEntry(caller, input),
  };
}

async function guardedCompetition(sourceId: string, firstCommits: boolean): Promise<{ first: number | null; second: number | null; firstConnectionId: number; secondConnectionId: number; observedLockWait: boolean; observedProcessWait: boolean }> {
  const first = await pool.getConnection();
  const second = await pool.getConnection();
  try {
    const firstConnectionId = Number((await first.query<{ connection_id: number }[]>("SELECT CONNECTION_ID() AS connection_id"))[0].connection_id);
    const secondConnectionId = Number((await second.query<{ connection_id: number }[]>("SELECT CONNECTION_ID() AS connection_id"))[0].connection_id);
    expect(firstConnectionId).not.toBe(secondConnectionId);
    await first.beginTransaction();
    await second.beginTransaction();
    const firstRepository = new MariaDbSourceRepository(first);
    const secondRepository = new MariaDbSourceRepository(second);
    const firstResult = await firstRepository.guardAndAdvanceVersion(sourceId, 0, fixtureIdentity.id);
    const secondPromise = secondRepository.guardAndAdvanceVersion(sourceId, 0, fixtureIdentity.id);
    secondPromise.catch(() => undefined);
    let observedLockWait = false;
    let observedProcessWait = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const waits = await pool.query<{ waiting: number }[]>(
        `SELECT COUNT(*) AS waiting FROM information_schema.INNODB_LOCK_WAITS w
         INNER JOIN information_schema.INNODB_TRX requesting ON requesting.trx_id = w.requesting_trx_id
         WHERE requesting.trx_mysql_thread_id = ?`, [secondConnectionId],
      );
      const processRows = await pool.query<{ Id: number; State: string | null }[]>("SHOW PROCESSLIST");
      if (Number(waits[0]?.waiting ?? 0) > 0) observedLockWait = true;
      if (processRows.some((row) => Number(row.Id) === secondConnectionId && /updating|lock/i.test(row.State ?? ""))) observedProcessWait = true;
      if (observedLockWait || observedProcessWait) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(observedLockWait || observedProcessWait).toBe(true);
    if (firstCommits) await first.commit(); else await first.rollback();
    const secondResult = await secondPromise;
    await second.commit();
    return { first: firstResult, second: secondResult, firstConnectionId, secondConnectionId, observedLockWait, observedProcessWait };
  } finally {
    try { await first.rollback(); } catch { /* best effort */ }
    try { await second.rollback(); } catch { /* best effort */ }
    first.release();
    second.release();
  }
}

describe("SourceEntry and source version safety", () => {
  it("proves commit and rollback outcomes with two real connections and a barrier", async () => {
    const committed = await createSourceFixture(pool, { managed: true });
    const committedRace = await guardedCompetition(committed.source.id, true);
    expect(committedRace).toMatchObject({ first: 1, second: null });
    expect(committedRace.observedLockWait || committedRace.observedProcessWait).toBe(true);
    expect(committedRace.firstConnectionId).not.toBe(committedRace.secondConnectionId);
    const rolledBack = await createSourceFixture(pool, { managed: true });
    const rolledBackRace = await guardedCompetition(rolledBack.source.id, false);
    expect(rolledBackRace).toMatchObject({ first: 1, second: 1 });
    expect(rolledBackRace.observedLockWait || rolledBackRace.observedProcessWait).toBe(true);
    expect(Number((await pool.query<{ sync_version: number }[]>("SELECT sync_version FROM knowledge_sources WHERE id = ?", [committed.source.id]))[0].sync_version)).toBe(1);
    expect(Number((await pool.query<{ sync_version: number }[]>("SELECT sync_version FROM knowledge_sources WHERE id = ?", [rolledBack.source.id]))[0].sync_version)).toBe(1);
  });

  it("locking read observes latest committed state under READ COMMITTED", async () => {
    const fixture = await createSourceFixture(pool, { managed: true });
    const first = await pool.getConnection();
    const second = await pool.getConnection();
    try {
      const firstConnectionId = Number((await first.query<{ connection_id: number }[]>("SELECT CONNECTION_ID() AS connection_id"))[0].connection_id);
      const secondConnectionId = Number((await second.query<{ connection_id: number }[]>("SELECT CONNECTION_ID() AS connection_id"))[0].connection_id);
      expect(firstConnectionId).not.toBe(secondConnectionId);
      await first.query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED");
      await first.beginTransaction();
      const before = await first.query<{ sync_version: number }[]>("SELECT sync_version FROM knowledge_sources WHERE id = ?", [fixture.source.id]);
      expect(Number(before[0].sync_version)).toBe(0);
      await second.beginTransaction();
      await second.query("UPDATE knowledge_sources SET sync_version = 1 WHERE id = ?", [fixture.source.id]);
      await second.commit();
      const locked = await first.query<{ sync_version: number }[]>("SELECT sync_version FROM knowledge_sources WHERE id = ? FOR UPDATE", [fixture.source.id]);
      expect(Number(locked[0].sync_version)).toBe(1);
      await first.rollback();
      expect(Number((await pool.query<{ sync_version: number }[]>("SELECT sync_version FROM knowledge_sources WHERE id = ?", [fixture.source.id]))[0].sync_version)).toBe(1);
    } finally {
      try { await first.rollback(); } catch { /* best effort */ }
      try { await second.rollback(); } catch { /* best effort */ }
      first.release();
      second.release();
    }
  });

  it("rolls back Knowledge, mapping, asset, version, Tree, and APPLIED records at every apply failure point", async () => {
    for (const failurePoint of ["knowledge", "entry", "asset", "run"] as const) {
      const fixture = await createSourceFixture(pool, { managed: true });
      const document = await createDocumentForAnySource(pool, fixture.source.id, fixture.folderId, fixtureIdentity);
      const originalContent = { title: "Fixture Document", markdown: "fixture body", metadata: { fixture: true } };
      const entry = await createEntryFixture(pool, fixture.source.id, document.documentId, `failure-${failurePoint}`, contentFingerprint(originalContent));
      const service = sourceService(secondFixtureIdentity);
      await service.archiveKnownEntry({ sourceId: fixture.source.id, basedOnVersion: 0, entryId: entry.entryId, documentId: document.documentId, externalId: entry.externalId, sourcePath: "docs/fixture.md" });
      const beforeDocument = await pool.query("SELECT status, current_revision_id FROM knowledge_documents WHERE id = ?", [document.documentId]);
      const beforeRevisions = await pool.query("SELECT revision_no, title, markdown, metadata, content_hash, created_by FROM knowledge_revisions WHERE document_id = ? ORDER BY revision_no", [document.documentId]);
      const beforeTree = await pool.query("SELECT id, parent_id, status, position FROM knowledge_tree_nodes WHERE document_id = ?", [document.documentId]);
      const beforeEntry = await pool.query("SELECT external_id, source_path, content_hash, document_id, status FROM source_entries WHERE id = ?", [entry.entryId]);
      const beforeAppliedRuns = await pool.query("SELECT id, based_on_version, result_version, status FROM sync_runs WHERE source_id = ? AND status = 'APPLIED' ORDER BY id", [fixture.source.id]);
      const beforeSource = await pool.query<{ sync_version: number }[]>("SELECT sync_version FROM knowledge_sources WHERE id = ?", [fixture.source.id]);
      const assetId = uuidv7();
      await expect(service.applyKnownEntry({
        sourceId: fixture.source.id, basedOnVersion: Number(beforeSource[0].sync_version), entryId: entry.entryId, documentId: document.documentId, externalId: entry.externalId,
        sourcePath: "docs/changed.md", content: { title: "Changed", markdown: "changed", metadata: { changed: true } }, restore: true,
        asset: { id: assetId, sourceId: fixture.source.id, sourcePath: "assets/one.png", mimeType: "image/png", contentHash: "b".repeat(64), metadata: { width: 1 }, createdAt: new Date() },
        failurePoint,
      })).rejects.toThrow();
      expect(await pool.query("SELECT status, current_revision_id FROM knowledge_documents WHERE id = ?", [document.documentId])).toEqual(beforeDocument);
      expect(await pool.query("SELECT revision_no, title, markdown, metadata, content_hash, created_by FROM knowledge_revisions WHERE document_id = ? ORDER BY revision_no", [document.documentId])).toEqual(beforeRevisions);
      expect(await pool.query("SELECT id, parent_id, status, position FROM knowledge_tree_nodes WHERE document_id = ?", [document.documentId])).toEqual(beforeTree);
      expect(await pool.query("SELECT external_id, source_path, content_hash, document_id, status FROM source_entries WHERE id = ?", [entry.entryId])).toEqual(beforeEntry);
      expect(await pool.query("SELECT id FROM knowledge_assets WHERE id = ?", [assetId])).toHaveLength(0);
      expect(await pool.query("SELECT id, based_on_version, result_version, status FROM sync_runs WHERE source_id = ? AND status = 'APPLIED' ORDER BY id", [fixture.source.id])).toEqual(beforeAppliedRuns);
      expect(Number((await pool.query<{ sync_version: number }[]>("SELECT sync_version FROM knowledge_sources WHERE id = ?", [fixture.source.id]))[0].sync_version)).toBe(Number(beforeSource[0].sync_version));
      expect(await pool.query<{ status: string; result_version: number | null }[]>("SELECT status, result_version FROM sync_runs WHERE source_id = ? AND status = 'FAILED'", [fixture.source.id])).toEqual([{ status: "FAILED", result_version: null }]);
    }
    expect(await pool.query("SELECT id FROM users WHERE id = ?", [secondFixtureIdentity.id])).toHaveLength(1);
  });

  it("persists and reads asset metadata without binary storage", async () => {
    const fixture = await createSourceFixture(pool, { managed: true });
    const document = await createDocumentForAnySource(pool, fixture.source.id, fixture.folderId);
    const content = { title: "Fixture Document", markdown: "fixture body", metadata: { fixture: true } };
    const entry = await createEntryFixture(pool, fixture.source.id, document.documentId, "asset-roundtrip", contentFingerprint(content));
    const asset = { id: uuidv7(), sourceId: fixture.source.id, sourcePath: "assets/one.png", mimeType: "image/png", contentHash: "c".repeat(64), metadata: { width: 32, height: 18, tags: ["fixture", "preview"] }, createdAt: new Date() };
    const result = await sourceService().applyKnownEntry({ sourceId: fixture.source.id, basedOnVersion: 0, entryId: entry.entryId, documentId: document.documentId, externalId: entry.externalId, sourcePath: "docs/fixture.md", content, asset });
    expect(result).toMatchObject({ resultVersion: 1, changed: false });
    const stored = await new MariaDbUnitOfWork(pool).run(async ({ assets }) => assets.findById(asset.id));
    expect(stored).toMatchObject({ id: asset.id, sourceId: asset.sourceId, sourcePath: asset.sourcePath, mimeType: asset.mimeType, contentHash: asset.contentHash, metadata: asset.metadata });
  });

  it("records an all-unchanged apply as only source version and run changes", async () => {
    const fixture = await createSourceFixture(pool, { managed: true });
    const document = await createDocumentForAnySource(pool, fixture.source.id, fixture.folderId);
    const content = { title: "Fixture Document", markdown: "fixture body", metadata: { fixture: true } };
    const entry = await createEntryFixture(pool, fixture.source.id, document.documentId, "unchanged-external", contentFingerprint(content));
    const beforeEntry = await pool.query("SELECT * FROM source_entries WHERE id = ?", [entry.entryId]);
    const beforeTree = await pool.query("SELECT * FROM knowledge_tree_nodes WHERE source_id = ? ORDER BY id", [fixture.source.id]);
    const beforeRevisions = await pool.query("SELECT * FROM knowledge_revisions WHERE document_id = ? ORDER BY revision_no", [document.documentId]);
    const result = await sourceService().applyKnownEntry({ sourceId: fixture.source.id, basedOnVersion: 0, entryId: entry.entryId, documentId: document.documentId, externalId: entry.externalId, sourcePath: "docs/fixture.md", content });
    expect(result).toMatchObject({ resultVersion: 1, changed: false });
    expect(await pool.query("SELECT * FROM source_entries WHERE id = ?", [entry.entryId])).toEqual(beforeEntry);
    expect(await pool.query("SELECT * FROM knowledge_tree_nodes WHERE source_id = ? ORDER BY id", [fixture.source.id])).toEqual(beforeTree);
    expect(await pool.query("SELECT * FROM knowledge_revisions WHERE document_id = ? ORDER BY revision_no", [document.documentId])).toEqual(beforeRevisions);
    expect(await pool.query<{ status: string; result_version: number }[]>("SELECT status, result_version FROM sync_runs WHERE id = ?", [result.runId])).toEqual([{ status: "APPLIED", result_version: 1 }]);
    const stale = await sourceService().applyKnownEntry({ sourceId: fixture.source.id, basedOnVersion: 0, entryId: entry.entryId, documentId: document.documentId, externalId: entry.externalId, sourcePath: "docs/fixture.md", content }).then(
      (): null => null,
      (caught: unknown) => caught,
    );
    expect(stale).toBeInstanceOf(VersionConflictError);
    expect((stale as VersionConflictError).code).toBe("VERSION_CONFLICT");
  });

  it("restores a known mapping with the same Document ID and versions changed content once", async () => {
    const fixture = await createSourceFixture(pool, { managed: true });
    const document = await createDocumentForAnySource(pool, fixture.source.id, fixture.folderId);
    const content = { title: "Fixture Document", markdown: "fixture body", metadata: { fixture: true } };
    const entry = await createEntryFixture(pool, fixture.source.id, document.documentId, "reappear-external", contentFingerprint(content));
    await sourceService().archiveKnownEntry({ sourceId: fixture.source.id, basedOnVersion: 0, entryId: entry.entryId, documentId: document.documentId, externalId: entry.externalId, sourcePath: "docs/fixture.md" });
    const restored = await sourceService().applyKnownEntry({ sourceId: fixture.source.id, basedOnVersion: 1, entryId: entry.entryId, documentId: document.documentId, externalId: entry.externalId, sourcePath: "docs/renamed.md", content, restore: true });
    expect(restored.changed).toBe(false);
    const documentRow = await pool.query<{ status: string; current_revision_id: string }[]>("SELECT status, current_revision_id FROM knowledge_documents WHERE id = ?", [document.documentId]);
    expect(documentRow[0].status).toBe("ACTIVE");
    const revisionCount = await pool.query<{ count: number }[]>("SELECT COUNT(*) AS count FROM knowledge_revisions WHERE document_id = ?", [document.documentId]);
    expect(Number(revisionCount[0].count)).toBe(1);
    const changed = await sourceService().applyKnownEntry({ sourceId: fixture.source.id, basedOnVersion: 2, entryId: entry.entryId, documentId: document.documentId, externalId: entry.externalId, sourcePath: "docs/renamed.md", content: { ...content, markdown: "new body" } });
    expect(changed.changed).toBe(true);
    expect((await pool.query<{ count: number }[]>("SELECT COUNT(*) AS count FROM knowledge_revisions WHERE document_id = ?", [document.documentId]))[0].count).toBe(2);
  });
});
