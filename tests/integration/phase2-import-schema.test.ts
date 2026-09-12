import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
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
  await pool.query("INSERT INTO workspaces (id, name) VALUES (?, 'Phase 2 Workspace')", [workspaceId]);
  await pool.query("INSERT INTO workspace_memberships (workspace_id, user_id) VALUES (?, ?)", [workspaceId, userId]);
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
  it("applies migrations 006 and 007", async () => {
    const rows = await pool.query<{ version: number; state: string }[]>(
      "SELECT version, state FROM schema_migrations WHERE version IN (6, 7) ORDER BY version",
    );
    expect(rows.map((row) => [Number(row.version), row.state])).toEqual([
      [6, "APPLIED"],
      [7, "APPLIED"],
    ]);
  });

  it("creates the staging indexes and enforces initial/resync binding shape", async () => {
    const indexes = await pool.query<{ INDEX_NAME: string }[]>("SHOW INDEX FROM source_import_snapshot_entries");
    expect(new Set(indexes.map((row) => row.INDEX_NAME))).toEqual(
      expect.objectContaining(
        new Set([
          "uq_import_entries_snapshot_upload",
          "uq_import_entries_snapshot_path_hash",
          "idx_import_entries_snapshot_upload",
        ]),
      ),
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
