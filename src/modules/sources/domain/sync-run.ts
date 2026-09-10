export const SYNC_RUN_STATUSES = ["PREVIEWED", "APPLIED", "FAILED"] as const;
export type SyncRunStatus = (typeof SYNC_RUN_STATUSES)[number];

export type SyncRun = {
  id: string;
  sourceId: string;
  triggeredBy: string;
  basedOnVersion: number;
  resultVersion: number | null;
  status: SyncRunStatus;
  summary: Record<string, unknown>;
  startedAt: Date;
  completedAt: Date | null;
};
