import type { ShareCommentNotificationView } from "@/modules/knowledge/domain/share-comment-event";

type Entry = Pick<ShareCommentNotificationView, "kind" | "token" | "linkAvailable" | "replyCount" | "workspaceId" | "sourceId" | "documentId" | "threadId" | "authorName" | "excerpt" | "access">;

/** FOLLOW and MENTION entries reach a shared page through a link's token; only OWNER entries open the owner's document. */
export const isLinkEntry = (kind?: string) => kind === "FOLLOW" || kind === "MENTION";

/** A team entry opens its team document, never a share page, whatever its kind. */
export const isTeamEntry = (entry: Pick<ShareCommentNotificationView, "access">) => entry.access?.kind === "TEAM";

/** The entry's last label: what kind it is, or the state of its discussion. */
export const notificationLabel = (entry: Pick<ShareCommentNotificationView, "kind" | "threadStatus">) =>
  entry.kind === "FOLLOW" ? "Discussion you follow" : entry.kind === "MENTION" ? "Mentioned you" : entry.threadStatus === "OPEN" ? "Open discussion" : "Resolved";

/** Where an Inbox entry opens: the owner's or team's document, or the shared page a discussion was followed through. A dead link or lost team access opens nothing. */
export function notificationHref(entry: Entry): string | null {
  if (entry.access?.kind === "TEAM") {
    if (!entry.access.available || !entry.workspaceId || !entry.sourceId || !entry.documentId) return null;
    return `/w/${entry.workspaceId}/knowledge/${entry.sourceId}/${entry.documentId}?thread=${entry.threadId}`;
  }
  if (entry.access?.kind === "SHARE_LINK") {
    return entry.linkAvailable && entry.token ? sharedDiscussionHref(entry.token, entry.threadId, entry.documentId || undefined) : null;
  }
  if (!isLinkEntry(entry.kind)) return `/w/${entry.workspaceId}/knowledge/${entry.sourceId}/${entry.documentId}?thread=${entry.threadId}`;
  return entry.linkAvailable && entry.token ? sharedDiscussionHref(entry.token, entry.threadId, entry.documentId || undefined) : null;
}

/** A followed discussion on its shared page. A folder link's page also names the document it is on (`?d=`, folder share spec §4). */
export function sharedDiscussionHref(token: string, threadId: string, documentId?: string): string {
  return `/s/${token}?${documentId ? `d=${documentId}&` : ""}thread=${threadId}`;
}

export function notificationLine(entry: Entry): string {
  if (entry.access?.kind === "TEAM" && !entry.access.available) return "This discussion is no longer available.";
  if (isLinkEntry(entry.kind) && !entry.linkAvailable) return "This link is no longer available.";
  const said = `${entry.authorName ?? "Someone"}: ${entry.excerpt}`;
  return (entry.replyCount ?? 0) > 1 ? `${entry.replyCount} new replies · ${said}` : said;
}

/** A dead link's entry has no title of its own to show; nor does one whose team access is gone. */
export const notificationTitle = (entry: Pick<ShareCommentNotificationView, "kind" | "linkAvailable" | "documentTitle" | "access">) =>
  entry.access?.kind === "TEAM"
    ? entry.access.available ? entry.documentTitle : "A team discussion"
    : isLinkEntry(entry.kind) && !entry.linkAvailable ? "A shared discussion" : entry.documentTitle;
