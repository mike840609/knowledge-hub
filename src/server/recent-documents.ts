import type { CallerContext } from "@/modules/identity/domain/caller-context";
import type { applicationServices } from "./composition";

export type RecentDocumentHit = { documentId: string; sourceId: string; title: string; sourceName: string };

/**
 * The documents a reader says they opened lately, as the palette lists them when nothing is typed: what
 * each is called now, and where it is.
 *
 * What is remembered lives in the browser and is only a list of IDs, which is not authorization — nor is it
 * to be believed about the document. Each one is asked of the query service, which decides whether this
 * caller may read it: one that is archived, that has since been made unreadable, that belongs to another
 * Workspace, or that never existed is left out, and nothing says which of those it was. The order the
 * caller gave is kept. Someone who is not in the Workspace gets the same refusal as for any other read of it.
 */
export async function recentDocumentHits(
  services: ReturnType<typeof applicationServices>,
  caller: CallerContext,
  workspaceId: string,
  documentIds: readonly string[],
): Promise<RecentDocumentHit[]> {
  const sourceNames = new Map((await services.queries.listSources(caller, workspaceId)).map((source) => [source.id, source.name]));
  const hits: RecentDocumentHit[] = [];
  for (const documentId of documentIds) {
    try {
      const view = await services.queries.getDocument(caller, documentId, {});
      if (view.workspaceId !== workspaceId) continue;
      hits.push({ documentId: view.documentId, sourceId: view.sourceId, title: view.currentRevision.title, sourceName: sourceNames.get(view.sourceId) ?? "" });
    } catch {
      // Not readable by this caller, or not active: not offered.
    }
  }
  return hits;
}
