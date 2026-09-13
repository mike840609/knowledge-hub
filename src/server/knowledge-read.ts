import { findFirstReadableDocument, sortSourcesByName } from "@/lib/knowledge-navigation";
import { getCurrentIdentity } from "@/modules/identity/application/get-current-identity";
import { callerFromIdentity } from "@/modules/identity/domain/caller-context";
import type { KnowledgeTreeItem, SourceView } from "@/modules/knowledge/application/knowledge-query-service";
import type { WorkspaceView } from "@/modules/workspaces/application/workspace-query-service";
import { applicationServices } from "@/server/composition";

export type KnowledgeBrowserModel = {
  identityName: string;
  identityEmpId: string;
  identityOrg: string;
  workspaces: WorkspaceView[];
  selectedWorkspaceId: string | undefined;
  sources: SourceView[];
  selectedSourceId: string | undefined;
  sourceTrees: { source: SourceView; tree: KnowledgeTreeItem[] }[];
  includeArchived: boolean;
};

/**
 * Task 9 read adapter: the only Web entry to the query boundary. Caller
 * identity always comes from the trusted provider; URL search params carry
 * navigation scope only (workspace/source/archived) and are never
 * authorization evidence — the query services re-enforce membership.
 */
export async function getKnowledgeBrowserModel(input: {
  workspaceId?: string;
  sourceId?: string;
  includeArchived?: boolean;
}): Promise<KnowledgeBrowserModel> {
  const services = applicationServices();
  const identity = await getCurrentIdentity(services.identityProvider);
  const caller = callerFromIdentity(identity);
  const workspaces = await services.workspaces.listWorkspaces(caller);
  const selectedWorkspaceId = workspaces.some((workspace) => workspace.id === input.workspaceId)
    ? input.workspaceId
    : workspaces[0]?.id;
  const includeArchived = input.includeArchived ?? false;
  const sources = selectedWorkspaceId
    ? await services.queries.listSources(caller, selectedWorkspaceId, { includeArchived })
    : [];
  const selectedSourceId = sources.some((source) => source.id === input.sourceId) ? input.sourceId : undefined;
  const visibleSources = selectedSourceId ? sources.filter((source) => source.id === selectedSourceId) : sources;
  const sourceTrees = await Promise.all(
    visibleSources.map(async (source) => ({ source, tree: await services.queries.listTree(caller, source.id, { includeArchived }) })),
  );
  return {
    identityName: identity.name,
    identityEmpId: identity.emp_id,
    identityOrg: identity.org_code,
    workspaces,
    selectedWorkspaceId,
    sources,
    selectedSourceId,
    sourceTrees,
    includeArchived,
  };
}

export async function getKnowledgeDocumentModel(documentId: string, input: { includeArchived?: boolean; revisionNo?: number } = {}) {
  const services = applicationServices();
  const caller = callerFromIdentity(await getCurrentIdentity(services.identityProvider));
  const view = await services.queries.getDocument(caller, documentId, { includeArchived: input.includeArchived });
  const revisions = await services.queries.listRevisions(caller, documentId, { includeArchived: input.includeArchived });
  const selectedRevision = input.revisionNo === undefined
    ? view.currentRevision
    : await services.queries.getRevision(caller, documentId, input.revisionNo, { includeArchived: input.includeArchived });
  return { view, revisions, selectedRevision };
}

export type WorkspaceShellModel = {
  identityName: string;
  identityEmpId: string;
  workspaces: WorkspaceView[];
  workspace: WorkspaceView;
};

export type KnowledgeExplorerModel = {
  sources: SourceView[];
  source: SourceView;
  tree: KnowledgeTreeItem[];
  includeArchived: boolean;
};

/**
 * Task 2 read models: Workspace-scoped resolvers. Trusted caller identity
 * comes from the provider; route IDs are navigation scope only. Inaccessible
 * IDs return null and must not silently fall back to another Workspace/Source.
 */
export async function getWorkspaceShellModel(
  workspaceId: string,
): Promise<WorkspaceShellModel | null> {
  const services = applicationServices();
  const identity = await getCurrentIdentity(services.identityProvider);
  const caller = callerFromIdentity(identity);
  const workspaces = await services.workspaces.listWorkspaces(caller);
  const workspace = workspaces.find((candidate) => candidate.id === workspaceId);
  if (!workspace) return null;
  return {
    identityName: identity.name,
    identityEmpId: identity.emp_id,
    workspaces,
    workspace,
  };
}

export async function getKnowledgeExplorerModel(
  workspaceId: string,
  sourceId: string,
  input: { includeArchived?: boolean } = {},
): Promise<KnowledgeExplorerModel | null> {
  const services = applicationServices();
  const identity = await getCurrentIdentity(services.identityProvider);
  const caller = callerFromIdentity(identity);
  const includeArchived = input.includeArchived ?? false;
  try {
    const workspaces = await services.workspaces.listWorkspaces(caller);
    if (!workspaces.some((workspace) => workspace.id === workspaceId)) return null;
    const source = await services.queries.getSource(caller, sourceId, { includeArchived });
    if (source.workspaceId !== workspaceId) return null;
    const sources = await services.queries.listSources(caller, workspaceId, { includeArchived });
    if (!sources.some((candidate) => candidate.id === sourceId)) return null;
    const tree = await services.queries.listTree(caller, sourceId, { includeArchived });
    return { sources: sortSourcesByName(sources), source, tree, includeArchived };
  } catch {
    return null;
  }
}

export async function getDefaultKnowledgeTarget(
  workspaceId: string,
): Promise<{ sourceId: string; documentId: string } | null> {
  const services = applicationServices();
  const caller = callerFromIdentity(await getCurrentIdentity(services.identityProvider));
  try {
    const sources = sortSourcesByName(
      await services.queries.listSources(caller, workspaceId),
    );
    for (const source of sources) {
      const tree = await services.queries.listTree(caller, source.id);
      const first = findFirstReadableDocument(tree);
      if (first) return { sourceId: source.id, documentId: first.documentId };
    }
    return null;
  } catch {
    return null;
  }
}
