import type { CallerContext } from "@/modules/identity/domain/caller-context";
import type { applicationServices } from "./composition";

export type RecentDocumentHit = { documentId: string; sourceId: string; title: string; sourceName: string };

/**
 * The documents a reader says they opened lately, as the palette lists them when nothing is typed: what
 * each is called now, and where it is.
 *
 * What is remembered lives in the browser and is only a list of IDs, which is not authorization — nor is it
 * to be believed about the document. The whole list is asked of the query service in one batch, which
 * decides which of them this caller may read: one that is archived, that has since been made unreadable,
 * that belongs to another Workspace, or that never existed is left out, and nothing says which of those it
 * was. The order the caller gave is kept. Someone who is not in the Workspace gets the same refusal as for
 * any other read of it.
 */
export async function recentDocumentHits(
  services: ReturnType<typeof applicationServices>,
  caller: CallerContext,
  workspaceId: string,
  documentIds: readonly string[],
): Promise<RecentDocumentHit[]> {
  const sourceNames = new Map((await services.queries.listSources(caller, workspaceId)).map((source) => [source.id, source.name]));
  if (documentIds.length === 0) return [];
  const readable = new Map(
    (await services.queries.listDocumentSummariesByIds(caller, workspaceId, documentIds)).map((summary) => [summary.documentId, summary]),
  );
  const hits: RecentDocumentHit[] = [];
  for (const documentId of documentIds) {
    const summary = readable.get(documentId);
    if (!summary) continue;
    hits.push({ documentId: summary.documentId, sourceId: summary.sourceId, title: summary.title, sourceName: sourceNames.get(summary.sourceId) ?? "" });
  }
  return hits;
}
