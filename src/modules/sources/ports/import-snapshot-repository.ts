import type { ImportSnapshot } from "../domain/import-snapshot";
import type { ImportDiffSummary, FolderImportPlan } from "../domain/import-plan";

export type MarkImportSnapshotReadyInput = {
  snapshotId: string;
  snapshotHash: string;
  planHash: string;
  summary: ImportDiffSummary;
  plan: FolderImportPlan;
  hasBlockers: boolean;
  finalizedAt: Date;
  expiresAt: Date;
};

export interface ImportSnapshotRepository {
  insert(snapshot: ImportSnapshot): Promise<void>;
  /**
   * Newest READY snapshot id per `{ sourceId, basedOnVersion }` pair, scoped to
   * the creator and still unexpired at `now`. Sources without a match are
   * absent from the map.
   */
  findLatestReadyIdsBySourceForCreator(
    sources: readonly { sourceId: string; basedOnVersion: number }[],
    creatorId: string,
    now: Date,
  ): Promise<Map<string, string>>;
  findById(snapshotId: string): Promise<ImportSnapshot | null>;
  lockById(snapshotId: string): Promise<ImportSnapshot | null>;
  countActiveByCreatorAndState(creatorId: string, state: "BUILDING" | "READY", now: Date): Promise<number>;
  deleteBuildingByIdForCreator(snapshotId: string, creatorId: string): Promise<boolean>;
  markReady(input: MarkImportSnapshotReadyInput): Promise<void>;
  markApplied(input: { snapshotId: string; sourceId: string; resultVersion: number; appliedAt: Date }): Promise<void>;
  markStale(input: { snapshotId: string; staleAt: Date }): Promise<void>;
  listCleanupCandidates(now: Date, limit: number): Promise<string[]>;
  deleteIfCleanupEligible(snapshotId: string, now: Date): Promise<boolean>;
}
