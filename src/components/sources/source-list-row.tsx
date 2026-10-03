import type { FolderImportClientLimits } from "@/components/imports/folder-import-form";
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
  const { source, latestRun } = item;
  return (
    <li className="kh-interactive-row grid grid-cols-[2rem_minmax(0,1fr)] items-center gap-x-1 px-3">
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
        className="kh-focus-ring col-start-2 row-start-1 flex min-w-0 min-h-11 items-center gap-3 rounded-md py-2.5"
      >
        <span className="min-w-0 flex-1 truncate text-body font-medium text-kh-text">{source.name}</span>
        <span className="shrink-0 rounded-md border border-kh-border px-1.5 py-0.5 text-caption text-kh-text-muted">
          {sourceTypeLabel(source.sourceType)}
        </span>
        {latestRun ? (
          <span className="hidden shrink-0 items-center gap-1 text-caption text-kh-text-muted sm:inline-flex">
            <Status kind={syncStatusKind(latestRun.status)}>{syncStatusLabel(latestRun.status)}</Status>
            <span aria-hidden="true">·</span>
            <Timestamp value={latestRun.startedAt} />
          </span>
        ) : (
          <Status kind="none" className="hidden shrink-0 text-caption text-kh-text-muted sm:inline-flex">Never synced</Status>
        )}
        <ChevronRight size={15} aria-hidden="true" className="shrink-0 text-kh-text-muted" />
      </Link>
    </li>
  );
}
