import type { SyncRun, SyncRunStatus } from "../domain/sync-run";

export interface SyncRunRepository {
  insert(run: SyncRun): Promise<void>;
  findAppliedBySnapshotId(sourceId: string, snapshotId: string): Promise<SyncRun | null>;
  findById(runId: string): Promise<SyncRun | null>;
  listBySourceId(sourceId: string, limit: number, status?: SyncRunStatus): Promise<SyncRun[]>;
}
