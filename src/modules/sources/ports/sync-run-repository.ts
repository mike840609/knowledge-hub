import type { SyncRun, SyncRunStatus } from "../domain/sync-run";

export interface SyncRunRepository {
  insert(run: SyncRun): Promise<void>;
  findAppliedBySnapshotId(sourceId: string, snapshotId: string): Promise<SyncRun | null>;
  findById(runId: string): Promise<SyncRun | null>;
  listBySourceId(sourceId: string, limit: number, status?: SyncRunStatus): Promise<SyncRun[]>;
  /** Newest run per source by `started_at DESC, id DESC` (any status), one row per source. */
  listLatestBySourceIds(sourceIds: readonly string[]): Promise<SyncRun[]>;
  /** Newest `APPLIED` run per source by `completed_at DESC, id DESC`, one row per source. */
  listLatestAppliedBySourceIds(sourceIds: readonly string[]): Promise<SyncRun[]>;
}
