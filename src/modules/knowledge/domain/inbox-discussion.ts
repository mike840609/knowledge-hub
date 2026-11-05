import type { ShareCommentNotificationView } from "./share-comment-event";

export type InboxRelationship = "OWNER" | "FOLLOW" | "MENTION";
export type InboxKindFilter = "all" | "owner" | "follow" | "mention";
export type InboxStatusFilter = "all" | "open" | "resolved";
export type InboxCursor = { latestAt: Date; threadId: string };

export type InboxDiscussionView = {
  threadId: string;
  kind: InboxRelationship;
  documentId: string;
  sourceId: string;
  documentTitle: string;
  quote: string;
  href: string;
  token?: string;
  latest: { authorName?: string; excerpt: string; createdAt: Date };
  latestAt: Date;
  commentCount: number;
  unreadCount: number;
  status: "OPEN" | "RESOLVED";
  following: boolean;
  mentioned: boolean;
};

export type InboxPage = {
  discussions: InboxDiscussionView[];
  shared: ShareCommentNotificationView[];
  /** Proposal notices are not discussions; the first page carries the ones the reader can act on. */
  proposals?: ShareCommentNotificationView[];
  nextCursor: { latestAt: string; threadId: string } | null;
};

/** On a tie for newest, the owner's view is preferred, then a mention, then a follow. */
const TIE_ORDER: Record<InboxRelationship, number> = { OWNER: 0, MENTION: 1, FOLLOW: 2 };

function newestView(views: readonly InboxDiscussionView[]): InboxDiscussionView {
  return views.reduce((best, candidate) => {
    const diff = candidate.latestAt.getTime() - best.latestAt.getTime();
    if (diff > 0) return candidate;
    if (diff === 0 && TIE_ORDER[candidate.kind] < TIE_ORDER[best.kind]) return candidate;
    return best;
  });
}

function newestMention(views: readonly InboxDiscussionView[]): InboxDiscussionView | undefined {
  const mentions = views.filter(view => view.kind === "MENTION");
  return mentions.length > 0 ? mentions.reduce((best, candidate) => (candidate.latestAt > best.latestAt ? candidate : best)) : undefined;
}

function mergeThread(views: readonly InboxDiscussionView[]): InboxDiscussionView {
  const owner = views.find(view => view.kind === "OWNER");
  const follow = views.find(view => view.kind === "FOLLOW");
  const latest = newestView(views);
  const identity = owner ?? follow ?? newestMention(views) ?? latest;
  const unreadCount = owner ? owner.unreadCount : views.filter(view => view.kind !== "OWNER").reduce((sum, view) => sum + view.unreadCount, 0);
  return {
    threadId: identity.threadId,
    kind: owner ? "OWNER" : views.some(view => view.kind === "MENTION") ? "MENTION" : "FOLLOW",
    documentId: identity.documentId,
    sourceId: identity.sourceId,
    documentTitle: identity.documentTitle,
    quote: identity.quote,
    href: identity.href,
    token: identity.token,
    latest: latest.latest,
    latestAt: latest.latestAt,
    commentCount: Math.max(...views.map(view => view.commentCount)),
    unreadCount,
    status: identity.status,
    following: views.some(view => view.following),
    mentioned: views.some(view => view.mentioned),
  };
}

/** One row per discussion: the owner's view wins identity, then a live follow, then the newest mention. */
export function mergeInboxDiscussions(views: readonly InboxDiscussionView[]): InboxDiscussionView[] {
  const groups = new Map<string, InboxDiscussionView[]>();
  for (const view of views) {
    const group = groups.get(view.threadId);
    if (group) group.push(view);
    else groups.set(view.threadId, [view]);
  }
  return [...groups.values()].map(mergeThread).sort(compareInboxDiscussions);
}

export function filterInboxDiscussions(
  views: readonly InboxDiscussionView[],
  filter: { kind: InboxKindFilter; status: InboxStatusFilter; unread: boolean },
): InboxDiscussionView[] {
  return views.filter(view =>
    (filter.kind === "owner" ? view.kind === "OWNER" : filter.kind === "follow" ? view.following : filter.kind === "mention" ? view.mentioned : true) &&
    (filter.status === "all" || view.status === (filter.status === "open" ? "OPEN" : "RESOLVED")) &&
    (!filter.unread || view.unreadCount > 0));
}

/** Newest first, then thread id descending. */
export function sortInboxDiscussions(views: readonly InboxDiscussionView[]): InboxDiscussionView[] {
  return [...views].sort(compareInboxDiscussions);
}

function compareInboxDiscussions(a: InboxDiscussionView, b: InboxDiscussionView): number {
  const byTime = b.latestAt.getTime() - a.latestAt.getTime();
  if (byTime !== 0) return byTime;
  return a.threadId < b.threadId ? 1 : a.threadId > b.threadId ? -1 : 0;
}
