import { cache } from "react";
import type { SharedView } from "@/modules/knowledge/application/document-share-service";
import { ShareLinkNotFoundError } from "@/modules/knowledge/domain/document-share-link";
import { shareReadService } from "./composition";

/**
 * Read projection for `/s/:token` (share-link spec §6.1). No caller, no
 * identity provider: see shareReadService(). Every failure is null so the
 * page shows one state for every unusable link (§6.3). `documentId` is the
 * folder page's `?d=`: navigation, judged again by the service on every read.
 *
 * Cached per request because the page and its metadata both ask, and each
 * read counts a view.
 */
export const getShared = cache((token: string, documentId?: string) => read(token, documentId, true));

/** Whether the link opens now, without counting a view: `/s/:token/open` reads nothing, it passes through. */
export const isSharedAvailable = async (token: string, documentId?: string): Promise<boolean> => (await read(token, documentId, false)) !== null;

async function read(token: string, documentId: string | undefined, recordView: boolean): Promise<SharedView | null> {
  try {
    return await shareReadService().readShared(token, { documentId, recordView });
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
