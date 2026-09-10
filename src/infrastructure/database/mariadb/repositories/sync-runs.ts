import type { SyncRun, SyncRunStatus } from "@/modules/sources/domain/sync-run";
import type { SyncRunRepository } from "@/modules/sources/ports/sync-run-repository";
import type { QueryConnection, DbRow } from "./shared";
import { asDate, asJsonObject, asNumber, asNullableDate } from "./shared";

function mapRun(row: DbRow): SyncRun {
  return {
    id: String(row.id), sourceId: String(row.source_id), triggeredBy: String(row.triggered_by), basedOnVersion: asNumber(row.based_on_version, "base source version"),
    resultVersion: row.result_version === null ? null : asNumber(row.result_version, "result source version"), status: String(row.status) as SyncRunStatus,
    summary: asJsonObject(row.summary, "sync summary"), startedAt: asDate(row.started_at), completedAt: asNullableDate(row.completed_at),
  };
}

export class MariaDbSyncRunRepository implements SyncRunRepository {
  constructor(private readonly connection: QueryConnection) {}

  async insert(run: SyncRun): Promise<void> {
    await this.connection.query(
      `INSERT INTO sync_runs (id, source_id, triggered_by, based_on_version, result_version, status, summary, started_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [run.id, run.sourceId, run.triggeredBy, run.basedOnVersion, run.resultVersion, run.status, JSON.stringify(run.summary), run.startedAt, run.completedAt],
    );
  }

  async findById(runId: string): Promise<SyncRun | null> {
    const rows = await this.connection.query<DbRow[]>("SELECT * FROM sync_runs WHERE id = ?", [runId]);
    return rows[0] ? mapRun(rows[0]) : null;
  }
}
