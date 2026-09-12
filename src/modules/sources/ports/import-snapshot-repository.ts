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
  findById(snapshotId: string): Promise<ImportSnapshot | null>;
  lockById(snapshotId: string): Promise<ImportSnapshot | null>;
  countActiveByCreatorAndState(creatorId: string, state: "BUILDING" | "READY", now: Date): Promise<number>;
  acquireCreatorQuotaLock(creatorId: string, timeoutSeconds: number): Promise<boolean>;
  releaseCreatorQuotaLock(creatorId: string): Promise<void>;
  markReady(input: MarkImportSnapshotReadyInput): Promise<void>;
  markApplied(input: { snapshotId: string; sourceId: string; resultVersion: number; appliedAt: Date }): Promise<void>;
  markStale(input: { snapshotId: string; staleAt: Date }): Promise<void>;
  listCleanupCandidates(now: Date, limit: number): Promise<string[]>;
  deleteIfCleanupEligible(snapshotId: string, now: Date): Promise<boolean>;
}
