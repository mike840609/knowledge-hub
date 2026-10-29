import type { SharedResolvedLink } from "@/modules/knowledge/application/document-share-service";
import { sharedFolderHref } from "@/lib/share-paths";
import type { RenderedLinks } from "./rendered-links";

/**
 * What a shared folder page's renderer may link: only what the caller-less read kept, each pointed
 * at the folder page's `?d=` (folder share spec §5). No `documentId`, so no hover preview (it calls
 * a signed-in API), and no other-documents count (it counts documents outside the folder).
 */
export function sharedFolderLinks(token: string, links: readonly SharedResolvedLink[]): RenderedLinks {
  return Object.fromEntries(links.map((link) => [link.lookupKey, { status: "RESOLVED" as const, basePath: sharedFolderHref(token, link.documentId), title: link.title, ambiguousWith: 0 }]));
}
