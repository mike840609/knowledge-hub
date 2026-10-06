import { Timestamp } from "@/components/ui/timestamp";
import Link from "next/link";
import type { FolderUpdatesPage } from "@/modules/personal/application/list-folder-updates";
import type { FreshnessReminder } from "@/modules/personal/application/knowledge-freshness";

export function HomeUpdates({ workspaceId, page }: { workspaceId: string; page: FolderUpdatesPage }) {
  const seen = new Set<string>();
  const changes = page.runs.flatMap(({ run, sourceName, changes }) => changes.map(change => ({ ...change, sourceId: run.sourceId, sourceName, updatedAt: run.completedAt ?? run.startedAt })))
    .filter(change => {
      if (!change.documentId || !change.afterRevisionNo || seen.has(change.documentId)) return false;
      seen.add(change.documentId);
      return true;
    }).slice(0, 3);
  if (!changes.length) return <p className="px-3 py-2 text-body text-kh-text-muted">No recorded folder changes to show.</p>;
  return <ul className="space-y-1">{changes.map(change => <li key={change.documentId}>
    <Link className="kh-interactive-row kh-focus-ring block rounded-md px-3 py-3" href={`/w/${workspaceId}/knowledge/${change.sourceId}/${change.documentId}?revision=${change.afterRevisionNo}`}>
      <span className="block truncate text-body text-kh-text">{change.title}</span>
      <span className="mt-1 block text-caption text-kh-text-muted">Updated <Timestamp value={change.updatedAt} variant="relative" /></span>
      <span className="mt-1 flex min-w-0 items-center gap-2 text-caption text-kh-text-muted">
        <span className="min-w-0 flex-1 truncate" title={change.sourceName}>{change.sourceName}</span>
        <span className="shrink-0">{change.labels.includes("ADDED") ? "Added" : "Updated"} · {change.unread ? "Unread" : "Read"}</span>
      </span>
    </Link>
  </li>)}</ul>;
}

export function HomeSourceAttention({ workspaceId, reminders }: { workspaceId: string; reminders: FreshnessReminder[] }) {
  if (!reminders.length) return null;
  const first = [...reminders].sort((a,b) => ["failed", "pending", "never", "old"].indexOf(a.status) - ["failed", "pending", "never", "old"].indexOf(b.status))[0];
  const failed = reminders.some(item => item.status === "failed");
  const href = reminders.length > 1 ? `/w/${workspaceId}/sources` : first.previewId ? `/w/${workspaceId}/sources/imports/${first.previewId}` : `/w/${workspaceId}/sources/${first.sourceId}/update`;
  const message = reminders.length > 1 ? `${reminders.length} sources need attention${failed ? " · Import failed" : ""} · Review sources` : first.status === "failed" ? "Import failed · Retry import" : first.status === "pending" ? "Awaiting Apply · Review preview" : "Check for folder updates";
  return <Link className={`kh-focus-ring mb-3 block rounded-md border px-3 py-3 text-body-sm ${failed ? "border-kh-warning-border bg-kh-warning-bg text-kh-warning" : "border-kh-border text-kh-text"}`} href={href}>
    <span className="block font-medium">{message}</span>
    {reminders.length === 1 ? <span className="mt-1 block truncate text-caption">{first.sourceName}</span> : null}
  </Link>;
}
