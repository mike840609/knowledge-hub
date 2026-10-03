import type { SyncRunChange, RunCursor } from "../domain/sync-run-change";
import type { SyncRun } from "../domain/sync-run";
export interface SyncRunChangeRepository {
  insertMany(changes: SyncRunChange[]): Promise<void>;
  listByRun(runId: string, afterOrdinal: number, limit: number): Promise<SyncRunChange[]>;
  listAppliedRuns(workspaceId: string, options: { sourceId?: string; cursor?: RunCursor; limit: number }): Promise<SyncRun[]>;
}
