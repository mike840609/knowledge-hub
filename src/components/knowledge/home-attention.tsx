import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, FolderSync, TriangleAlert } from "lucide-react";
import { isLinkEntry, notificationHref, notificationLine } from "./notification-href";
import type { ShareCommentNotificationView } from "@/modules/knowledge/domain/share-comment-event";
import type { FreshnessReminder } from "@/modules/personal/application/knowledge-freshness";
import { Timestamp } from "@/components/ui/timestamp";
import { navigateListRows } from "@/lib/list-row-navigation";

/** An unread-comment notice as it crosses to the client: dates are ISO strings. */
export type HomeNotice = Omit<ShareCommentNotificationView, "createdAt" | "readAt"> & { createdAt: string; readAt: string | null };

const ORDER = ["failed", "pending", "never", "old"];

function SourceReminder({ workspaceId, reminders }: { workspaceId: string; reminders: readonly FreshnessReminder[] }) {
  const first = [...reminders].sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status))[0];
  const failed = reminders.some(item => item.status === "failed");
  const href = reminders.length > 1 ? `/w/${workspaceId}/sources` : first.previewId ? `/w/${workspaceId}/sources/imports/${first.previewId}` : `/w/${workspaceId}/sources/${first.sourceId}/update`;
  const status = reminders.length > 1 ? `${reminders.length} sources need attention${failed ? " · Import failed" : ""}` : first.status === "failed" ? "Import failed" : first.status === "pending" ? "Awaiting Apply" : "Check for folder updates";
  const action = reminders.length > 1 || first.status === "pending" ? "Review" : first.status === "failed" ? "Retry" : undefined;
  // Status is the warning colour in the icon only; the words stay neutral so the row does not outshout the page.
  const Icon = failed ? TriangleAlert : FolderSync;
  return <Link data-list-row className="kh-interactive-row kh-focus-ring flex items-start gap-3 rounded-md px-3 py-1.5" href={href}>
    <span className="flex h-5 shrink-0 items-center"><Icon size={14} aria-hidden="true" className={failed ? "text-kh-warning" : "text-kh-text-muted"} /></span>
    <span className="min-w-0 flex-1">
      <span className="block truncate text-body font-medium text-kh-text">{status}</span>
      {reminders.length === 1 ? <span className="block truncate text-caption text-kh-text-muted">{first.sourceName}</span> : null}
    </span>
    {action ? <span className="flex h-5 shrink-0 items-center gap-1 text-caption text-kh-text-secondary">{action}<ArrowRight size={12} aria-hidden="true" /></span> : null}
  </Link>;
}

/** A group of Home rows under the rail's group-label style (`caption`, medium, muted), never a heading-size title. */
export function HomeSection({ title, count, action, children }: { title: string; count?: number; action?: { href: string; label: string }; children: ReactNode }) {
  return (
    <section aria-label={title} className="min-w-0">
      <div className="flex items-baseline justify-between gap-3 px-3 pb-2">
        <h2 className="text-caption font-medium text-kh-text-muted">{title}{count ? <span className="ml-1.5">{count}</span> : null}</h2>
        {action ? <Link className="kh-focus-ring inline-flex min-h-6 items-center rounded-md text-caption text-kh-link" href={action.href}>{action.label}</Link> : null}
      </div>
      {children}
    </section>
  );
}

/** Unread share comments and followed replies, newest first (unread never includes a dead link); each row jumps to its thread. Renders nothing without one. */
export function UnreadDiscussions({ notices }: { notices: readonly HomeNotice[] }) {
  if (!notices.length) return null;
  return <ul aria-label="Unread discussions" onKeyDown={navigateListRows} className="space-y-0.5">{notices.slice(0, 5).map(notice => (
    <li key={notice.id}>
      <Link data-list-row className="kh-interactive-row kh-focus-ring flex min-h-10 items-center gap-3 rounded-md px-3 py-1" href={notificationHref(notice) ?? `/w/${notice.workspaceId}/home`} prefetch={isLinkEntry(notice.kind) ? false : undefined}>
        <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-kh-primary" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body font-medium text-kh-text">{notice.documentTitle}</span>
          <span className="block truncate text-caption text-kh-text-muted">{notificationLine(notice)}</span>
        </span>
        <span className="shrink-0 text-caption text-kh-text-muted"><Timestamp value={notice.createdAt} variant="relative" /></span>
      </Link>
    </li>
  ))}</ul>;
}

/** Sources that need the user on Home. Renders nothing otherwise; unread comments live in Discussions. */
export function AttentionList({ workspaceId, reminders }: { workspaceId: string; reminders: readonly FreshnessReminder[] }) {
  if (!reminders.length) return null;
  return <HomeSection title="Needs attention" action={{ href: `/w/${workspaceId}/updates`, label: "View all updates" }}>
    <SourceReminder workspaceId={workspaceId} reminders={reminders} />
  </HomeSection>;
}
