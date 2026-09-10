import type { SyncRun } from "../domain/sync-run";

export interface SyncRunRepository {
  insert(run: SyncRun): Promise<void>;
  findById(runId: string): Promise<SyncRun | null>;
}
