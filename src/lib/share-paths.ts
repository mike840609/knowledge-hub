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

/** A document of a shared folder, read through the folder's link. */
export function sharedFolderHref(token: string, documentId: string): string {
  return `/s/${encodeURIComponent(token)}?d=${documentId}`;
}
