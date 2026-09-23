import { cache } from "react";
import type { SharedDocumentView } from "@/modules/knowledge/application/document-share-service";
import { shareReadService } from "./composition";

/**
 * Read projection for `/s/:token` (share-link spec §6.1). No caller, no
 * identity provider: see shareReadService(). Every failure is null so the
 * page shows one state for every unusable link (§6.3).
 *
 * Cached per request because the page and its metadata both ask, and each
 * read counts a view.
 */
export const getSharedDocument = cache(async (token: string): Promise<SharedDocumentView | null> => {
  try {
    return await shareReadService().readShared(token);
  } catch {
    return null;
  }
});
