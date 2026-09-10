import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { runMigrations } from "../../scripts/db/migrate";
import type { Migration } from "@/infrastructure/database/mariadb/migrations/types";
import { migrations } from "@/infrastructure/database/mariadb/migrations";
import { KnowledgeApplicationService } from "@/modules/knowledge/application/service";
import { IdentityError, SourceReadOnlyError } from "@/modules/knowledge/domain/errors";
import type { SourcePolicy } from "@/modules/knowledge/domain/source-policy";
import type { KnowledgeRepositories, KnowledgeUnitOfWork } from "@/modules/knowledge/ports/unit-of-work";
import { createDocumentFixture, createDocumentForAnySource, createEntryFixture, createSourceFixture, ensureUser, fixtureCaller, fixtureIdentity, secondFixtureIdentity } from "../fixtures/knowledge";
import { DEV_FIXTURE_IDS, seedDevelopmentDatabase } from "../../scripts/db/seed";

let pool: Pool;

type SourceLockHook = (sourceId: string, lock: () => Promise<SourcePolicy | null>) => Promise<SourcePolicy | null>;

function withSourceLockHook(base: KnowledgeUnitOfWork, hook: SourceLockHook): KnowledgeUnitOfWork {
  return {
    run: <T>(work: (repositories: KnowledgeRepositories) => Promise<T>) => base.run(async (repositories) => work({
      ...repositories,
      sourcePolicy: {
        ...repositories.sourcePolicy,
        lockById: (sourceId) => hook(sourceId, () => repositories.sourcePolicy.lockById(sourceId)),
      },
    })),
  };
}

beforeAll(async () => {
  pool = createDatabasePool(databaseConfig("test"));
  await runMigrations(pool);
});

afterAll(async () => {
  await pool.end();
});

