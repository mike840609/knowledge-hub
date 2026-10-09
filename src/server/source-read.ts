import { sortSourcesByName } from "@/lib/knowledge-navigation";
import { UNKNOWN_RUN_ACTOR } from "@/lib/sync-wording";
import type { SourceView } from "@/modules/knowledge/application/knowledge-query-service";
import type { SyncRun } from "@/modules/sources/domain/sync-run";
import type { WorkspaceActions } from "@/server/workspace-admin";
import type { WorkspaceView } from "@/modules/workspaces/application/workspace-query-service";
import { applicationServices } from "@/server/composition";

export const SOURCE_RUN_LIST_LIMIT = 20;
export const SOURCE_RUN_DETAIL_LIMIT = 50;

export type SourceListItemModel = {
  source: SourceView;
  latestRun: SyncRun | null;
  pendingPreviewId?: string|null;
  latestSuccessfulRun?: SyncRun | null;
};

export type SourceListModel = {
  workspace: WorkspaceView;
  actions: WorkspaceActions;
  items: SourceListItemModel[];
};

export type SourceDetailModel = {
  workspace: WorkspaceView;
  actions: WorkspaceActions;
  source: SourceView;
  runs: SyncRun[];
  /** Who started each run, by identity id: "you", a name, or a neutral fallback — never the raw id. */
  runActors: Record<string, string>;
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
  const { caller } = await services.establishTrustedCaller();
  const workspaces = await services.workspaces.listWorkspaces(caller);
  const workspace = workspaces.find((candidate) => candidate.id === workspaceId);
  if (!workspace) return null;
  const { actions } = await services.workspaceAdmin.workspaceState(caller, workspaceId);
  if (!actions.canInspectSources) return null;
  let sources: SourceView[];
  try {
    sources = sortSourcesByName(await services.queries.listSources(caller, workspaceId, { includeArchived: true }));
  } catch {
    return null;
  }
  const items = await services.unitOfWork.run(async (repositories) =>
    Promise.all(
      sources.map(async (source) => {
        const runs = await repositories.syncRuns.listBySourceId(source.id, SOURCE_RUN_LIST_LIMIT);
        const successfulRuns = source.sourceType === "HUB" ? [] : await repositories.syncRuns.listBySourceId(source.id, 1, "APPLIED");
        const pending = source.sourceType === "HUB" ? null : await repositories.importSnapshots.findLatestReadyBySourceForCreator(source.id,caller.identity.id,new Date(),source.syncVersion);
        return { pendingPreviewId:pending?.id??null, source, latestRun: runs[0] ?? null, latestSuccessfulRun: successfulRuns[0] ?? null };
      }),
    ),
  );
  return { workspace, actions, items };
}

export { UNKNOWN_RUN_ACTOR };

/** One lookup per distinct actor: the caller is "you", anyone else their name, a missing user a neutral fallback. */
export async function resolveRunActors(
  runs: readonly Pick<SyncRun, "triggeredBy">[],
  callerId: string,
  findName: (identityId: string) => Promise<string | null>,
): Promise<Record<string, string>> {
  const actors: Record<string, string> = {};
  for (const actorId of new Set(runs.map((run) => run.triggeredBy))) {
    actors[actorId] = actorId === callerId ? "you" : (await findName(actorId)) ?? UNKNOWN_RUN_ACTOR;
  }
  return actors;
}

export async function getSourceDetailModel(
  workspaceId: string,
  sourceId: string,
): Promise<SourceDetailModel | null> {
  const services = applicationServices();
  const { caller } = await services.establishTrustedCaller();
  try {
    const workspaces = await services.workspaces.listWorkspaces(caller);
    const workspace = workspaces.find((candidate) => candidate.id === workspaceId);
    if (!workspace) return null;
    const { actions } = await services.workspaceAdmin.workspaceState(caller, workspaceId);
    if (!actions.canInspectSources) return null;
    const source = await services.queries.getSource(caller, sourceId, { includeArchived: true });
    if (source.workspaceId !== workspaceId) return null;
    const sources = await services.queries.listSources(caller, workspaceId, { includeArchived: true });
    if (!sources.some((candidate) => candidate.id === sourceId)) return null;
    const { runs, runActors } = await services.unitOfWork.run(async (repositories) => {
      const runs = await repositories.syncRuns.listBySourceId(sourceId, SOURCE_RUN_DETAIL_LIMIT);
      const runActors = await resolveRunActors(runs, caller.identity.id, async (id) => (await repositories.users.findById(id))?.name ?? null);
      return { runs, runActors };
    });
    return { workspace, actions, source, runs, runActors };
  } catch {
    return null;
  }
}
