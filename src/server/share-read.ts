import { cache } from "react";
import type { SharedTargetView, SharedView } from "@/modules/knowledge/application/document-share-service";
import { ShareLinkNotFoundError } from "@/modules/knowledge/domain/document-share-link";
import { shareReadService } from "./composition";

/**
 * Read projection for `/s/:token` (share-link spec §6.1). No caller, no
 * identity provider: see shareReadService(). Every failure is null so the
 * page shows one state for every unusable link (§6.3). `documentId` is the
 * folder page's `?d=`: navigation, judged again by the service on every read.
 * A viewer id, where a function takes one, is handed in by a page that already
 * established its trusted caller; this module never resolves identity itself.
 *
 * Cached per request because the page and its metadata both ask, and each
 * read counts a view.
 */
export const getShared = cache((token: string, documentId?: string) => read(token, documentId, true, null));

/**
 * The same read for a signed-in reader, which a NAMED link needs: it opens only for a listed
 * recipient or its owner (named-recipient share spec). `viewerId` must be the trusted caller's
 * id, never a request parameter; a LINK reads as it does for anyone.
 */
export const getSharedForViewer = cache((token: string, viewerId: string, documentId?: string) => read(token, documentId, true, viewerId));

/** Whether the link opens now, without counting a view. */
export const isSharedAvailable = async (token: string, documentId?: string): Promise<boolean> => (await read(token, documentId, false, null)) !== null;

export type SharedOpenTarget = SharedTargetView;

/**
 * What `/s/:token/open` needs, in one judgment: whether the link opens and which document to hand
 * to the Hub. A document link opens its own document and refuses `?d=`; a folder link opens the
 * requested document when it is still reachable, else the landing document, and `null` when the
 * folder is empty. No view is counted: the reader is only passing through. `viewerId`, the trusted
 * caller's id when there is one, is what a NAMED link is judged against.
 */
export async function sharedOpenTarget(token: string, requested?: string, viewerId?: string): Promise<SharedOpenTarget | null> {
  try {
    return await shareReadService().readSharedTarget(token, { documentId: requested, viewerId: viewerId ?? null });
  } catch (error) {
    // The route shows one not-available state; an operator still needs to see a database failure.
    if (!(error instanceof ShareLinkNotFoundError)) {
      console.error("Shared document could not be opened.", error instanceof Error ? error.name : "UnknownError");
    }
    return null;
  }
}

async function read(token: string, documentId: string | undefined, recordView: boolean, viewerId: string | null): Promise<SharedView | null> {
  try {
    return await shareReadService().readShared(token, { documentId, recordView, viewerId });
  } catch (error) {
    // The reader sees one state for every failure (spec §6.3), but a database
    // outage or a document without a current revision is not "link not
    // available" to an operator. Never log the token.
    if (!(error instanceof ShareLinkNotFoundError)) {
      console.error("Shared document could not be read.", error instanceof Error ? error.name : "UnknownError");
    }
    return null;
  }
}
