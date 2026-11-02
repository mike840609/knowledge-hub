/**
 * A document id as a shared folder page's `?d=` carries it: lowercase, as ids are stored
 * (folder share spec §4). The id is navigation only; the service judges it on every read.
 */
export const SHARED_DOCUMENT_ID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const DOCUMENT_ID = new RegExp(`^${SHARED_DOCUMENT_ID}$`);

/**
 * `?d=` as a route receives it: absent means the landing document, one well-formed id names a
 * document, and anything else — a malformed id, an empty one, the parameter twice — is `null`,
 * which the page shows as not available rather than guessing. The service validates again at its
 * own boundary; this check is what keeps a malformed id out of routing before any read.
 */
export function sharedDocumentParam(value: string | string[] | undefined): string | undefined | null {
  if (value === undefined) return undefined;
  return typeof value === "string" && DOCUMENT_ID.test(value) ? value : null;
}

/** The anonymous page a share link opens. */
export function sharedPagePath(token: string): string {
  return `/s/${encodeURIComponent(token)}`;
}

/** The Hub's own reader of a share, in the caller's personal Workspace shell (named-recipient share spec). */
export function hubSharePath(workspaceId: string, token: string): string {
  return `/w/${workspaceId}/shares/${encodeURIComponent(token)}`;
}

/**
 * Where a discussion read through a share opens, at `?thread=` (and a folder link's document, `?d=`). A LINK
 * share's is its anonymous page, written as it always was; a NAMED share's is the Hub reader in the reader's
 * own personal Workspace, since `/s/<token>` answers it as a dead link. No such Workspace: nowhere (`null`).
 * Built by the server, so the client never chooses which path a share is read on.
 */
export function shareDiscussionHref(link: { audience: "LINK" | "NAMED"; token: string }, readerWorkspaceId: string | null, threadId: string, documentId?: string): string | null {
  const page = link.audience === "NAMED" ? readerWorkspaceId && hubSharePath(readerWorkspaceId, link.token) : `/s/${link.token}`;
  return page ? `${page}?${documentId ? `d=${documentId}&` : ""}thread=${threadId}` : null;
}

/** A document of a shared folder, read through the folder's link on `pagePath`: the anonymous page, or the Hub's reader. */
export function sharedFolderHref(token: string, documentId: string, pagePath = sharedPagePath(token)): string {
  return `${pagePath}?d=${documentId}`;
}
