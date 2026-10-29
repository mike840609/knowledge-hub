"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { buttonClasses } from "@/components/ui/button";
import type { OwnerReviewThreadView, ReviewThreadView } from "@/modules/knowledge/domain/document-review";
import type { ShareCommentNotificationView } from "@/modules/knowledge/domain/share-comment-event";
import { notificationHref, notificationTitle } from "./notification-href";
import { ReviewThreadList, reviewRequest } from "./review-thread-list";

type Thread = ReviewThreadView | OwnerReviewThreadView;
type Loaded = { thread: Thread | null; writesEnabled: boolean; signedIn: boolean };

/**
 * One Inbox entry's discussion, beside the list (`2026-10-29-inbox-split-view-design.md`). It reads and
 * writes through the entries the readers already use — the owner's document threads, or the shared link
 * with the entry's token — so it grants nothing they do not. A dead link's entry asks for nothing.
 */
export function InboxDiscussion({ entry, onStatus }: { entry: ShareCommentNotificationView; onStatus: (threadId: string, status: Thread["status"]) => void }) {
  const follow = entry.kind === "FOLLOW";
  const token = follow && entry.linkAvailable ? entry.token : undefined;
  const dead = follow && !token;
  const base = `/api/documents/${entry.documentId}/review-threads`;
  const [loaded, setLoaded] = useState<Loaded>();
  const [error, setError] = useState<string>();

  // ponytail: reads every discussion on the document to show one; a per-thread read if that gets slow.
  const load = useCallback(async () => {
    if (dead) return;
    try {
      const result = token
        ? await reviewRequest<{ threads: ReviewThreadView[]; writesEnabled: boolean; callerUserId: string | null }>("/api/share-review/threads/query", { token })
        : await reviewRequest<{ threads: OwnerReviewThreadView[]; writesEnabled: boolean }>(base);
      const thread = result.threads.find(item => item.id === entry.threadId) ?? null;
      setLoaded({ thread, writesEnabled: result.writesEnabled, signedIn: !("callerUserId" in result) || result.callerUserId !== null });
      setError(undefined);
      if (thread) onStatus(thread.id, thread.status);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not load the discussion.");
    }
  }, [dead, token, base, entry.threadId, onStatus]);
  useEffect(() => { void load(); }, [load]);

  const href = notificationHref(entry);
  const thread = loaded?.thread;
  const share = (path: string, body: object) => reviewRequest(`/api/share-review/threads/${path}`, { token, ...body });
  return <section aria-label="Selected discussion" className="min-w-0 space-y-4">
    <header className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="truncate text-body font-medium text-kh-text">{notificationTitle(entry)}</h2>
        <p className="text-caption text-kh-text-muted">{follow ? "Discussion you follow" : (thread?.status ?? entry.threadStatus) === "OPEN" ? "Open discussion" : "Resolved"}</p>
      </div>
      {href && <Link className={buttonClasses({ variant: "secondary" })} href={href} prefetch={follow ? false : undefined}>Open document</Link>}
    </header>
    {dead ? <p className="text-body-sm text-kh-text-muted">This link is no longer available.</p>
      : error ? <p role="alert" className="text-body-sm">{error}</p>
      : !loaded ? <p role="status" className="text-body-sm text-kh-text-muted">Loading discussion…</p>
      : !thread ? <p className="text-body-sm text-kh-text-muted">This discussion is no longer available here.</p>
      : <ReviewThreadList threads={[thread]} activeThreadId={thread.id} filter="ALL" onFilterChange={() => {}} writesEnabled={loaded.writesEnabled}
          {...(token ? {
            reply: async (threadId: string, body: string, idempotencyKey: string) => { await share(`${threadId}/replies`, { body, idempotencyKey }); await load(); },
            follow: async (threadId: string, following: boolean) => { await share(`${threadId}/follow`, { following }); await load(); },
            author: loaded.signedIn ? {
              edit: async (threadId: string, commentId: string, body: string) => { await share(`${threadId}/comments/${commentId}/body`, { body }); await load(); },
              remove: async (threadId: string, commentId: string) => { await share(`${threadId}/comments/${commentId}/deletion`, {}); await load(); },
            } : undefined,
          } : {
            reply: async (threadId: string, body: string, idempotencyKey: string) => { await reviewRequest(`${base}/${threadId}/replies`, { body, idempotencyKey }); await load(); },
            author: {
              edit: async (threadId: string, commentId: string, body: string) => { await reviewRequest(`${base}/${threadId}/comments/${commentId}/body`, { body }); await load(); },
              remove: async (threadId: string, commentId: string) => { await reviewRequest(`${base}/${threadId}/comments/${commentId}/deletion`, {}); await load(); },
            },
            moderate: async (threadId: string, action: "resolution" | "visibility", value: string, commentId?: string) => { await reviewRequest(commentId ? `${base}/${threadId}/comments/${commentId}/visibility` : `${base}/${threadId}/${action}`, action === "resolution" ? { status: value } : { visibility: value }); await load(); },
          })} />}
  </section>;
}
