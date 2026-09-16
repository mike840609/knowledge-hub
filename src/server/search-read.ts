import { notFound } from "next/navigation";
import { sortSourcesByName } from "@/lib/knowledge-navigation";
import type { SourceView } from "@/modules/knowledge/application/knowledge-query-service";
import type { KnowledgeSearchResult } from "@/modules/knowledge/application/knowledge-search-service";
import { SearchTimeoutError } from "@/modules/knowledge/domain/errors";
import { applicationServices } from "@/server/composition";

export type SearchPageInput = {
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
  const navigation = await services.workspaceAdmin.navigation(caller);
  const workspace = navigation.items.find((item) => item.id === workspaceId);
  if (!workspace) notFound();
  const { actions } = await services.workspaceAdmin.workspaceState(caller, workspaceId);
  if (!actions.canSearch) notFound();

  const sources = sortSourcesByName(
    await services.queries
      .listSources(caller, workspaceId, { includeArchived: input.includeArchived })
      .catch(() => []),
  );
  const base = { ...input, workspaceId, workspaceName: workspace.name, sources };
  if (input.q.trim() === "") return { ...base, result: null, timedOut: false };
  try {
    const result = await services.search.search(caller, {
      q: input.q,
      scope: input.scope === "all" ? { kind: "all" } : { kind: "workspace", workspaceId },
      sourceId: input.scope === "all" ? null : input.sourceId,
      includeArchived: input.includeArchived,
      page: input.page,
    });
    return { ...base, result, timedOut: false };
  } catch (error) {
    if (error instanceof SearchTimeoutError) return { ...base, result: null, timedOut: true };
    throw error;
  }
}
