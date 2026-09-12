import type { ImportSnapshot } from "@/modules/sources/domain/import-snapshot";
import { importError } from "@/modules/sources/domain/import-errors";
import type { ImportSnapshotRepository, MarkImportSnapshotReadyInput } from "@/modules/sources/ports/import-snapshot-repository";
import type { DbRow, QueryConnection } from "./shared";
import { affectedRows, asDate, asNullableDate, asNumber } from "./shared";

function json<T>(value: unknown): T | null {
  if (value === null || typeof value === "undefined") return null;
  return (typeof value === "string" ? JSON.parse(value) : value) as T;
}

function mapSnapshot(row: DbRow): ImportSnapshot {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    sourceId: row.source_id === null ? null : String(row.source_id),
    basedOnVersion: row.based_on_version === null ? null : asNumber(row.based_on_version, "based_on_version"),
    createdBy: String(row.created_by),
    rootName: String(row.root_name),
    proposedSourceName: row.proposed_source_name === null ? null : String(row.proposed_source_name),
    adapterType: "GENERIC_MARKDOWN_FOLDER",
    adapterVersion: "phase2:v1",
    planVersion: "phase2:v1",
    state: String(row.state) as ImportSnapshot["state"],
    manifestHash: String(row.manifest_hash),
    snapshotHash: row.snapshot_hash === null ? null : String(row.snapshot_hash),
    planHash: row.plan_hash === null ? null : String(row.plan_hash),
    hasBlockers: Boolean(Number(row.has_blockers)),
    summary: json<ImportSnapshot["summary"]>(row.summary),
    plan: json<ImportSnapshot["plan"]>(row.plan),
    createdAt: asDate(row.created_at),
    finalizedAt: asNullableDate(row.finalized_at),
    expiresAt: asDate(row.expires_at),
    appliedAt: asNullableDate(row.applied_at),
    staleAt: asNullableDate(row.stale_at),
    resultSourceId: row.result_source_id === null ? null : String(row.result_source_id),
    resultVersion: row.result_version === null ? null : asNumber(row.result_version, "result_version"),
  };
}

export class MariaDbImportSnapshotRepository implements ImportSnapshotRepository {
  constructor(private readonly connection: QueryConnection) {}

  async insert(snapshot: ImportSnapshot): Promise<void> {
    await this.connection.query(
      `INSERT INTO source_import_snapshots (
        id, workspace_id, source_id, based_on_version, created_by, root_name, proposed_source_name,
        adapter_type, adapter_version, plan_version, state, manifest_hash, snapshot_hash, plan_hash,
        has_blockers, summary, plan, created_at, finalized_at, expires_at, applied_at, stale_at, result_source_id, result_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        snapshot.id, snapshot.workspaceId, snapshot.sourceId, snapshot.basedOnVersion, snapshot.createdBy, snapshot.rootName,
        snapshot.proposedSourceName, snapshot.adapterType, snapshot.adapterVersion, snapshot.planVersion, snapshot.state,
        snapshot.manifestHash, snapshot.snapshotHash, snapshot.planHash, snapshot.hasBlockers,
        snapshot.summary === null ? null : JSON.stringify(snapshot.summary), snapshot.plan === null ? null : JSON.stringify(snapshot.plan),
        snapshot.createdAt, snapshot.finalizedAt, snapshot.expiresAt, snapshot.appliedAt, snapshot.staleAt,
        snapshot.resultSourceId, snapshot.resultVersion,
      ],
    );
  }

  async findById(snapshotId: string): Promise<ImportSnapshot | null> {
    const rows = await this.connection.query<DbRow[]>("SELECT * FROM source_import_snapshots WHERE id = ?", [snapshotId]);
    return rows[0] ? mapSnapshot(rows[0]) : null;
  }

  async lockById(snapshotId: string): Promise<ImportSnapshot | null> {
    const rows = await this.connection.query<DbRow[]>("SELECT * FROM source_import_snapshots WHERE id = ? FOR UPDATE", [snapshotId]);
    return rows[0] ? mapSnapshot(rows[0]) : null;
  }

  async countActiveByCreatorAndState(creatorId: string, state: "BUILDING" | "READY", now: Date): Promise<number> {
    const rows = await this.connection.query<{ count: unknown }[]>(
      "SELECT COUNT(*) AS count FROM source_import_snapshots WHERE created_by = ? AND state = ? AND expires_at > ?",
      [creatorId, state, now],
    );
    return Number(rows[0]?.count ?? 0);
  }

  async markReady(input: MarkImportSnapshotReadyInput): Promise<void> {
    const result = await this.connection.query(
      `UPDATE source_import_snapshots SET state='READY', snapshot_hash=?, plan_hash=?, summary=?, plan=?, has_blockers=?, finalized_at=?, expires_at=?
       WHERE id=? AND state='BUILDING'`,
      [input.snapshotHash, input.planHash, JSON.stringify(input.summary), JSON.stringify(input.plan), input.hasBlockers, input.finalizedAt, input.expiresAt, input.snapshotId],
    );
    if (affectedRows(result) !== 1) throw importError("IMPORT_SNAPSHOT_STATE_CONFLICT", "Import snapshot state changed concurrently.");
  }

  async markApplied(input: { snapshotId: string; sourceId: string; resultVersion: number; appliedAt: Date }): Promise<void> {
    const result = await this.connection.query(
      "UPDATE source_import_snapshots SET state='APPLIED', result_source_id=?, result_version=?, applied_at=? WHERE id=? AND state='READY'",
      [input.sourceId, input.resultVersion, input.appliedAt, input.snapshotId],
    );
    if (affectedRows(result) !== 1) throw importError("IMPORT_SNAPSHOT_STATE_CONFLICT", "Import snapshot state changed concurrently.");
  }

  async markStale(input: { snapshotId: string; staleAt: Date }): Promise<void> {
    const result = await this.connection.query(
      "UPDATE source_import_snapshots SET state='STALE', stale_at=? WHERE id=? AND state='READY'",
      [input.staleAt, input.snapshotId],
    );
    if (affectedRows(result) !== 1) throw importError("IMPORT_SNAPSHOT_STATE_CONFLICT", "Import snapshot state changed concurrently.");
  }

  async listCleanupCandidates(now: Date, limit: number): Promise<string[]> {
    const rows = await this.connection.query<{ id: unknown }[]>(
      `SELECT id FROM source_import_snapshots
       WHERE ((state IN ('BUILDING','READY') AND expires_at <= ?)
          OR (state='STALE' AND stale_at <= DATE_SUB(?, INTERVAL 24 HOUR))
          OR (state='APPLIED' AND applied_at <= DATE_SUB(?, INTERVAL 24 HOUR)))
       ORDER BY created_at, id LIMIT ?`,
      [now, now, now, limit],
    );
    return rows.map((row) => String(row.id));
  }

  async deleteIfCleanupEligible(snapshotId: string, now: Date): Promise<boolean> {
    const result = await this.connection.query(
      `DELETE FROM source_import_snapshots WHERE id=? AND (
        (state IN ('BUILDING','READY') AND expires_at <= ?)
        OR (state='STALE' AND stale_at <= DATE_SUB(?, INTERVAL 24 HOUR))
        OR (state='APPLIED' AND applied_at <= DATE_SUB(?, INTERVAL 24 HOUR))
      )`,
      [snapshotId, now, now, now],
    );
    return affectedRows(result) === 1;
  }
}
