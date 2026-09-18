import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbImportSnapshotRepository } from "@/infrastructure/database/mariadb/repositories/import-snapshots";
import { MariaDbAssetRepository } from "@/infrastructure/database/mariadb/repositories/assets";
import { uuidv7 } from "@/shared/ids/uuidv7";

let pool: Pool;

beforeAll(() => {
  pool = createDatabasePool(databaseConfig("test"));
});

afterAll(async () => {
  await pool.end();
});

async function seedTarget(): Promise<{ userId: string; workspaceId: string; sourceId: string }> {
  const userId = uuidv7();
  const workspaceId = uuidv7();
  const sourceId = uuidv7();
  await pool.query("INSERT INTO users (id, emp_id, name, org_code) VALUES (?, ?, 'Phase 2 User', 'P2')", [userId, `p2-${userId}`]);
  // Canonical governance shape (migration 009 forbids governance-less rows):
  // TEAM workspace plus an OWNER/DIRECT membership for the fixture user.
  await pool.query("INSERT INTO workspaces (id, name, workspace_type) VALUES (?, 'Phase 2 Workspace', 'TEAM')", [workspaceId]);
  await pool.query("INSERT INTO workspace_memberships (workspace_id, user_id, role, membership_source) VALUES (?, ?, 'OWNER', 'DIRECT')", [workspaceId, userId]);
  await pool.query(
    "INSERT INTO knowledge_sources (id, name, workspace_id, source_type, ownership, status, sync_version, created_by, updated_by) VALUES (?, 'Phase 2 Source', ?, 'FOLDER_SYNC', 'SOURCE_MANAGED', 'ACTIVE', 7, ?, ?)",
    [sourceId, workspaceId, userId, userId],
  );
  return { userId, workspaceId, sourceId };
}

function snapshotValues(input: {
  id: string;
  workspaceId: string;
  sourceId: string | null;
  basedOnVersion: number | null;
  createdBy: string;
  proposedSourceName: string | null;
}): unknown[] {
  return [
    input.id,
    input.workspaceId,
    input.sourceId,
    input.basedOnVersion,
    input.createdBy,
    "wiki",
    input.proposedSourceName,
    "GENERIC_MARKDOWN_FOLDER",
    "phase2:v1",
    "phase2:v1",
    "BUILDING",
    "a".repeat(64),
    false,
    new Date(),
    new Date(Date.now() + 60_000),
  ];
}

