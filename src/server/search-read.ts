import { notFound } from "next/navigation";
import { sortSourcesByName } from "@/lib/knowledge-navigation";
import type { SourceView } from "@/modules/knowledge/application/knowledge-query-service";
import type { KnowledgeSearchResult } from "@/modules/knowledge/application/knowledge-search-service";
import { parseSearchFilters, hasSearchFilters, type SearchFilterInput } from "@/modules/knowledge/domain/search-filters";
import { SearchTimeoutError, ValidationError } from "@/modules/knowledge/domain/errors";
import { applicationServices } from "@/server/composition";
import { DomainError } from "@/shared/domain/errors";

const AUTHORIZATION_NOT_FOUND_CODES = ["WORKSPACE_NOT_FOUND", "WORKSPACE_ACCESS_DENIED", "INSUFFICIENT_WORKSPACE_CAPABILITY"];

export type SearchPageInput = SearchFilterInput & {
  q: string;
  scope: "workspace" | "all";
  sourceId: string | null;
  includeArchived: boolean;
  page: number;
};

export type SearchPageModel = SearchPageInput & {
  workspaceId: string;
  workspaceName: string;
  sources: SourceView[];
  result: KnowledgeSearchResult | null;
  timedOut: boolean;
  filterError?: string;
};

/**
 * The only Web entry to search. Authorization order is fixed: trusted caller,
 * then Workspace visibility, then canSearch, and only then any content query.
 * Anything the caller may not see resolves to notFound(), matching the
 * existing settings read model.
 */
export async function getSearchPageModel(workspaceId: string, input: SearchPageInput): Promise<SearchPageModel> {
  const services = applicationServices();
  const { caller } = await services.establishTrustedCaller();
  let workspace: { name: string };
  try {
    const navigation = await services.workspaceAdmin.navigation(caller);
    const found = navigation.items.find((item) => item.id === workspaceId);
    if (!found) notFound();
    workspace = found;
    const { actions } = await services.workspaceAdmin.workspaceState(caller, workspaceId);
    if (!actions.canSearch) notFound();
  } catch (error) {
    if (error instanceof DomainError && AUTHORIZATION_NOT_FOUND_CODES.includes(error.code)) notFound();
    throw error;
  }

  const sources = sortSourcesByName(
    await services.queries.listSources(caller, workspaceId, { includeArchived: input.includeArchived }),
  );
  const base = { ...input, workspaceId, workspaceName: workspace.name, sources };
  try {
    const filters = parseSearchFilters(input);
    if (input.q.trim() === "" && !hasSearchFilters(filters) && !input.sourceId) return { ...base, result: null, timedOut: false };
    const result = await services.search.search(caller, {
      ...input,
      q: input.q,
      scope: input.scope === "all" ? { kind: "all" } : { kind: "workspace", workspaceId },
      sourceId: input.scope === "all" ? null : input.sourceId,
      includeArchived: input.includeArchived,
      page: input.page,
    });
    if(!result.hits.length)return {...base,result,timedOut:false};
    const locations=await services.unitOfWork.run(r=>r.entries.findByDocumentIds(result.hits.map(hit=>hit.documentId)));
    const paths=new Map(locations.map(e=>[e.documentId,e.sourcePath]));
    return { ...base, result:{...result,hits:result.hits.map(hit=>({...hit,sourcePath:paths.get(hit.documentId)}))}, timedOut: false };
  } catch (error) {
    if (error instanceof ValidationError) return { ...base, result: null, timedOut: false, filterError: error.message };
    if (error instanceof SearchTimeoutError) return { ...base, result: null, timedOut: true };
    throw error;
  }
}
