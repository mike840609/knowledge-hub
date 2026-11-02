export type ShareCommentEvent = {
  id: string; workspaceId: string; documentId: string;
  threadId: string; commentId: string; originShareLinkId: string;
  createdByUserId: string; mentionedUserId: string | null;
  createdAt: Date; readAt: Date | null;
};
export type ShareCommentNotificationView = {
  id: string; workspaceId: string; documentId: string; sourceId: string; documentTitle: string;
  threadId: string; commentId: string; authorName: string | undefined;
  excerpt: string; createdAt: Date;
  readAt: Date | null; threadStatus: "OPEN" | "RESOLVED";
  /**
   * OWNER: a comment on the caller's shared document. FOLLOW: replies in a discussion the caller
   * follows, one entry per discussion; it carries no Workspace id, only the link's token while that
   * link opens (`linkAvailable`) — with the document id too when it is a folder link, whose page
   * needs it (`?d=`) — and `replyCount` replies not yet seen. A dead link's entry names neither.
   * MENTION: one comment naming the caller, carried like FOLLOW. A live FOLLOW or MENTION carries `href`, where it
   * opens (`shareDiscussionHref`): the link's `/s/<token>` page, or for a NAMED link the caller's Hub reader.
   * SHARED_WITH_YOU: an owner named the caller on a NAMED share. `documentTitle` is the document's or the folder's
   * name, `authorName` the owner's, `createdAt` when the caller was added, and `href` the reader in the caller's own
   * Workspace; it carries no ids and no token. A link that no longer opens gives `linkAvailable: false` and none of it.
   */
  kind?: "OWNER" | "FOLLOW" | "MENTION" | "SHARED_WITH_YOU"; token?: string; replyCount?: number; linkAvailable?: boolean; href?: string;
};
/** `shared:<linkId>` is the Inbox id of a named share, as `follow:` and `mention:` are of theirs. */
export const SHARED_PREFIX = "shared:";
export const EXCERPT_LIMIT = 80;
export function projectShareCommentNotification(input: {
  id: string; workspaceId: string; documentId: string; sourceId: string; documentTitle: string;
  threadId: string; commentId: string; authorName: string | undefined;
  body: string; createdAt: Date; readAt?: Date | null; threadStatus?: "OPEN" | "RESOLVED";
}): ShareCommentNotificationView {
  const { body, ...rest } = input;
  return { ...rest, readAt: input.readAt ?? null, threadStatus: input.threadStatus ?? "OPEN", excerpt: [...body].slice(0, EXCERPT_LIMIT).join("") };
}
