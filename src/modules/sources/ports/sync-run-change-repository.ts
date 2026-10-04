import type { SyncRunChange, RunCursor } from "../domain/sync-run-change";
import type { SyncRun } from "../domain/sync-run";
export interface SyncRunChangeRepository {
  listReadingChanges(
    runId: string,
    input: {
      userId: string;
      workspaceId: string;
      unreadOnly?: boolean;
      limit: number;
    },
  ): Promise<{
    changes: SyncRunChange[];
    total: number;
    added: number;
    updated: number;
  }>;
  listDiagnosticChanges(
    runId: string,
    afterOrdinal: number,
    limit: number,
  ): Promise<SyncRunChange[]>;
  insertMany(changes: SyncRunChange[]): Promise<void>;
  listByRun(
    runId: string,
    afterOrdinal: number,
    limit: number,
  ): Promise<SyncRunChange[]>;
  listAppliedRuns(
    workspaceId: string,
    options: { sourceId?: string; cursor?: RunCursor; limit: number },
  ): Promise<SyncRun[]>;
}
