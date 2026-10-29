import type { ShareCommentNotificationView } from "@/modules/knowledge/domain/share-comment-event";

type Entry = Pick<ShareCommentNotificationView, "kind" | "token" | "linkAvailable" | "replyCount" | "workspaceId" | "sourceId" | "documentId" | "threadId" | "authorName" | "excerpt">;

/** FOLLOW and MENTION entries open through a link's token; only OWNER entries open the owner's document. */
export const isLinkEntry = (kind?: string) => kind === "FOLLOW" || kind === "MENTION";

/** The entry's last label: what kind it is, or the state of its discussion. */
export const notificationLabel = (entry: Pick<ShareCommentNotificationView, "kind" | "threadStatus">) =>
  entry.kind === "FOLLOW" ? "Discussion you follow" : entry.kind === "MENTION" ? "Mentioned you" : entry.threadStatus === "OPEN" ? "Open discussion" : "Resolved";

/** Where an Inbox entry opens: the owner's document in its Workspace, or the shared page a discussion was followed through. A dead link opens nothing. */
export function notificationHref(entry: Entry): string | null {
  if (!isLinkEntry(entry.kind)) return `/w/${entry.workspaceId}/knowledge/${entry.sourceId}/${entry.documentId}?thread=${entry.threadId}`;
  return entry.linkAvailable && entry.token ? `/s/${entry.token}?thread=${entry.threadId}` : null;
}

export function notificationLine(entry: Entry): string {
  if (isLinkEntry(entry.kind) && !entry.linkAvailable) return "This link is no longer available.";
  const said = `${entry.authorName ?? "Someone"}: ${entry.excerpt}`;
  return (entry.replyCount ?? 0) > 1 ? `${entry.replyCount} new replies · ${said}` : said;
}

/** A dead link's entry has no title of its own to show. */
export const notificationTitle = (entry: Pick<ShareCommentNotificationView, "kind" | "linkAvailable" | "documentTitle">) =>
  isLinkEntry(entry.kind) && !entry.linkAvailable ? "A shared discussion" : entry.documentTitle;