describe("MariaDB schema and migrations", () => {
  it("contains the ten domain tables and idempotent migration ledger", async () => {
    await runMigrations(pool);
    const rows = await pool.query<{ table_name: string }[]>("SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name IN ('users','workspaces','workspace_memberships','knowledge_sources','source_entries','knowledge_tree_nodes','knowledge_documents','knowledge_revisions','knowledge_assets','sync_runs')");
    expect(rows.map((row) => row.table_name).sort()).toEqual(["knowledge_assets", "knowledge_documents", "knowledge_revisions", "knowledge_sources", "knowledge_tree_nodes", "source_entries", "sync_runs", "users", "workspace_memberships", "workspaces"]);
    const ledger = await pool.query<{ state: string }[]>("SELECT state FROM schema_migrations ORDER BY version");
    expect(ledger).toEqual([{ state: "APPLIED" }, { state: "APPLIED" }, { state: "APPLIED" }]);
  });

  it("records DDL failure and refuses unfinished/checksum-mismatched migrations", async () => {
    const failure: Migration = { version: 90, name: "test-failure", statements: ["CREATE TABLE phase0_partial_failure (id INT NOT NULL)", "THIS IS NOT VALID SQL"] };
    const withFailure = [...migrations, failure];
    await expect(runMigrations(pool, withFailure)).rejects.toThrow();
    expect(await pool.query<{ state: string }[]>("SELECT state FROM schema_migrations WHERE version = 90")).toEqual([{ state: "FAILED" }]);
    await expect(runMigrations(pool, withFailure)).rejects.toThrow(/recorded as FAILED/);
    await expect(runMigrations(pool, migrations)).rejects.toThrow(/not present in the current migration manifest/);
    await pool.query("DROP TABLE phase0_partial_failure");
    await pool.query("DELETE FROM schema_migrations WHERE version = 90");
    const original: Migration = { version: 91, name: "test-checksum", statements: ["CREATE TABLE phase0_checksum (id INT NOT NULL)"] };
    await runMigrations(pool, [...migrations, original]);
    await expect(runMigrations(pool, [...migrations, { ...original, statements: ["CREATE TABLE phase0_checksum (id INT NOT NULL, value INT)"] }])).rejects.toThrow(/checksum\/name mismatch/);
    await pool.query("DROP TABLE phase0_checksum");
    await pool.query("DELETE FROM schema_migrations WHERE version = 91");
    const future: Migration = { version: 92, name: "test-future", statements: ["CREATE TABLE phase0_future (id INT NOT NULL)"] };
    await runMigrations(pool, [...migrations, future]);
    await expect(runMigrations(pool, migrations)).rejects.toThrow(/not present in the current migration manifest/);
    await pool.query("DROP TABLE phase0_future");
    await pool.query("DELETE FROM schema_migrations WHERE version = 92");
  });

  it("refuses a ledger row from an unknown migration manifest", async () => {
    await pool.query(
      "INSERT INTO schema_migrations (version, name, checksum, state, error_message) VALUES (93, 'unknown', ?, 'FAILED', 'fixture')",
      ["f".repeat(64)],
    );
    await expect(runMigrations(pool, migrations)).rejects.toThrow(/not present in the current migration manifest/);
    await pool.query("DELETE FROM schema_migrations WHERE version = 93");
  });

  it("enforces cross-document current revision and tree/source constraints", async () => {
    const hubA = await createSourceFixture(pool);
    const hubB = await createSourceFixture(pool, { orgCode: "OTHER" });
    const docA = await createDocumentFixture(pool, hubA.source.id, hubA.folderId);
    const docB = await createDocumentFixture(pool, hubB.source.id, hubB.folderId);
    await expect(pool.query("UPDATE knowledge_documents SET current_revision_id = ? WHERE id = ?", [docB.revisionId, docA.documentId])).rejects.toBeTruthy();
    const unchanged = await pool.query<{ current_revision_id: string }[]>("SELECT current_revision_id FROM knowledge_documents WHERE id = ?", [docA.documentId]);
    expect(String(unchanged[0].current_revision_id)).toBe(docA.revisionId);
    await expect(pool.query("INSERT INTO knowledge_tree_nodes (id, source_id, parent_id, node_type, name, document_id, position, status, updated_by) VALUES (UUID(), ?, NULL, 'FOLDER', NULL, NULL, 0, 'ACTIVE', ?)", [hubA.source.id, fixtureIdentity.id])).rejects.toBeTruthy();
    await expect(pool.query("INSERT INTO knowledge_tree_nodes (id, source_id, parent_id, node_type, name, document_id, position, status, updated_by) VALUES (UUID(), ?, NULL, 'DOCUMENT', NULL, NULL, 0, 'ACTIVE', ?)", [hubA.source.id, fixtureIdentity.id])).rejects.toBeTruthy();
    await expect(pool.query("INSERT INTO knowledge_tree_nodes (id, source_id, parent_id, node_type, name, document_id, position, status, updated_by) VALUES (UUID(), ?, NULL, 'DOCUMENT', NULL, ?, 0, 'ACTIVE', ?)", [hubA.source.id, docA.documentId, fixtureIdentity.id])).rejects.toBeTruthy();
    const sourceColumns = await pool.query<{ column_name: string }[]>("SELECT column_name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'knowledge_sources'");
    expect(sourceColumns.map((column) => column.column_name)).toContain("workspace_id");
    expect(sourceColumns.map((column) => column.column_name)).not.toContain("org_code");
    const actorColumns = await pool.query<{ table_name: string; column_name: string; is_nullable: string }[]>(
      "SELECT table_name, column_name, is_nullable FROM information_schema.columns WHERE table_schema = DATABASE() AND column_name = 'updated_by' ORDER BY table_name",
    );
    expect(actorColumns).toEqual([
      { table_name: "knowledge_documents", column_name: "updated_by", is_nullable: "NO" },
      { table_name: "knowledge_sources", column_name: "updated_by", is_nullable: "NO" },
      { table_name: "knowledge_tree_nodes", column_name: "updated_by", is_nullable: "NO" },
      { table_name: "source_entries", column_name: "updated_by", is_nullable: "NO" },
    ]);
  });

  it("protects SourceEntry identity scope while permitting nulls and cross-source reuse", async () => {
    const first = await createSourceFixture(pool);
    const second = await createSourceFixture(pool, { orgCode: "OTHER" });
    const firstDoc = await createDocumentFixture(pool, first.source.id, first.folderId);
    const secondDoc = await createDocumentFixture(pool, first.source.id, first.folderId);
    const crossSourceDoc = await createDocumentFixture(pool, second.source.id, second.folderId);
    await createEntryFixture(pool, first.source.id, firstDoc.documentId, "same-external");
    await expect(pool.query("INSERT INTO source_entries (id, source_id, external_id, source_path, entry_type, content_hash, document_id, status, updated_by) VALUES (UUID(), ?, 'same-external', 'other.md', 'DOCUMENT', NULL, ?, 'ACTIVE', ?)", [first.source.id, secondDoc.documentId, fixtureIdentity.id])).rejects.toBeTruthy();
    await createEntryFixture(pool, first.source.id, secondDoc.documentId, "different-external");
    await pool.query("INSERT INTO source_entries (id, source_id, external_id, source_path, entry_type, content_hash, document_id, status, updated_by) VALUES (UUID(), ?, 'same-external', 'other.md', 'DOCUMENT', NULL, ?, 'ACTIVE', ?)", [second.source.id, crossSourceDoc.documentId, fixtureIdentity.id]);
    await pool.query("INSERT INTO source_entries (id, source_id, external_id, source_path, entry_type, content_hash, document_id, status, updated_by) VALUES (UUID(), ?, NULL, 'folder-a', 'FOLDER', NULL, NULL, 'ACTIVE', ?), (UUID(), ?, NULL, 'folder-b', 'FOLDER', NULL, NULL, 'ACTIVE', ?)", [first.source.id, fixtureIdentity.id, first.source.id, fixtureIdentity.id]);
  });

  it("keeps assets metadata-only", async () => {
    const columns = await pool.query<{ column_name: string; data_type: string }[]>("SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'knowledge_assets'");
    expect(columns.some((column) => /blob|binary|longblob/i.test(column.data_type))).toBe(false);
    expect(columns.map((column) => column.column_name)).toEqual(expect.arrayContaining(["source_path", "mime_type", "content_hash", "metadata"]));
  });
});

