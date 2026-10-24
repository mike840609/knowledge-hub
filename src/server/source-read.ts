import { sortSourcesByName } from "@/lib/knowledge-navigation";
import { UNKNOWN_RUN_ACTOR } from "@/lib/sync-wording";
import type { SourceView } from "@/modules/knowledge/application/knowledge-query-service";
import type { SyncRun } from "@/modules/sources/domain/sync-run";
import type { WorkspaceActions } from "@/server/workspace-admin";
import type { WorkspaceView } from "@/modules/workspaces/application/workspace-query-service";
import { applicationServices } from "@/server/composition";
import { isHiddenReadFailure } from "./read-errors";

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
  } catch (error) {
    if (isHiddenReadFailure(error)) return null;
    throw error;
  }
  const items = await services.unitOfWork.run(async (repositories) => {
    // All sources (including archived) keep their latest run; HUB sources have
    // no sync runs or import previews, so those two lookups skip them.
    const scopedSources = sources.filter((source) => source.sourceType !== "HUB");
    const [latestRuns, latestAppliedRuns, pendingPreviewIds] = await Promise.all([
      repositories.syncRuns.listLatestBySourceIds(sources.map((source) => source.id)),
      repositories.syncRuns.listLatestAppliedBySourceIds(scopedSources.map((source) => source.id)),
      repositories.importSnapshots.findLatestReadyIdsBySourceForCreator(
        scopedSources.map((source) => ({ sourceId: source.id, basedOnVersion: source.syncVersion })),
        caller.identity.id,
        new Date(),
      ),
    ]);
    const latestRunBySource = new Map(latestRuns.map((run) => [run.sourceId, run]));
    const latestAppliedBySource = new Map(latestAppliedRuns.map((run) => [run.sourceId, run]));
    return sources.map((source) => ({
      pendingPreviewId: pendingPreviewIds.get(source.id) ?? null,
      source,
      latestRun: latestRunBySource.get(source.id) ?? null,
      latestSuccessfulRun: latestAppliedBySource.get(source.id) ?? null,
    }));
  });
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
    const { runs, runActors } = await services.unitOfWork.run(async (repositories) => {
      const runs = await repositories.syncRuns.listBySourceId(sourceId, SOURCE_RUN_DETAIL_LIMIT);
      const actorIds = [...new Set(runs.map((run) => run.triggeredBy))].filter((id) => id !== caller.identity.id);
      const actorNames = new Map((await repositories.users.findByIds(actorIds)).map((user) => [user.id, user.name]));
      const runActors = await resolveRunActors(runs, caller.identity.id, async (id) => actorNames.get(id) ?? null);
      return { runs, runActors };
    });
    return { workspace, actions, source, runs, runActors };
  } catch {
    return null;
  }
}
