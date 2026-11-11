import type { KnowledgeSearchService } from "@/modules/knowledge/application/knowledge-search-service";
import type { SourceUnitOfWork } from "@/modules/sources/ports/unit-of-work";

/**
 * Adds each hit's synced-folder source path to a search result. The search
 * projection does not carry one, so the web read models read it from the
 * document's own entry; the agent read route needs the same field on the same
 * rows (agent read access design §4). One function, so the production wiring
 * and its integration test cannot drift apart.
 */
export function withSourcePaths(
  search: Pick<KnowledgeSearchService, "search">,
  unitOfWork: Pick<SourceUnitOfWork, "read">,
): Pick<KnowledgeSearchService, "search"> {
  return {
    search: async (caller, input) => {
      const result = await search.search(caller, input);
      if (!result.hits.length) return result;
      const entries = await unitOfWork.read((repositories) =>
        repositories.entries.findByDocumentIds(result.hits.map((hit) => hit.documentId)));
      const paths = new Map(entries.flatMap((entry) =>
        entry.documentId === null ? [] : [[entry.documentId, entry.sourcePath] as const]));
      return { ...result, hits: result.hits.map((hit) => ({ ...hit, sourcePath: paths.get(hit.documentId) ?? null })) };
    },
  };
}