describe("Knowledge application transactions", () => {
  it("creates, reads, revises, moves, archives, and restores with stable identity", async () => {
    const fixture = await createSourceFixture(pool);
    const service = new KnowledgeApplicationService(new MariaDbUnitOfWork(pool));
    const caller = fixtureCaller();
    const created = await service.createHubManagedDocument(caller, { sourceId: fixture.source.id, parentId: fixture.folderId, title: "Initial", markdown: "body", metadata: { a: 1 } });
    const noChange = await service.createRevision(caller, created.documentId, { title: "Initial", markdown: "body", metadata: { a: 1 } });
    expect(noChange.changed).toBe(false);
    const titleChange = await service.createRevision(caller, created.documentId, { title: "Renamed article", markdown: "body", metadata: { a: 1 } });
    expect(titleChange.changed).toBe(true);
    const metadataChange = await service.createRevision(caller, created.documentId, { title: "Renamed article", markdown: "body", metadata: { a: 2 } });
    expect(metadataChange.revisionNo).toBe(3);
    const treeBefore = await service.listTree(caller, fixture.source.id);
    expect(treeBefore.flatMap((item) => item.children).some((item) => item.documentId === created.documentId && item.name === "Renamed article")).toBe(true);
    const secondFolderId = "0199f000-0000-7000-8000-000000000999";
    await new MariaDbUnitOfWork(pool).run(async ({ tree }) => tree.insert({ id: secondFolderId, sourceId: fixture.source.id, parentId: null, nodeType: "FOLDER", name: "Second Folder", documentId: null, position: 1, status: "ACTIVE", updatedBy: fixtureIdentity.id, archivedBy: null, archivedAt: null }));
    await service.moveTreeNode(caller, (await new MariaDbUnitOfWork(pool).run(async ({ tree }) => (await tree.listBySource(fixture.source.id)).find((item) => item.documentId === created.documentId)))!.id, secondFolderId);
    await service.archiveDocument(caller, created.documentId);
    const archivedRows = await pool.query<{ document_status: string; document_updated_by: string; document_archived_by: string; document_archived_at: Date | null; tree_status: string; tree_updated_by: string; tree_archived_by: string; tree_archived_at: Date | null }[]>(
      `SELECT d.status AS document_status, d.updated_by AS document_updated_by, d.archived_by AS document_archived_by, d.archived_at AS document_archived_at,
              n.status AS tree_status, n.updated_by AS tree_updated_by, n.archived_by AS tree_archived_by, n.archived_at AS tree_archived_at
       FROM knowledge_documents d INNER JOIN knowledge_tree_nodes n ON n.document_id = d.id WHERE d.id = ?`,
      [created.documentId],
    );
    expect(archivedRows[0]).toMatchObject({ document_status: "ARCHIVED", document_updated_by: fixtureIdentity.id, document_archived_by: fixtureIdentity.id, tree_status: "ARCHIVED", tree_updated_by: fixtureIdentity.id, tree_archived_by: fixtureIdentity.id });
    expect(archivedRows[0].document_archived_at).not.toBeNull();
    expect(archivedRows[0].tree_archived_at).not.toBeNull();
    expect(await service.getDocument(caller, created.documentId)).toBeNull();
    expect((await service.listTree(caller, fixture.source.id)).flatMap((item) => item.children).some((item) => item.documentId === created.documentId)).toBe(false);
    await service.restoreDocument(caller, created.documentId);
    const restoredRows = await pool.query<{ document_status: string; document_updated_by: string; document_archived_by: string | null; document_archived_at: Date | null; tree_status: string; tree_updated_by: string; tree_archived_by: string | null; tree_archived_at: Date | null }[]>(
      `SELECT d.status AS document_status, d.updated_by AS document_updated_by, d.archived_by AS document_archived_by, d.archived_at AS document_archived_at,
              n.status AS tree_status, n.updated_by AS tree_updated_by, n.archived_by AS tree_archived_by, n.archived_at AS tree_archived_at
       FROM knowledge_documents d INNER JOIN knowledge_tree_nodes n ON n.document_id = d.id WHERE d.id = ?`,
      [created.documentId],
    );
    expect(restoredRows[0]).toEqual({ document_status: "ACTIVE", document_updated_by: fixtureIdentity.id, document_archived_by: null, document_archived_at: null, tree_status: "ACTIVE", tree_updated_by: fixtureIdentity.id, tree_archived_by: null, tree_archived_at: null });
    expect((await service.getDocument(caller, created.documentId))?.document.id).toBe(created.documentId);
  });

  it("rolls back a failed multi-repository create", async () => {
    const fixture = await createSourceFixture(pool);
    const documentId = "0199f000-0000-7000-8000-000000000998";
    const uow = new MariaDbUnitOfWork(pool);
    await expect(uow.run(async ({ documents, revisions, tree }) => {
      const now = new Date();
      await documents.insertDraft({ id: documentId, sourceId: fixture.source.id, currentRevisionId: null, status: "ACTIVE", createdBy: fixtureIdentity.id, updatedBy: fixtureIdentity.id, archivedBy: null, archivedAt: null, createdAt: now, updatedAt: now });
      await revisions.insert({ id: "0199f000-0000-7000-8000-000000000997", documentId, revisionNo: 1, title: "rollback", markdown: "rollback", metadata: {}, contentHash: "a".repeat(64), createdBy: fixtureIdentity.id, createdAt: now });
      await documents.setCurrentRevision(documentId, "0199f000-0000-7000-8000-000000000997", fixtureIdentity.id);
      await tree.insert({ id: "0199f000-0000-7000-8000-000000000996", sourceId: fixture.source.id, parentId: fixture.folderId, nodeType: "DOCUMENT", name: null, documentId, position: 0, status: "ACTIVE", updatedBy: fixtureIdentity.id, archivedBy: null, archivedAt: null });
      throw new Error("failure after tree");
    })).rejects.toThrow();
    const counts = await pool.query<{ documents: number; revisions: number; nodes: number }[]>(`SELECT (SELECT COUNT(*) FROM knowledge_documents WHERE id = ?) AS documents, (SELECT COUNT(*) FROM knowledge_revisions WHERE document_id = ?) AS revisions, (SELECT COUNT(*) FROM knowledge_tree_nodes WHERE document_id = ?) AS nodes`, [documentId, documentId, documentId]);
    expect(counts[0]).toEqual({ documents: 0, revisions: 0, nodes: 0 });
  });

  it("rejects every general Hub mutation against a SOURCE_MANAGED source", async () => {
    const fixture = await createSourceFixture(pool, { managed: true });
    const document = await createDocumentForAnySource(pool, fixture.source.id, fixture.folderId);
    const service = new KnowledgeApplicationService(new MariaDbUnitOfWork(pool));
    const caller = fixtureCaller();
    await expect(service.createRevision(caller, document.documentId, { title: "no", markdown: "no", metadata: {} })).rejects.toBeInstanceOf(SourceReadOnlyError);
    await expect(service.archiveDocument(caller, document.documentId)).rejects.toBeInstanceOf(SourceReadOnlyError);
    await expect(service.restoreDocument(caller, document.documentId)).rejects.toBeInstanceOf(SourceReadOnlyError);
    const tree = await new MariaDbUnitOfWork(pool).run(async ({ tree }) => (await tree.listBySource(fixture.source.id)).find((item) => item.documentId === document.documentId));
    await expect(service.moveTreeNode(caller, tree!.id, null)).rejects.toBeInstanceOf(SourceReadOnlyError);
    await expect(service.renameFolder(caller, fixture.folderId, "no")).rejects.toBeInstanceOf(SourceReadOnlyError);
    await expect(service.reorderNode(caller, fixture.folderId, 2)).rejects.toBeInstanceOf(SourceReadOnlyError);
  });

  it("prevents identity id/employee collisions and keeps the existing user", async () => {
    await ensureUser(pool, fixtureIdentity);
    const uow = new MariaDbUnitOfWork(pool);
    await expect(uow.run(async ({ users }) => users.upsertIdentity({ ...fixtureIdentity, id: "00000000-0000-0000-0000-000000000013" }))).rejects.toBeInstanceOf(IdentityError);
    await expect(uow.run(async ({ users }) => users.upsertIdentity({ ...fixtureIdentity, emp_id: "FIXTURE-0013" }))).rejects.toBeInstanceOf(IdentityError);
    const row = await pool.query<{ id: string; emp_id: string }[]>("SELECT id, emp_id FROM users WHERE emp_id = ?", [fixtureIdentity.emp_id]);
    expect(row).toEqual([{ id: fixtureIdentity.id, emp_id: fixtureIdentity.emp_id }]);
  });

  it("rolls back at each create stage and leaves no orphan rows", async () => {
    const fixture = await createSourceFixture(pool);
    const stages = ["document", "revision", "pointer", "tree"] as const;
    for (const [index, stage] of stages.entries()) {
      const documentId = `0199f000-0000-7000-8000-0000000009${String(index + 10).padStart(2, "0")}`;
      const revisionId = `0199f000-0000-7000-8000-0000000008${String(index + 10).padStart(2, "0")}`;
      const treeId = `0199f000-0000-7000-8000-0000000007${String(index + 10).padStart(2, "0")}`;
      await expect(new MariaDbUnitOfWork(pool).run(async ({ documents, revisions, tree }) => {
        const now = new Date();
        await documents.insertDraft({ id: documentId, sourceId: fixture.source.id, currentRevisionId: null, status: "ACTIVE", createdBy: fixtureIdentity.id, updatedBy: fixtureIdentity.id, archivedBy: null, archivedAt: null, createdAt: now, updatedAt: now });
        if (stage === "document") throw new Error("after document");
        await revisions.insert({ id: revisionId, documentId, revisionNo: 1, title: "stage", markdown: "stage", metadata: {}, contentHash: "c".repeat(64), createdBy: fixtureIdentity.id, createdAt: now });
        if (stage === "revision") throw new Error("after revision");
        await documents.setCurrentRevision(documentId, revisionId, fixtureIdentity.id);
        if (stage === "pointer") throw new Error("after pointer");
        await tree.insert({ id: treeId, sourceId: fixture.source.id, parentId: fixture.folderId, nodeType: "DOCUMENT", name: null, documentId, position: 0, status: "ACTIVE", updatedBy: fixtureIdentity.id, archivedBy: null, archivedAt: null });
        if (stage === "tree") throw new Error("after tree");
      })).rejects.toThrow();
      const counts = await pool.query<{ documents: number; revisions: number; nodes: number }[]>("SELECT (SELECT COUNT(*) FROM knowledge_documents WHERE id = ?) AS documents, (SELECT COUNT(*) FROM knowledge_revisions WHERE document_id = ?) AS revisions, (SELECT COUNT(*) FROM knowledge_tree_nodes WHERE document_id = ?) AS nodes", [documentId, documentId, documentId]);
      expect(counts[0]).toEqual({ documents: 0, revisions: 0, nodes: 0 });
    }
  });

  it("blocks concurrent moves from forming a cycle and serializes revision numbers", async () => {
    const fixture = await createSourceFixture(pool);
    const folderB = "0199f000-0000-7000-8000-000000000991";
    await new MariaDbUnitOfWork(pool).run(async ({ tree }) => tree.insert({ id: folderB, sourceId: fixture.source.id, parentId: null, nodeType: "FOLDER", name: "Folder B", documentId: null, position: 1, status: "ACTIVE", updatedBy: fixtureIdentity.id, archivedBy: null, archivedAt: null }));
    await ensureUser(pool, secondFixtureIdentity);
    let firstLocked!: () => void;
    let secondReached!: () => void;
    const firstLock = new Promise<void>((resolve) => { firstLocked = resolve; });
    const secondLockAttempt = new Promise<void>((resolve) => { secondReached = resolve; });
    const serviceA = new KnowledgeApplicationService(withSourceLockHook(new MariaDbUnitOfWork(pool), async (_sourceId, lock) => {
      const source = await lock();
      firstLocked();
      await secondLockAttempt;
      return source;
    }));
    const serviceB = new KnowledgeApplicationService(withSourceLockHook(new MariaDbUnitOfWork(pool), async (_sourceId, lock) => {
      secondReached();
      return lock();
    }));
    const moveA = serviceA.moveTreeNode(fixtureCaller(), fixture.folderId, folderB);
    await firstLock;
    const moveB = serviceB.moveTreeNode(fixtureCaller(secondFixtureIdentity), folderB, fixture.folderId);
    const moves = await Promise.allSettled([moveA, moveB]);
    expect(moves.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const nodes = await new MariaDbUnitOfWork(pool).run(async ({ tree }) => tree.listBySource(fixture.source.id));
    expect(nodes.some((node) => node.id === fixture.folderId && node.parentId === folderB) || nodes.some((node) => node.id === folderB && node.parentId === fixture.folderId)).toBe(true);
    expect(nodes.some((node) => node.id === fixture.folderId && node.parentId === folderB && nodes.find((other) => other.id === folderB)?.parentId === fixture.folderId)).toBe(false);

    const doc = await createDocumentFixture(pool, fixture.source.id, fixture.folderId);
    const revisionServiceA = new KnowledgeApplicationService(new MariaDbUnitOfWork(pool));
    const revisionServiceB = new KnowledgeApplicationService(new MariaDbUnitOfWork(pool));
    const revisions = await Promise.all([revisionServiceA.createRevision(fixtureCaller(), doc.documentId, { title: "A", markdown: "A", metadata: {} }), revisionServiceB.createRevision(fixtureCaller(secondFixtureIdentity), doc.documentId, { title: "B", markdown: "B", metadata: {} })]);
    expect(new Set(revisions.map((revision) => revision.revisionNo))).toEqual(new Set([2, 3]));
  });

  it("rejects archived or cross-source ancestors and does not reparent on restore", async () => {
    const first = await createSourceFixture(pool);
    const second = await createSourceFixture(pool, { orgCode: "OTHER" });
    const nested = "0199f000-0000-7000-8000-000000000992";
    await new MariaDbUnitOfWork(pool).run(async ({ tree }) => tree.insert({ id: nested, sourceId: first.source.id, parentId: first.folderId, nodeType: "FOLDER", name: "Nested", documentId: null, position: 1, status: "ACTIVE", updatedBy: fixtureIdentity.id, archivedBy: null, archivedAt: null }));
    await pool.query("UPDATE knowledge_tree_nodes SET status = 'ARCHIVED', updated_by = ?, archived_by = ?, archived_at = CURRENT_TIMESTAMP(6) WHERE id = ?", [fixtureIdentity.id, fixtureIdentity.id, first.folderId]);
    const service = new KnowledgeApplicationService(new MariaDbUnitOfWork(pool));
    const caller = fixtureCaller();
    await expect(service.createHubManagedDocument(caller, { sourceId: first.source.id, parentId: nested, title: "No", markdown: "No", metadata: {} })).rejects.toThrow();
    await expect(service.moveTreeNode(caller, nested, second.folderId)).rejects.toThrow();
    const document = await createDocumentForAnySource(pool, first.source.id, first.folderId);
    await service.archiveDocument(caller, document.documentId);
    await new MariaDbUnitOfWork(pool).run(async ({ tree }) => tree.updateParent((await tree.listBySource(first.source.id)).find((node) => node.documentId === document.documentId)!.id, nested, fixtureIdentity.id));
    await expect(service.restoreDocument(caller, document.documentId)).rejects.toThrow();
  });

  it("runs the fixed development seed twice without duplicates in an isolated database", async () => {
    const names = ["KM_DB_NAME", "KM_DB_USER", "KM_DB_PASSWORD", "KM_LOCAL_IDENTITY_ENABLED", "KM_LOCAL_ID", "KM_LOCAL_EMP_ID", "KM_LOCAL_NAME", "KM_LOCAL_ORG_CODE"];
    const previous = new Map(names.map((name) => [name, process.env[name]]));
    try {
      process.env.KM_DB_NAME = process.env.KM_TEST_DB_NAME;
      process.env.KM_DB_USER = process.env.KM_TEST_DB_USER ?? "root";
      process.env.KM_DB_PASSWORD = process.env.KM_TEST_DB_PASSWORD ?? "hcm_km_root";
      process.env.KM_LOCAL_IDENTITY_ENABLED = "true";
      const configuredIdentityId = "0199f000-0000-7000-8000-000000000909";
      process.env.KM_LOCAL_ID = configuredIdentityId;
      process.env.KM_LOCAL_EMP_ID = "SEED-LOCAL";
      process.env.KM_LOCAL_NAME = "Seed User";
      process.env.KM_LOCAL_ORG_CODE = "SEED";
      await seedDevelopmentDatabase();
      await seedDevelopmentDatabase();
      expect(await pool.query("SELECT id FROM users WHERE id = ?", [configuredIdentityId])).toHaveLength(1);
      expect(await pool.query("SELECT id FROM knowledge_sources WHERE id = ?", [DEV_FIXTURE_IDS.source])).toHaveLength(1);
      expect(await pool.query("SELECT id FROM knowledge_tree_nodes WHERE id = ?", [DEV_FIXTURE_IDS.folder])).toHaveLength(1);
      expect(await pool.query<{ created_by: string }[]>("SELECT created_by FROM knowledge_sources WHERE id = ?", [DEV_FIXTURE_IDS.source])).toEqual([{ created_by: configuredIdentityId }]);
      const seededTree = await new KnowledgeApplicationService(new MariaDbUnitOfWork(pool)).listTree(fixtureCaller({ id: configuredIdentityId, emp_id: "SEED-LOCAL", name: "Seed User", org_code: "SEED" }), DEV_FIXTURE_IDS.source);
      expect(seededTree).toEqual([{ id: DEV_FIXTURE_IDS.folder, nodeType: "FOLDER", name: "Getting Started", documentId: null, children: [] }]);
    } finally {
      for (const name of names) {
        const value = previous.get(name);
        if (value === undefined) delete process.env[name]; else process.env[name] = value;
      }
    }
  });
});