const insertSnapshotSql = `INSERT INTO source_import_snapshots (
  id, workspace_id, source_id, based_on_version, created_by, root_name, proposed_source_name,
  adapter_type, adapter_version, plan_version, state, manifest_hash, has_blockers, created_at, expires_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

describe("Phase 2 import persistence schema", () => {
  it("applies migrations 006, 007 and 010", async () => {
    const rows = await pool.query<{ version: number; state: string }[]>(
      "SELECT version, state FROM schema_migrations WHERE version IN (6, 7, 10) ORDER BY version",
    );
    expect(rows.map((row) => [Number(row.version), row.state])).toEqual([
      [6, "APPLIED"],
      [7, "APPLIED"],
      [10, "APPLIED"],
    ]);
  });

  it("persists staging identity with the source-entry storage contract", async () => {
    const columns = await pool.query<{ COLUMN_NAME: string; CHARACTER_MAXIMUM_LENGTH: number; COLLATION_NAME: string }[]>(
      "SELECT COLUMN_NAME, CHARACTER_MAXIMUM_LENGTH, COLLATION_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'source_import_snapshot_entries' AND COLUMN_NAME = 'external_id'",
    );
    expect(columns).toEqual([expect.objectContaining({ COLUMN_NAME: "external_id", CHARACTER_MAXIMUM_LENGTH: 512, COLLATION_NAME: "utf8mb4_bin" })]);
  });

  it("creates the staging indexes and enforces initial/resync binding shape", async () => {
    const entryIndexes = await pool.query<{ INDEX_NAME: string }[]>(
      "SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'source_import_snapshot_entries'",
    );
    const entryNames = [...new Set(entryIndexes.map((row) => row.INDEX_NAME))].sort();
    expect(entryNames).toEqual(
      expect.arrayContaining([
        "uq_import_entries_snapshot_upload",
        "uq_import_entries_snapshot_path_hash",
        "idx_import_entries_snapshot_upload",
      ]),
    );

    const snapshotIndexes = await pool.query<{ INDEX_NAME: string }[]>(
      "SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'source_import_snapshots'",
    );
    const snapshotNames = [...new Set(snapshotIndexes.map((row) => row.INDEX_NAME))].sort();
    expect(snapshotNames).toEqual(
      expect.arrayContaining([
        "idx_import_snapshots_creator_state",
        "idx_import_snapshots_source_created",
        "idx_import_snapshots_workspace_created",
        "idx_import_snapshots_state_expires",
      ]),
    );

    const { userId, workspaceId, sourceId } = await seedTarget();
    await expect(
      pool.query(insertSnapshotSql, snapshotValues({
        id: uuidv7(), workspaceId, sourceId: null, basedOnVersion: null, createdBy: userId, proposedSourceName: null,
      })),
    ).rejects.toThrow();
    await expect(
      pool.query(insertSnapshotSql, snapshotValues({
        id: uuidv7(), workspaceId, sourceId, basedOnVersion: null, createdBy: userId, proposedSourceName: null,
      })),
    ).rejects.toThrow();
  });

  it("reads persisted v1 and v2 versions while rejecting mixed version pairs", async () => {
    const { userId, workspaceId } = await seedTarget();
    const repository = new MariaDbImportSnapshotRepository(pool);
    for (const version of ["phase2:v1", "phase2:v2"]) {
      const id = uuidv7();
      const values = snapshotValues({ id, workspaceId, sourceId: null, basedOnVersion: null, createdBy: userId, proposedSourceName: "Wiki" });
      values[8] = version;
      values[9] = version;
      await pool.query(insertSnapshotSql, values);
      expect(await repository.findById(id)).toMatchObject({ adapterVersion: version, planVersion: version });
      await expect(pool.query("UPDATE source_import_snapshots SET plan_version=? WHERE id=?", [version === "phase2:v1" ? "phase2:v2" : "phase2:v1", id])).rejects.toThrow();
    }
  });

  it("rejects unsupported plan_version at the DB boundary", async () => {
    const { userId, workspaceId } = await seedTarget();
    const snapshotId = uuidv7();
    await pool.query(insertSnapshotSql, snapshotValues({
      id: snapshotId, workspaceId, sourceId: null, basedOnVersion: null, createdBy: userId, proposedSourceName: "New Wiki",
    }));
    await expect(
      pool.query("UPDATE source_import_snapshots SET plan_version='phase2:v999' WHERE id=?", [snapshotId]),
    ).rejects.toThrow();
    const unsupported = snapshotValues({
      id: uuidv7(), workspaceId, sourceId: null, basedOnVersion: null, createdBy: userId, proposedSourceName: "New Wiki",
    });
    (unsupported as unknown[])[9] = "phase2:v999";
    await expect(pool.query(insertSnapshotSql, unsupported)).rejects.toThrow();
  });

  it("rejects state-shape violations at the DB boundary (ck_import_snapshots_state_shape)", async () => {
    const { userId, workspaceId } = await seedTarget();
    const snapshotId = uuidv7();
    await pool.query(insertSnapshotSql, snapshotValues({
      id: snapshotId, workspaceId, sourceId: null, basedOnVersion: null, createdBy: userId, proposedSourceName: "New Wiki",
    }));
    // errno, not a bare toThrow(): a typo'd column or a bad fixture also
    // throws, which would let this pass while proving nothing. 4025 is
    // MariaDB's ER_CONSTRAINT_FAILED, so it pins the CHECK as the reason.
    // BUILDING rows must not carry finalization artifacts.
    await expect(
      pool.query("UPDATE source_import_snapshots SET finalized_at=? WHERE id=?", [new Date(), snapshotId]),
    ).rejects.toMatchObject({ errno: 4025 });
    // READY without its persisted hash/summary/plan shape is not representable.
    await expect(
      pool.query("UPDATE source_import_snapshots SET state='READY' WHERE id=?", [snapshotId]),
    ).rejects.toMatchObject({ errno: 4025 });
  });

  it("rejects duplicate staging entry keys and path hashes (uq_import_entries_snapshot_upload/path_hash)", async () => {
    const { userId, workspaceId } = await seedTarget();
    const snapshotId = uuidv7();
    await pool.query(insertSnapshotSql, snapshotValues({
      id: snapshotId, workspaceId, sourceId: null, basedOnVersion: null, createdBy: userId, proposedSourceName: "New Wiki",
    }));
    const insertEntry = (uploadKey: string, pathHash: string) =>
      pool.query(
        `INSERT INTO source_import_snapshot_entries (
          id, snapshot_id, upload_key, client_relative_path, source_path, source_path_hash,
          entry_type, upload_status, declared_size, diagnostics
        ) VALUES (?, ?, ?, 'README.md', NULL, ?, 'DOCUMENT', 'PENDING', 10, '[]')`,
        [uuidv7(), snapshotId, uploadKey, pathHash],
      );
    await insertEntry("f1", "d".repeat(64));
    // 1062 is ER_DUP_ENTRY: proves the unique index rejected these, rather
    // than some unrelated failure in the insert.
    await expect(insertEntry("f1", "e".repeat(64))).rejects.toMatchObject({ errno: 1062 });
    await expect(insertEntry("f2", "d".repeat(64))).rejects.toMatchObject({ errno: 1062 });
  });

  it("cascades staging entries when a snapshot is physically deleted", async () => {
    const { userId, workspaceId } = await seedTarget();
    const snapshotId = uuidv7();
    await pool.query(insertSnapshotSql, snapshotValues({
      id: snapshotId, workspaceId, sourceId: null, basedOnVersion: null, createdBy: userId, proposedSourceName: "New Wiki",
    }));
    await pool.query(
      `INSERT INTO source_import_snapshot_entries (
        id, snapshot_id, upload_key, client_relative_path, source_path, source_path_hash,
        entry_type, upload_status, declared_size, diagnostics
      ) VALUES (?, ?, 'f1', 'README.md', NULL, NULL, 'DOCUMENT', 'PENDING', 10, '[]')`,
      [uuidv7(), snapshotId],
    );
    await pool.query("DELETE FROM source_import_snapshots WHERE id = ?", [snapshotId]);
    const rows = await pool.query<{ count: number }[]>("SELECT COUNT(*) AS count FROM source_import_snapshot_entries WHERE snapshot_id = ?", [snapshotId]);
    expect(Number(rows[0].count)).toBe(0);
  });

  it("upserts an asset by normalized path while preserving the existing row identity", async () => {
    const { sourceId } = await seedTarget();
    const repository = new MariaDbAssetRepository(pool);
    const sourcePath = "images/diagram.png";
    const sourcePathHash = createHash("sha256").update(sourcePath, "utf8").digest("hex");
    const originalId = uuidv7();
    const createdAt = new Date();

    await repository.insert({
      id: originalId,
      sourceId,
      sourcePath,
      sourcePathHash,
      mimeType: "image/png",
      contentHash: "a".repeat(64),
      metadata: { size: 10 },
      createdAt,
      updatedAt: createdAt,
    });

    await repository.upsertByPath({
      id: uuidv7(),
      sourceId,
      sourcePath,
      sourcePathHash,
      mimeType: "image/png",
      contentHash: "b".repeat(64),
      metadata: { size: 20 },
      createdAt,
      updatedAt: new Date(createdAt.getTime() + 1000),
    });

    const assets = await repository.listBySourceId(sourceId);
    expect(assets).toHaveLength(1);
    expect(assets[0]).toMatchObject({ id: originalId, sourcePath, contentHash: "b".repeat(64), metadata: { size: 20 } });

    await repository.deleteById(originalId);
    expect(await repository.listBySourceId(sourceId)).toEqual([]);
  });
});
