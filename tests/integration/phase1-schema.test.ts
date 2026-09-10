import { describe, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { runMigrations, type IsolatedDatabaseHandle } from "../../scripts/db/migrate";
import { migrations } from "@/infrastructure/database/mariadb/migrations";
import { coreMigration } from "@/infrastructure/database/mariadb/migrations/001-core";
import { currentRevisionMigration } from "@/infrastructure/database/mariadb/migrations/002-current-revision";
import { requiredLifecycleActorsMigration } from "@/infrastructure/database/mariadb/migrations/003-required-lifecycle-actors";
import { applySourceTreeMapping, preflightSourceTreeMapping } from "../../scripts/db/backfill-source-tree-mapping";
import { assertFolderTargetNode } from "@/infrastructure/database/mariadb/mapping-validation";
import { disposeIsolatedDatabase, provisionIsolatedDatabase } from "../../scripts/db/test-database";
import { fixtureIdentity, secondFixtureIdentity } from "../fixtures/knowledge";
import { uuidv7 } from "@/shared/ids/uuidv7";

const phase0Manifest = [coreMigration, currentRevisionMigration, requiredLifecycleActorsMigration];

async function createIsolatedPool(): Promise<{ handle: IsolatedDatabaseHandle; pool: Pool }> {
  const handle = await provisionIsolatedDatabase("test");
  const previous = process.env.KM_TEST_DB_NAME;
  process.env.KM_TEST_DB_NAME = handle.databaseName;
  try {
    return { handle, pool: createDatabasePool(databaseConfig("test")) };
  } finally {
    if (previous === undefined) delete process.env.KM_TEST_DB_NAME;
    else process.env.KM_TEST_DB_NAME = previous;
  }
}

async function disposePool(handle: IsolatedDatabaseHandle, pool: Pool): Promise<void> {
  await pool.end();
  await disposeIsolatedDatabase(handle);
}

type PopulatedIds = {
  sourceId: string;
  folderId: string;
  folderEntryId: string;
  docId: string;
  docNodeId: string;
  docEntryId: string;
  archivedDocId: string;
  archivedNodeId: string;
  archivedEntryId: string;
};

async function seedPhase0Populated(pool: Pool, options: { folderEntry?: boolean } = {}): Promise<PopulatedIds> {
  const withFolderEntry = options.folderEntry !== false;
  const ids: PopulatedIds = {
    sourceId: uuidv7(), folderId: uuidv7(), folderEntryId: uuidv7(),
    docId: uuidv7(), docNodeId: uuidv7(), docEntryId: uuidv7(),
    archivedDocId: uuidv7(), archivedNodeId: uuidv7(), archivedEntryId: uuidv7(),
  };
  const user = fixtureIdentity.id;
  await pool.query("INSERT INTO users (id, emp_id, name, org_code) VALUES (?, ?, ?, ?), (?, ?, ?, ?) ON DUPLICATE KEY UPDATE name = VALUES(name)", [
    user, fixtureIdentity.emp_id, fixtureIdentity.name, fixtureIdentity.org_code,
    secondFixtureIdentity.id, secondFixtureIdentity.emp_id, secondFixtureIdentity.name, secondFixtureIdentity.org_code,
  ]);
  const workspaceId = uuidv7();
  await pool.query("INSERT INTO workspaces (id, name) VALUES (?, 'Upgrade Workspace')", [workspaceId]);
  await pool.query("INSERT INTO workspace_memberships (workspace_id, user_id) VALUES (?, ?), (?, ?)", [workspaceId, user, workspaceId, secondFixtureIdentity.id]);
  await pool.query(
    "INSERT INTO knowledge_sources (id, name, workspace_id, source_type, ownership, status, sync_version, created_by, updated_by) VALUES (?, 'Upgrade Source', ?, 'HUB', 'HUB_MANAGED', 'ACTIVE', 0, ?, ?)",
    [ids.sourceId, workspaceId, user, user],
  );
  await pool.query(
    "INSERT INTO knowledge_tree_nodes (id, source_id, parent_id, node_type, name, document_id, position, status, updated_by) VALUES (?, ?, NULL, 'FOLDER', 'Upgrade Folder', NULL, 0, 'ACTIVE', ?)",
    [ids.folderId, ids.sourceId, user],
  );
  for (const [docId, status, archived] of [[ids.docId, "ACTIVE", false], [ids.archivedDocId, "ARCHIVED", true]] as const) {
    await pool.query(
      "INSERT INTO knowledge_documents (id, source_id, current_revision_id, status, created_by, updated_by, archived_by, archived_at) VALUES (?, ?, NULL, ?, ?, ?, ?, ?)",
      [docId, ids.sourceId, status, user, user, archived ? user : null, archived ? new Date() : null],
    );
  }
  const revisionId = uuidv7();
  const archivedRevisionId = uuidv7();
  await pool.query(
    "INSERT INTO knowledge_revisions (id, document_id, revision_no, title, markdown, metadata, content_hash, created_by) VALUES (?, ?, 1, 'Upgrade Doc', 'body', ?, ?, ?), (?, ?, 1, 'Archived Doc', 'body', ?, ?, ?)",
    [revisionId, ids.docId, JSON.stringify({ seed: true }), "a".repeat(64), user, archivedRevisionId, ids.archivedDocId, JSON.stringify({ seed: true }), "b".repeat(64), user],
  );
  await pool.query("UPDATE knowledge_documents SET current_revision_id = ? WHERE id = ?", [revisionId, ids.docId]);
  await pool.query("UPDATE knowledge_documents SET current_revision_id = ? WHERE id = ?", [archivedRevisionId, ids.archivedDocId]);
  await pool.query(
    "INSERT INTO knowledge_tree_nodes (id, source_id, parent_id, node_type, name, document_id, position, status, updated_by) VALUES (?, ?, ?, 'DOCUMENT', NULL, ?, 0, 'ACTIVE', ?)",
    [ids.docNodeId, ids.sourceId, ids.folderId, ids.docId, user],
  );
  await pool.query(
    "INSERT INTO knowledge_tree_nodes (id, source_id, parent_id, node_type, name, document_id, position, status, updated_by, archived_by, archived_at) VALUES (?, ?, ?, 'DOCUMENT', NULL, ?, 0, 'ARCHIVED', ?, ?, CURRENT_TIMESTAMP(6))",
    [ids.archivedNodeId, ids.sourceId, ids.folderId, ids.archivedDocId, user, user],
  );
  await pool.query(
    "INSERT INTO source_entries (id, source_id, external_id, source_path, entry_type, content_hash, document_id, status, updated_by) VALUES (?, ?, 'upgrade-doc', 'docs/upgrade.md', 'DOCUMENT', NULL, ?, 'ACTIVE', ?)",
    [ids.docEntryId, ids.sourceId, ids.docId, user],
  );
  await pool.query(
    "INSERT INTO source_entries (id, source_id, external_id, source_path, entry_type, content_hash, document_id, status, updated_by, archived_by, archived_at) VALUES (?, ?, 'upgrade-archived', 'docs/archived.md', 'DOCUMENT', NULL, ?, 'ARCHIVED', ?, ?, CURRENT_TIMESTAMP(6))",
    [ids.archivedEntryId, ids.sourceId, ids.archivedDocId, user, user],
  );
  if (withFolderEntry) {
    await pool.query(
      "INSERT INTO source_entries (id, source_id, external_id, source_path, entry_type, content_hash, document_id, status, updated_by) VALUES (?, ?, NULL, 'docs', 'FOLDER', NULL, NULL, 'ACTIVE', ?)",
      [ids.folderEntryId, ids.sourceId, user],
    );
  }
  return ids;
}

async function ledgerRows(pool: Pool): Promise<{ version: number; state: string; checksum: string }[]> {
  return pool.query("SELECT version, name, checksum, state FROM schema_migrations ORDER BY version").then((rows) =>
    (rows as { version: number; state: string; checksum: string }[]).map((row) => ({ version: Number(row.version), state: row.state, checksum: row.checksum })),
  );
}

async function snapshotEntries(pool: Pool): Promise<unknown> {
  return pool.query("SELECT id, source_id, entry_type, document_id, status FROM source_entries ORDER BY id");
}

describe("phase 1 source mapping schema upgrade", () => {
  it("upgrades populated 001–003 data through 004, backfill, and 005 with archived rows preserved", async () => {
    const { handle, pool } = await createIsolatedPool();
    try {
      await runMigrations(pool, phase0Manifest);
      const ids = await seedPhase0Populated(pool);
      const folders = { [ids.folderEntryId]: ids.folderId };

      await runMigrations(pool, migrations, { to: 4 });
      expect((await ledgerRows(pool)).map((row) => row.version)).toEqual([1, 2, 3, 4]);

      const preview = await preflightSourceTreeMapping(pool, folders);
      expect(preview.ready).toBe(true);
      expect(preview.totalEntries).toBe(3);
      expect(preview.pendingUpdates).toBe(3);

      const result = await applySourceTreeMapping(pool, folders);
      expect(result).toEqual({ applied: 3, alreadyApplied: 0, totalEntries: 3 });

      await runMigrations(pool, migrations, { to: 5 });
      const rows = await pool.query<{ id: unknown; tree_node_id: unknown; status: unknown }[]>("SELECT id, tree_node_id, status FROM source_entries ORDER BY id");
      expect(rows).toHaveLength(3);
      for (const row of rows) expect(row.tree_node_id).not.toBeNull();
      expect(rows.find((row) => String(row.id) === ids.docEntryId)?.tree_node_id).toBe(ids.docNodeId);
      expect(rows.find((row) => String(row.id) === ids.folderEntryId)?.tree_node_id).toBe(ids.folderId);
      expect(rows.find((row) => String(row.id) === ids.archivedEntryId)?.status).toBe("ARCHIVED");

      const ledger = await ledgerRows(pool);
      expect(ledger.map((row) => `${row.version}:${row.state}`)).toEqual(["1:APPLIED", "2:APPLIED", "3:APPLIED", "4:APPLIED", "5:APPLIED"]);
      await runMigrations(pool, migrations);
      expect(await ledgerRows(pool)).toEqual(ledger);
    } finally {
      await disposePool(handle, pool);
    }
  });

  it("supports pre-004 preflight and leaves data and schema untouched", async () => {
    const { handle, pool } = await createIsolatedPool();
    try {
      await runMigrations(pool, phase0Manifest);
      const ids = await seedPhase0Populated(pool);
      const beforeEntries = await snapshotEntries(pool);
      const beforeLedger = await ledgerRows(pool);

      const preview = await preflightSourceTreeMapping(pool, { [ids.folderEntryId]: ids.folderId });
      expect(preview.ready).toBe(true);
      expect(preview.pendingUpdates).toBe(3);

      expect(await snapshotEntries(pool)).toEqual(beforeEntries);
      expect(await ledgerRows(pool)).toEqual(beforeLedger);
      const columns = await pool.query<{ column_name: string }[]>("SELECT column_name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'source_entries'");
      expect(columns.map((column) => column.column_name)).not.toContain("tree_node_id");
    } finally {
      await disposePool(handle, pool);
    }
  });

  it("rejects incomplete folder mapping without writes", async () => {
    const { handle, pool } = await createIsolatedPool();
    try {
      await runMigrations(pool, phase0Manifest);
      await seedPhase0Populated(pool);
      await runMigrations(pool, migrations, { to: 4 });
      const before = await snapshotEntries(pool);

      const preview = await preflightSourceTreeMapping(pool, {});
      expect(preview.ready).toBe(false);
      expect(preview.issues.some((issue) => issue.code === "INCOMPLETE_MAPPING")).toBe(true);
      await expect(applySourceTreeMapping(pool, {})).rejects.toThrow(/backfill refused/);
      expect(await snapshotEntries(pool)).toEqual(before);
    } finally {
      await disposePool(handle, pool);
    }
  });

  it("rejects wrong-type, cross-source, and duplicate mappings without writes", async () => {
    const { handle, pool } = await createIsolatedPool();
    try {
      await runMigrations(pool, phase0Manifest);
      const ids = await seedPhase0Populated(pool);
      await runMigrations(pool, migrations, { to: 4 });
      const before = await snapshotEntries(pool);

      const wrongType = await preflightSourceTreeMapping(pool, { [ids.folderEntryId]: ids.docNodeId });
      expect(wrongType.ready).toBe(false);
      expect(wrongType.issues.some((issue) => issue.code === "WRONG_NODE_TYPE")).toBe(true);

      const other = await seedPhase0Populated(pool, { folderEntry: false });
      const crossSource = await preflightSourceTreeMapping(pool, { [ids.folderEntryId]: other.folderId });
      expect(crossSource.ready).toBe(false);
      expect(crossSource.issues.some((issue) => issue.code === "CROSS_SOURCE_MAPPING")).toBe(true);

      const secondFolderEntry = uuidv7();
      await pool.query(
        "INSERT INTO source_entries (id, source_id, external_id, source_path, entry_type, content_hash, document_id, tree_node_id, status, updated_by) VALUES (?, ?, NULL, 'docs/second', 'FOLDER', NULL, NULL, NULL, 'ACTIVE', ?)",
        [secondFolderEntry, ids.sourceId, fixtureIdentity.id],
      );
      const duplicate = await preflightSourceTreeMapping(pool, { [ids.folderEntryId]: ids.folderId, [secondFolderEntry]: ids.folderId });
      expect(duplicate.ready).toBe(false);
      expect(duplicate.issues.some((issue) => issue.code === "DUPLICATE_NODE_MAPPING")).toBe(true);
      await pool.query("DELETE FROM source_entries WHERE id = ?", [secondFolderEntry]);

      const settled = await snapshotEntries(pool);
      await expect(applySourceTreeMapping(pool, { [ids.folderEntryId]: ids.docNodeId })).rejects.toThrow(/backfill refused/);
      expect(await snapshotEntries(pool)).toEqual(settled);
      expect(before).toHaveLength(3);
    } finally {
      await disposePool(handle, pool);
    }
  });

  it("rejects conflicting existing mapping as one all-or-nothing batch", async () => {
    const { handle, pool } = await createIsolatedPool();
    try {
      await runMigrations(pool, phase0Manifest);
      const ids = await seedPhase0Populated(pool);
      await runMigrations(pool, migrations, { to: 4 });
      await pool.query("UPDATE source_entries SET tree_node_id = ? WHERE id = ?", [ids.folderId, ids.docEntryId]);
      const before = await pool.query("SELECT id, tree_node_id FROM source_entries ORDER BY id");

      await expect(applySourceTreeMapping(pool, { [ids.folderEntryId]: ids.folderId })).rejects.toThrow(/backfill refused/);
      expect(await pool.query("SELECT id, tree_node_id FROM source_entries ORDER BY id")).toEqual(before);

      await pool.query("UPDATE source_entries SET tree_node_id = NULL WHERE id = ?", [ids.docEntryId]);
      const result = await applySourceTreeMapping(pool, { [ids.folderEntryId]: ids.folderId });
      expect(result).toEqual({ applied: 3, alreadyApplied: 0, totalEntries: 3 });
    } finally {
      await disposePool(handle, pool);
    }
  });

  it("reruns idempotently and reports zero pending changes", async () => {
    const { handle, pool } = await createIsolatedPool();
    try {
      await runMigrations(pool, phase0Manifest);
      const ids = await seedPhase0Populated(pool);
      await runMigrations(pool, migrations, { to: 4 });
      const folders = { [ids.folderEntryId]: ids.folderId };
      await applySourceTreeMapping(pool, folders);

      const second = await applySourceTreeMapping(pool, folders);
      expect(second).toEqual({ applied: 0, alreadyApplied: 3, totalEntries: 3 });
      const preview = await preflightSourceTreeMapping(pool, folders);
      expect(preview.ready).toBe(true);
      expect(preview.pendingUpdates).toBe(0);

      await runMigrations(pool, migrations, { to: 5 });
      await runMigrations(pool, migrations);
    } finally {
      await disposePool(handle, pool);
    }
  });

  it("blocks 005 on incomplete mapping without ledger pollution, then recovers", async () => {
    const { handle, pool } = await createIsolatedPool();
    try {
      await runMigrations(pool, phase0Manifest);
      const ids = await seedPhase0Populated(pool);
      await runMigrations(pool, migrations, { to: 4 });

      await expect(runMigrations(pool, migrations, { to: 5 })).rejects.toThrow(/not ready/);
      const ledger = await ledgerRows(pool);
      expect(ledger.map((row) => row.version)).toEqual([1, 2, 3, 4]);
      expect(ledger.every((row) => row.state === "APPLIED")).toBe(true);

      await applySourceTreeMapping(pool, { [ids.folderEntryId]: ids.folderId });
      await runMigrations(pool, migrations, { to: 5 });
      expect((await ledgerRows(pool)).map((row) => `${row.version}:${row.state}`)).toEqual(["1:APPLIED", "2:APPLIED", "3:APPLIED", "4:APPLIED", "5:APPLIED"]);
    } finally {
      await disposePool(handle, pool);
    }
  });

  it("stops untargeted migrate at the 005 gate and recovers without ledger repair", async () => {
    const { handle, pool } = await createIsolatedPool();
    try {
      await runMigrations(pool, phase0Manifest);
      const ids = await seedPhase0Populated(pool);

      await expect(runMigrations(pool, migrations)).rejects.toThrow(/not ready/);
      const ledger = await ledgerRows(pool);
      expect(ledger.map((row) => `${row.version}:${row.state}`)).toEqual(["1:APPLIED", "2:APPLIED", "3:APPLIED", "4:APPLIED"]);

      await applySourceTreeMapping(pool, { [ids.folderEntryId]: ids.folderId });
      await runMigrations(pool, migrations);
      expect((await ledgerRows(pool)).map((row) => `${row.version}:${row.state}`)).toEqual(["1:APPLIED", "2:APPLIED", "3:APPLIED", "4:APPLIED", "5:APPLIED"]);
    } finally {
      await disposePool(handle, pool);
    }
  });

  it("migrates a database without pending entries directly and accepts an empty folder mapping", async () => {
    const { handle, pool } = await createIsolatedPool();
    try {
      await runMigrations(pool, phase0Manifest);
      await runMigrations(pool, migrations);
      expect((await ledgerRows(pool)).map((row) => row.version)).toEqual([1, 2, 3, 4, 5]);

      const { handle: secondHandle, pool: secondPool } = await createIsolatedPool();
      try {
        await runMigrations(secondPool, phase0Manifest);
        const ids = await seedPhase0Populated(secondPool, { folderEntry: false });
        await runMigrations(secondPool, migrations, { to: 4 });
        const result = await applySourceTreeMapping(secondPool, {});
        expect(result).toEqual({ applied: 2, alreadyApplied: 0, totalEntries: 2 });
        await runMigrations(secondPool, migrations);
        void ids;
      } finally {
        await disposePool(secondHandle, secondPool);
      }
    } finally {
      await disposePool(handle, pool);
    }
  });

  it("produces identical tables on fresh and upgraded databases", async () => {
    const fresh = await createIsolatedPool();
    const upgraded = await createIsolatedPool();
    try {
      await runMigrations(fresh.pool, migrations);
      await runMigrations(upgraded.pool, phase0Manifest);
      const ids = await seedPhase0Populated(upgraded.pool);
      await runMigrations(upgraded.pool, migrations, { to: 4 });
      await applySourceTreeMapping(upgraded.pool, { [ids.folderEntryId]: ids.folderId });
      await runMigrations(upgraded.pool, migrations);

      for (const table of ["source_entries", "knowledge_tree_nodes"]) {
        const freshCreate = await fresh.pool.query<{ Table: string; "Create Table": string }[]>(`SHOW CREATE TABLE \`${table}\``);
        const upgradedCreate = await upgraded.pool.query<{ Table: string; "Create Table": string }[]>(`SHOW CREATE TABLE \`${table}\``);
        expect(upgradedCreate[0]["Create Table"]).toBe(freshCreate[0]["Create Table"]);
      }
    } finally {
      await disposePool(fresh.handle, fresh.pool);
      await disposePool(upgraded.handle, upgraded.pool);
    }
  });

  it("enforces the 005 same-source, document-equality, and uniqueness constraints", async () => {
    const { handle, pool } = await createIsolatedPool();
    try {
      await runMigrations(pool, phase0Manifest);
      const ids = await seedPhase0Populated(pool);
      const other = await seedPhase0Populated(pool, { folderEntry: false });
      await runMigrations(pool, migrations, { to: 4 });
      const folders = { [ids.folderEntryId]: ids.folderId };
      await applySourceTreeMapping(pool, folders);
      await runMigrations(pool, migrations, { to: 5 });

      await expect(pool.query(
        "INSERT INTO source_entries (id, source_id, external_id, source_path, entry_type, content_hash, document_id, tree_node_id, status, updated_by) VALUES (UUID(), ?, 'x-null', 'x.md', 'DOCUMENT', NULL, ?, NULL, 'ACTIVE', ?)",
        [ids.sourceId, ids.docId, fixtureIdentity.id],
      )).rejects.toBeTruthy();

      await expect(pool.query(
        "INSERT INTO source_entries (id, source_id, external_id, source_path, entry_type, content_hash, document_id, tree_node_id, status, updated_by) VALUES (UUID(), ?, 'x-cross', 'x.md', 'DOCUMENT', NULL, ?, ?, 'ACTIVE', ?)",
        [ids.sourceId, ids.docId, ids.archivedNodeId, fixtureIdentity.id],
      )).rejects.toBeTruthy();

      await expect(pool.query(
        "INSERT INTO source_entries (id, source_id, external_id, source_path, entry_type, content_hash, document_id, tree_node_id, status, updated_by) VALUES (UUID(), ?, 'x-dup', 'x.md', 'FOLDER', NULL, NULL, ?, 'ACTIVE', ?)",
        [ids.sourceId, ids.folderId, fixtureIdentity.id],
      )).rejects.toBeTruthy();

      await expect(pool.query(
        "INSERT INTO source_entries (id, source_id, external_id, source_path, entry_type, content_hash, document_id, tree_node_id, status, updated_by) VALUES (UUID(), ?, 'x-other-source', 'x.md', 'FOLDER', NULL, NULL, ?, 'ACTIVE', ?)",
        [other.sourceId, ids.folderId, fixtureIdentity.id],
      )).rejects.toBeTruthy();

      await expect(pool.query(
        "INSERT INTO knowledge_tree_nodes (id, source_id, parent_id, node_type, name, document_id, position, status, updated_by) VALUES (UUID(), ?, NULL, 'DOCUMENT', NULL, ?, 0, 'ACTIVE', ?)",
        [ids.sourceId, ids.docId, fixtureIdentity.id],
      )).rejects.toBeTruthy();

      await expect(pool.query(
        "INSERT INTO source_entries (id, source_id, external_id, source_path, entry_type, content_hash, document_id, tree_node_id, status, updated_by) VALUES (UUID(), ?, 'x-same-doc', 'y.md', 'DOCUMENT', NULL, ?, ?, 'ACTIVE', ?)",
        [ids.sourceId, ids.docId, ids.docNodeId, fixtureIdentity.id],
      )).rejects.toBeTruthy();
    } finally {
      await disposePool(handle, pool);
    }
  });

  it("asserts folder target node type at the application boundary", () => {
    expect(() => assertFolderTargetNode("FOLDER", "entry-id")).not.toThrow();
    try {
      assertFolderTargetNode("DOCUMENT", "entry-id");
      expect.unreachable();
    } catch (error) {
      expect((error as { code?: string }).code).toBe("INVALID_SOURCE_MAPPING");
    }
  });
});
