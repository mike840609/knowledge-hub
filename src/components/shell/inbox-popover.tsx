"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Popover } from "@base-ui-components/react/popover";
import { CheckCheck, Inbox, MessageSquareText, X } from "lucide-react";
import { buttonClasses, Button } from "@/components/ui/button";
import { Timestamp } from "@/components/ui/timestamp";
import { reviewRequest } from "@/components/knowledge/review-thread-list";
import type { ShareCommentNotificationView } from "@/modules/knowledge/domain/share-comment-event";

type ActivityResult = { notifications: ShareCommentNotificationView[]; nextCursor: { createdAt: string; id: string } | null };
type Tab = "unread" | "all";

/** Compact entry point: the complete activity history stays available at /inbox. */
export function InboxPopover({ workspaceId, placement = "header" }: { workspaceId: string; placement?: "header" | "compact" | "mobile" }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("unread");
  const [unread, setUnread] = useState<ShareCommentNotificationView[]>([]);
  const [recent, setRecent] = useState<ShareCommentNotificationView[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshUnread = useCallback(async () => {
    try {
      const data = await reviewRequest<{ notifications: ShareCommentNotificationView[] }>("/api/review-notifications/unread");
      setUnread(data.notifications);
    } catch {
      // The Hub remains usable when review notifications are temporarily unavailable.
    }
  }, []);

  useEffect(() => {
    void refreshUnread();
    window.addEventListener("kh:notification-changed", refreshUnread);
    window.addEventListener("focus", refreshUnread);
    return () => {
      window.removeEventListener("kh:notification-changed", refreshUnread);
      window.removeEventListener("focus", refreshUnread);
    };
  }, [pathname, refreshUnread]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setError(null);
    void Promise.all([
      reviewRequest<{ notifications: ShareCommentNotificationView[] }>("/api/review-notifications/unread"),
      reviewRequest<ActivityResult>("/api/review-notifications/activity"),
    ]).then(([newUnread, history]) => {
      if (!active) return;
      setUnread(newUnread.notifications);
      setRecent(history.notifications);
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : "Could not load notifications.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open]);

  async function markAllRead() {
    setBusy(true);
    setError(null);
    try {
      await reviewRequest("/api/review-notifications/activity", { action: "mark-all-read" });
      setUnread([]);
      setRecent(items => items.map(item => ({ ...item, readAt: item.readAt ?? new Date() })));
      window.dispatchEvent(new Event("kh:notification-changed"));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not mark notifications as read.");
    } finally { setBusy(false); }
  }

  const visible = (tab === "unread" ? unread : recent).slice(0, 8);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        aria-label={unread.length ? `Inbox, ${unread.length} unread comments` : "Inbox"}
        className={buttonClasses({ variant: "ghost", icon: true, className: "relative shrink-0" })}
        title="Inbox"
      >
        <Inbox className="h-4 w-4" aria-hidden="true" />
        {unread.length > 0 ? <span className="absolute right-0 top-0 h-2 w-2 rounded-full border border-kh-bg-sunken bg-kh-primary" aria-hidden="true" /> : null}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          className="z-50"
          align={placement === "mobile" ? "end" : "start"}
          alignOffset={placement === "header" ? 32 : 0}
          side={placement === "compact" ? "right" : "bottom"}
          sideOffset={8}
        >
          <Popover.Popup className="w-[min(22rem,calc(100vw-1rem))] overflow-hidden rounded-xl border border-kh-border bg-kh-bg shadow-popover outline-none">
            <div className="flex min-h-12 items-center justify-between border-b border-kh-border px-4">
              <Popover.Title className="text-body font-semibold text-kh-text">Inbox</Popover.Title>
              <div className="flex items-center gap-1">
                <Button variant="ghost" icon size="sm" aria-label="Mark all read" title="Mark all read" onClick={() => void markAllRead()} disabled={busy || unread.length === 0}>
                  <CheckCheck className="h-4 w-4" aria-hidden="true" />
                </Button>
                <Popover.Close aria-label="Close Inbox" className={buttonClasses({ variant: "ghost", icon: true, size: "sm" })}>
                  <X className="h-4 w-4" aria-hidden="true" />
                </Popover.Close>
              </div>
            </div>
            <div className="flex gap-4 border-b border-kh-border px-4" role="tablist" aria-label="Inbox filters">
              {(["unread", "all"] as const).map(option => <button
                type="button" role="tab" key={option} aria-selected={tab === option}
                className={`kh-focus-ring border-b-2 py-2 text-body-sm ${tab === option ? "border-kh-primary font-medium text-kh-text" : "border-transparent text-kh-text-muted"}`}
                onClick={() => setTab(option)}
              >{option === "unread" ? `Unread${unread.length ? ` (${unread.length})` : ""}` : "All activity"}</button>)}
            </div>
            {error && <p role="alert" className="px-4 py-2 text-body-sm text-kh-danger">{error}</p>}
            <div className="max-h-[min(24rem,calc(100dvh-12rem))] overflow-y-auto">
              {loading ? <p role="status" className="px-4 py-8 text-center text-body-sm text-kh-text-muted">Loading comments…</p>
                : visible.length === 0 ? <div className="px-4 py-9 text-center text-kh-text-muted">
                    <MessageSquareText className="mx-auto mb-2 h-6 w-6" aria-hidden="true" />
                    <p className="text-body-sm">{tab === "unread" ? "You're all caught up." : "No share comments yet."}</p>
                  </div>
                : <ul aria-label={tab === "unread" ? "Unread notifications" : "Recent notifications"} className="divide-y divide-kh-border">
                    {visible.map(item => <li key={item.id}>
                      <Link
                        className="kh-focus-ring block px-4 py-3 hover:bg-kh-bg-hover"
                        href={`/w/${item.workspaceId}/knowledge/${item.sourceId}/${item.documentId}?thread=${item.threadId}`}
                        onClick={() => setOpen(false)}
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className="truncate text-body-sm font-medium text-kh-text">{item.documentTitle}</span>
                          <Timestamp value={String(item.createdAt)} variant="relative" />
                        </span>
                        <span className="mt-1 block truncate text-body-sm text-kh-text-muted">{item.authorName ?? "Someone"}: {item.excerpt}</span>
                        <span className="mt-1 flex items-center gap-1 text-caption text-kh-text-muted">
                          {item.readAt === null ? <span className="h-1.5 w-1.5 rounded-full bg-kh-primary" aria-hidden="true" /> : null}
                          {item.threadStatus === "OPEN" ? "Open discussion" : "Resolved"}
                        </span>
                      </Link>
                    </li>)}
                  </ul>}
            </div>
            <div className="border-t border-kh-border px-3 py-2">
              <Link href={`/w/${workspaceId}/inbox`} onClick={() => setOpen(false)}
                className="kh-focus-ring block rounded-md px-2 py-2 text-center text-body-sm font-medium text-kh-link hover:bg-kh-bg-hover">
                View all activity
              </Link>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
