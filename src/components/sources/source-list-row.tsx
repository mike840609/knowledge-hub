import type { FolderImportClientLimits } from "@/components/imports/folder-import-form";
import { SourceLifecycleActions } from "./source-lifecycle-actions";
import { SourceSyncActions } from "@/components/sources/source-sync-actions";
import { isFolderSyncable } from "@/modules/knowledge/domain/source-policy";
import Link from "next/link";
import { ChevronRight, Database } from "lucide-react";
import type { SourceListItemModel } from "@/server/source-read";
import { Status, type StatusKind } from "@/components/ui/status";
import { Timestamp } from "@/components/ui/timestamp";

export function sourceTypeLabel(sourceType: string): string {
  if (sourceType === "FOLDER_SYNC") return "Folder sync";
  if (sourceType === "FILE_UPLOAD") return "File upload";
  return "Hub";
}

export function syncStatusLabel(status: string): string {
  if (status === "APPLIED") return "Synced";
  if (status === "FAILED") return "Failed";
  return "Previewed";
}

export function syncStatusKind(status: string): StatusKind {
  if (status === "APPLIED") return "success";
  if (status === "FAILED") return "danger";
  return "pending";
}

export function SourceListRow({ workspaceId, item, limits }: { workspaceId: string; item: SourceListItemModel; limits?: FolderImportClientLimits }) {
  const { source, latestRun, latestSuccessfulRun } = item;
  const lastSyncedAt = latestSuccessfulRun?.completedAt ?? (latestRun?.status === "APPLIED" ? latestRun.completedAt : null);
  return (
    <li className="kh-interactive-row grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-x-1 px-3">
      {isFolderSyncable(source) ? (
        <SourceSyncActions compact workspaceId={workspaceId} sourceId={source.id} sourceName={source.name} limits={limits} />
      ) : (
        <span className="flex h-8 w-8 items-center justify-center">
          <Database size={16} aria-hidden="true" className="text-kh-text-muted" />
        </span>
      )}
      <Link
        data-list-row
        href={`/w/${workspaceId}/sources/${source.id}`}
        className="kh-focus-ring col-start-2 row-start-1 flex min-w-0 min-h-11 flex-wrap items-center gap-x-3 gap-y-1 rounded-md py-2.5"
      >
        <span className="min-w-0 flex-1 truncate text-body font-medium text-kh-text">{source.name}</span>
        <span className="shrink-0 text-caption text-kh-text-muted">
          {sourceTypeLabel(source.sourceType)}
        </span>
        {source.status === "ARCHIVED" ? <Status kind="archived">Archived</Status> : null}
        {source.sourceType !== "HUB" ? (
          <span className="order-last inline-flex w-full flex-wrap items-center gap-1 text-caption text-kh-text-muted sm:order-none sm:w-auto sm:shrink-0">
            {latestRun ? <Status kind={syncStatusKind(latestRun.status)}>{syncStatusLabel(latestRun.status)}</Status> : null}
            {lastSyncedAt ? (
              <>
                {latestRun ? <span aria-hidden="true">·</span> : null}
                <span>Last synced <Timestamp value={lastSyncedAt} variant="relative" /></span>
              </>
            ) : (
              <span>Never synced</span>
            )}
          </span>
        ) : null}
        <ChevronRight size={15} aria-hidden="true" className="shrink-0 text-kh-text-muted" />
      </Link>
      <div className="col-start-3 row-start-1"><SourceLifecycleActions workspaceId={workspaceId} sourceId={source.id} sourceName={source.name} status={source.status} label={`Source actions: ${source.name}`} /></div>
      {item.pendingPreviewId ? <Link className="kh-focus-ring col-start-2 w-fit rounded-md pb-2 text-body-sm font-medium text-kh-link hover:underline" href={`/w/${workspaceId}/sources/imports/${item.pendingPreviewId}`}>Awaiting Apply · Review preview</Link> : null}
    </li>
  );
}
