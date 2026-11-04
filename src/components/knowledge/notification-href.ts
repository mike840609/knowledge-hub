import type { ShareCommentNotificationView } from "@/modules/knowledge/domain/share-comment-event";

type Entry = Pick<ShareCommentNotificationView, "kind" | "linkAvailable" | "replyCount" | "workspaceId" | "sourceId" | "documentId" | "threadId" | "authorName" | "excerpt" | "documentTitle" | "href">;

/** SHARED_WITH_YOU is a document, not a discussion: it has no thread to show beside the list, only a page to open. */
export const isSharedEntry = (kind?: string) => kind === "SHARED_WITH_YOU";

/** FOLLOW, MENTION and SHARED_WITH_YOU entries open through a link; only OWNER entries open the owner's document. */
export const isLinkEntry = (kind?: string) => kind === "FOLLOW" || kind === "MENTION" || isSharedEntry(kind);

/** The entry's last label: what kind it is, or the state of its discussion. */
export const notificationLabel = (entry: Pick<ShareCommentNotificationView, "kind" | "threadStatus">) =>
  entry.kind === "FOLLOW" ? "Discussion you follow" : entry.kind === "MENTION" ? "Mentioned you" : entry.kind === "SHARED_WITH_YOU" ? "Shared with you" : entry.threadStatus === "OPEN" ? "Open discussion" : "Resolved";

/**
 * Where an Inbox entry opens: the owner's document in its Workspace, or the `href` the server built for a link entry
 * (`shareDiscussionHref`: `/s/<token>` for a LINK share, the Hub reader for a NAMED one). A dead link opens nothing.
 */
export function notificationHref(entry: Entry): string | null {
  if (!isLinkEntry(entry.kind)) return `/w/${entry.workspaceId}/knowledge/${entry.sourceId}/${entry.documentId}?thread=${entry.threadId}`;
  return entry.linkAvailable && entry.href ? entry.href : null;
}

export function notificationLine(entry: Entry): string {
  if (isLinkEntry(entry.kind) && !entry.linkAvailable) return "This link is no longer available.";
  if (isSharedEntry(entry.kind)) return `${entry.authorName ?? "Someone"} shared this with you`;
  const said = `${entry.authorName ?? "Someone"}: ${entry.excerpt}`;
  return (entry.replyCount ?? 0) > 1 ? `${entry.replyCount} new replies · ${said}` : said;
}

/** A dead link's entry has no title of its own to show. */
export const notificationTitle = (entry: Pick<ShareCommentNotificationView, "kind" | "linkAvailable" | "documentTitle">) =>
  isLinkEntry(entry.kind) && !entry.linkAvailable ? (isSharedEntry(entry.kind) ? "A shared document" : "A shared discussion") : entry.documentTitle;
