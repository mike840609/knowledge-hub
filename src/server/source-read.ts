import { sortSourcesByName } from "@/lib/knowledge-navigation";
import { getCurrentIdentity } from "@/modules/identity/application/get-current-identity";
import { callerFromIdentity } from "@/modules/identity/domain/caller-context";
import type { SourceView } from "@/modules/knowledge/application/knowledge-query-service";
import type { SyncRun } from "@/modules/sources/domain/sync-run";
import type { WorkspaceView } from "@/modules/workspaces/application/workspace-query-service";
import { applicationServices } from "@/server/composition";

export const SOURCE_RUN_LIST_LIMIT = 20;
export const SOURCE_RUN_DETAIL_LIMIT = 50;

export type SourceListItemModel = {
  source: SourceView;
  latestRun: SyncRun | null;
};

export type SourceListModel = {
  workspace: WorkspaceView;
  items: SourceListItemModel[];
};

export type SourceDetailModel = {
  workspace: WorkspaceView;
  source: SourceView;
  runs: SyncRun[];
};

/**
 * Task 7b read adapter: the only Web entry to the Source list/detail
 * boundary. Auth order is fixed: resolve the trusted caller identity, prove
 * Workspace/Source access through the existing Workspace/Knowledge queries,
 * and only then read SyncRuns. Inaccessible scopes return null and never
 * leak runs for a Source the caller cannot see.
 */
export async function getSourceListModel(workspaceId: string): Promise<SourceListModel | null> {
  const services = applicationServices();
  const identity = await getCurrentIdentity(services.identityProvider);
  const caller = callerFromIdentity(identity);
  const workspaces = await services.workspaces.listWorkspaces(caller);
  const workspace = workspaces.find((candidate) => candidate.id === workspaceId);
  if (!workspace) return null;
  let sources: SourceView[];
  try {
    sources = sortSourcesByName(await services.queries.listSources(caller, workspaceId));
  } catch {
    return null;
  }
  const items = await services.unitOfWork.run(async (repositories) =>
    Promise.all(
      sources.map(async (source) => {
        const runs = await repositories.syncRuns.listBySourceId(source.id, SOURCE_RUN_LIST_LIMIT);
        return { source, latestRun: runs[0] ?? null };
      }),
    ),
  );
  return { workspace, items };
}

export async function getSourceDetailModel(
  workspaceId: string,
  sourceId: string,
): Promise<SourceDetailModel | null> {
  const services = applicationServices();
  const identity = await getCurrentIdentity(services.identityProvider);
  const caller = callerFromIdentity(identity);
  try {
    const workspaces = await services.workspaces.listWorkspaces(caller);
    const workspace = workspaces.find((candidate) => candidate.id === workspaceId);
    if (!workspace) return null;
    const source = await services.queries.getSource(caller, sourceId);
    if (source.workspaceId !== workspaceId) return null;
    const sources = await services.queries.listSources(caller, workspaceId);
    if (!sources.some((candidate) => candidate.id === sourceId)) return null;
    const runs = await services.unitOfWork.run(async (repositories) =>
      repositories.syncRuns.listBySourceId(sourceId, SOURCE_RUN_DETAIL_LIMIT),
    );
    return { workspace, source, runs };
  } catch {
    return null;
  }
}
