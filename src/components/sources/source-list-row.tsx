import Link from "next/link";
import { ChevronRight, Database } from "lucide-react";
import type { SourceListItemModel } from "@/server/source-read";
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

export function SourceListRow({ workspaceId, item }: { workspaceId: string; item: SourceListItemModel }) {
  const { source, latestRun } = item;
  return (
    <li>
      <Link
        href={`/w/${workspaceId}/sources/${source.id}`}
        className="kh-interactive-row flex min-h-11 items-center gap-3 px-3 py-2.5"
      >
        <Database size={16} strokeWidth={2} aria-hidden="true" className="shrink-0 text-kh-text-muted" />
        <span className="min-w-0 flex-1 truncate text-body font-medium text-kh-text">{source.name}</span>
        <span className="shrink-0 rounded-md border border-kh-border px-1.5 py-0.5 text-caption text-kh-text-muted">
          {sourceTypeLabel(source.sourceType)}
        </span>
        {latestRun ? (
          <span className="hidden shrink-0 text-caption text-kh-text-muted sm:inline">
            {syncStatusLabel(latestRun.status)} · <Timestamp value={latestRun.startedAt} />
          </span>
        ) : (
          <span className="hidden shrink-0 text-caption text-kh-text-muted sm:inline">Never synced</span>
        )}
        <ChevronRight size={15} strokeWidth={2} aria-hidden="true" className="shrink-0 text-kh-text-muted" />
      </Link>
    </li>
  );
}
