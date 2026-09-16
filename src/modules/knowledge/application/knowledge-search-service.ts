import type { CallerContext } from "@/modules/identity/domain/caller-context";
import { evaluateWorkspaceCapabilities } from "@/modules/workspaces/application/workspace-authorization";
import type { WorkspaceQueryService } from "@/modules/workspaces/application/workspace-query-service";
import { parseSearchQuery } from "../domain/search-query";
import type { KnowledgeSearchRow } from "../ports/knowledge-search-repository";
import type { KnowledgeRepositories, KnowledgeUnitOfWork } from "../ports/unit-of-work";

export const SEARCH_PAGE_SIZE = 20;
export const SEARCH_MAX_PAGE = 50;

export type SearchScope = { kind: "workspace"; workspaceId: string } | { kind: "all" };

export type KnowledgeSearchInput = {
  q: string;
  scope: SearchScope;
  sourceId?: string | null;
  includeArchived?: boolean;
  page?: number;
};

export type KnowledgeSearchResult = {
  terms: string[];
  hits: KnowledgeSearchRow[];
  page: number;
  hasNext: boolean;
  tooLong: boolean;
};

/**
 * Phase 4 spec §5. A keyword match IS a read: a hit proves the document
 * contains the term, so matching only ever happens inside Workspaces where
 * the caller holds document.read. Discover-only Workspaces contribute no
 * hits, no counts and no names.
 */
export class KnowledgeSearchService {
  constructor(
    private readonly unitOfWork: KnowledgeUnitOfWork,
    private readonly workspaces: WorkspaceQueryService,
  ) {}

  async search(caller: CallerContext, input: KnowledgeSearchInput): Promise<KnowledgeSearchResult> {
    const parsed = parseSearchQuery(input.q);
    const page = Math.min(Math.max(input.page ?? 1, 1), SEARCH_MAX_PAGE);
    const includeArchived = input.includeArchived ?? false;
    if (parsed.tooLong || parsed.terms.length === 0) {
      return { terms: parsed.terms, hits: [], page, hasNext: false, tooLong: parsed.tooLong };
    }
    // The accessible list is read outside the search transaction, exactly as
    // the existing read models do; capabilities are then re-checked per row.
    const accessible = input.scope.kind === "all" ? await this.workspaces.listWorkspaces(caller) : [];
    return this.unitOfWork.run(async (repositories) => {
      await repositories.users.upsertIdentity(caller.identity);
      const workspaceIds = input.scope.kind === "workspace"
        ? await scopedWorkspace(repositories, caller, input.scope.workspaceId)
        : await readableWorkspaces(
            repositories,
            caller,
            accessible.filter((workspace) => includeArchived || workspace.lifecycleState !== "ARCHIVED").map((workspace) => workspace.id),
          );
      const rows = await repositories.search.search({
        terms: parsed.terms,
        workspaceIds,
        sourceId: input.sourceId ?? null,
        includeArchived,
        limit: SEARCH_PAGE_SIZE + 1,
        offset: (page - 1) * SEARCH_PAGE_SIZE,
      });
      return {
        terms: parsed.terms,
        hits: rows.slice(0, SEARCH_PAGE_SIZE),
        page,
        hasNext: rows.length > SEARCH_PAGE_SIZE,
        tooLong: false,
      };
    });
  }
}

/** Undiscoverable -> not found; discoverable but unreadable -> access denied. */
async function scopedWorkspace(
  repositories: KnowledgeRepositories,
  caller: CallerContext,
  workspaceId: string,
): Promise<string[]> {
  await repositories.workspaceAccess.requireWorkspaceRead(caller, workspaceId);
  return [workspaceId];
}

async function readableWorkspaces(
  repositories: KnowledgeRepositories,
  caller: CallerContext,
  candidateIds: readonly string[],
): Promise<string[]> {
  const readable: string[] = [];
  for (const workspaceId of candidateIds) {
    const capabilities = await evaluateWorkspaceCapabilities(repositories, caller, workspaceId);
    if (capabilities.has("document.read")) readable.push(workspaceId);
  }
  return readable;
}
