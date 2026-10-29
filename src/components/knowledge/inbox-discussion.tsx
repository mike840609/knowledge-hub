"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { buttonClasses } from "@/components/ui/button";
import type { DocumentLinkView } from "@/modules/knowledge/application/knowledge-link-service";
import type { ReviewThreadView } from "@/modules/knowledge/domain/document-review";
import type { ShareCommentNotificationView } from "@/modules/knowledge/domain/share-comment-event";
import { DocumentPane } from "./document-pane";
import { governanceRequest } from "@/components/workspaces/governance-error";
import { MARKDOWN_ARTICLE } from "./markdown-article";
import { MarkdownRenderer } from "./markdown-renderer";
import { markdownOpensWithHeading } from "@/lib/markdown-title";
import { isLinkEntry, notificationHref, notificationTitle } from "./notification-href";
import { OwnerReviewPanel } from "./owner-review-panel";
import { renderedLinksFrom } from "./rendered-links";
import { ReviewThreadList, reviewRequest } from "./review-thread-list";

type Entry = ShareCommentNotificationView;

/**
 * One Inbox entry beside the list (`2026-10-29-inbox-split-view-design.md`). It reads and writes through the
 * entries the readers already use, so it grants nothing they do not: the owner's own document and its
 * discussions, or — for a followed discussion — that discussion through the link's token. A dead link's
 * entry asks for nothing.
 */
export function InboxDiscussion({ entry }: { entry: Entry }) {
  const href = notificationHref(entry);
  const follow = isLinkEntry(entry.kind);
  // The reader's 48px path line: what this is on the left, the way to the full page on the right.
  return <section aria-label="Selected discussion" className="flex h-full min-h-0 min-w-0 flex-col">
    <header className="flex h-12 shrink-0 items-center justify-between gap-3 px-6">
      <h2 className="min-w-0 truncate text-body text-kh-text-muted">{notificationTitle(entry)}</h2>
      {href && <Link className={buttonClasses({ variant: "secondary", size: "sm" })} href={href} prefetch={follow ? false : undefined}>Open document</Link>}
    </header>
    {follow ? <FollowedDiscussion entry={entry} /> : <OwnerDocument entry={entry} />}
  </section>;
}

type Peek = { title: string; markdown: string; revisionId: string; status: string; sourceStatus: string; linkView: DocumentLinkView | null };

/** The owner's document as the reader shows it, its discussions beside it, the entry's one open. */
function OwnerDocument({ entry }: { entry: Entry }) {
  const [peek, setPeek] = useState<Peek>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let live = true;
    governanceRequest<Peek>(`/api/documents/${entry.documentId}/peek?brief`)
      .then(result => { if (live) setPeek(result); })
      .catch(failure => { if (live) setError(failure instanceof Error ? failure.message : "Could not load the document."); });
    return () => { live = false; };
  }, [entry.documentId]);
  if (error) return <p role="alert" className="px-6 text-body-sm">{error}</p>;
  if (!peek) return <p role="status" className="px-6 text-body-sm text-kh-text-muted">Loading document…</p>;
  // The path line is outside the pane, so the rail's toolbar has nothing to stop under.
  return <div className="min-h-0 flex-1" style={{ "--kh-review-toolbar-top": "0px" } as CSSProperties}>
    <DocumentPane>
      <div className="kh-reading-column py-6">
        {!markdownOpensWithHeading(peek.markdown) && <h1 className="mb-6 text-page-title font-semibold tracking-tight text-kh-text">{peek.title}</h1>}
        <OwnerReviewPanel documentId={entry.documentId} revisionId={peek.revisionId} markdown={peek.markdown} thread={entry.threadId}
          readOnly={peek.status !== "ACTIVE" || peek.sourceStatus !== "ACTIVE"}>
          <article data-review-document className={MARKDOWN_ARTICLE}>
            <MarkdownRenderer markdown={peek.markdown} links={peek.linkView ? renderedLinksFrom(peek.linkView) : undefined} />
          </article>
        </OwnerReviewPanel>
      </div>
    </DocumentPane>
  </div>;
}

/**
 * A followed discussion alone: the page it is on is reached only through `/s/:token`, which this view
 * neither frames nor reads, so the passage is its quote and the page is Open document.
 */
function FollowedDiscussion({ entry }: { entry: Entry }) {
  const token = entry.linkAvailable ? entry.token : undefined;
  // A folder link's discussion is reached through the document it is on; a document link's names none.
  const documentId = entry.documentId || undefined;
  const [loaded, setLoaded] = useState<{ thread: ReviewThreadView | null; writesEnabled: boolean; signedIn: boolean }>();
  const [error, setError] = useState<string>();

  // ponytail: reads every discussion on the page to show one; a per-thread read if that gets slow.
  const load = useCallback(async () => {
    if (!token) return;
    try {
      const result = await reviewRequest<{ threads: ReviewThreadView[]; writesEnabled: boolean; callerUserId: string | null }>("/api/share-review/threads/query", { token, documentId });
      setLoaded({ thread: result.threads.find(item => item.id === entry.threadId) ?? null, writesEnabled: result.writesEnabled, signedIn: result.callerUserId !== null });
      setError(undefined);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not load the discussion.");
    }
  }, [token, documentId, entry.threadId]);
  useEffect(() => { void load(); }, [load]);

  if (!token) return <p className="px-6 text-body-sm text-kh-text-muted">This link is no longer available.</p>;
  if (error) return <p role="alert" className="px-6 text-body-sm">{error}</p>;
  if (!loaded) return <p role="status" className="px-6 text-body-sm text-kh-text-muted">Loading discussion…</p>;
  if (!loaded.thread) return <p className="px-6 text-body-sm text-kh-text-muted">This discussion is no longer available here.</p>;
  const share = async (path: string, body: object) => { await reviewRequest(`/api/share-review/threads/${path}`, { token, documentId, ...body }); await load(); };
  return <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
    <ReviewThreadList threads={[loaded.thread]} activeThreadId={loaded.thread.id} filter="ALL" onFilterChange={() => {}} writesEnabled={loaded.writesEnabled}
      reply={(threadId, body, idempotencyKey) => share(`${threadId}/replies`, { body, idempotencyKey })}
      follow={(threadId, following) => share(`${threadId}/follow`, { following })}
      author={loaded.signedIn ? {
        edit: (threadId, commentId, body) => share(`${threadId}/comments/${commentId}/body`, { body }),
        remove: (threadId, commentId) => share(`${threadId}/comments/${commentId}/deletion`, {}),
      } : undefined} />
  </div>;
}
