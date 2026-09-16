import { notFound } from "next/navigation";
import { sortSourcesByName } from "@/lib/knowledge-navigation";
import type { SourceView } from "@/modules/knowledge/application/knowledge-query-service";
import type { KnowledgeSearchResult } from "@/modules/knowledge/application/knowledge-search-service";
import { SearchTimeoutError } from "@/modules/knowledge/domain/errors";
import { applicationServices } from "@/server/composition";
import { DomainError } from "@/shared/domain/errors";

const AUTHORIZATION_NOT_FOUND_CODES = ["WORKSPACE_NOT_FOUND", "WORKSPACE_ACCESS_DENIED", "INSUFFICIENT_WORKSPACE_CAPABILITY"];

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
