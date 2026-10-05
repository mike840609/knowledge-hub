import type { SourceListItemModel } from "@/server/source-read";
import { isFolderSyncable } from "@/modules/knowledge/domain/source-policy";
import { DomainError } from "@/shared/domain/errors";

export const FRESHNESS_KEY = "prefs:freshness";
export const FRESHNESS_THRESHOLDS = [7, 14, 30] as const;
export type FreshnessThreshold = typeof FRESHNESS_THRESHOLDS[number];
export function validateFreshnessValue(value: unknown): { thresholdDays: FreshnessThreshold } {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 1 ||
    !("thresholdDays" in value) || !FRESHNESS_THRESHOLDS.includes(value.thresholdDays as FreshnessThreshold))
    throw new DomainError("INVALID_REQUEST", "Choose a freshness threshold of 7, 14 or 30 days.");
  return { thresholdDays: value.thresholdDays as FreshnessThreshold };
}
export function freshnessThreshold(value: unknown): FreshnessThreshold {
  try { return validateFreshnessValue(value).thresholdDays; } catch { return 30; }
}
export type FreshnessReminder = { sourceId: string; sourceName: string; status: "pending" | "failed" | "never" | "old"; previewId: string | null; lastImportedAt: string | null };
/** Pending preview takes priority, then failed attempt, then never imported, then age. */
export function knowledgeFreshness(items: SourceListItemModel[], thresholdDays: FreshnessThreshold, now: Date): FreshnessReminder[] {
  return items.flatMap(item => {
    if (!isFolderSyncable(item.source)) return [];
    const applied = item.latestSuccessfulRun?.status === "APPLIED" ? item.latestSuccessfulRun : item.latestRun?.status === "APPLIED" ? item.latestRun : null;
    const lastImportedAt = applied?.completedAt ?? null;
    const status = item.pendingPreviewId ? "pending" : item.latestRun?.status === "FAILED" ? "failed" : !lastImportedAt ? "never" :
      now.getTime() - lastImportedAt.getTime() > thresholdDays * 86400000 ? "old" : null;
    return status ? [{sourceId:item.source.id,sourceName:item.source.name,status,previewId:item.pendingPreviewId??null,lastImportedAt:lastImportedAt?.toISOString()??null}] : [];
  });
}
