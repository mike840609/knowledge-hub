import { findFirstReadableDocument, sortSourcesByName } from "@/lib/knowledge-navigation";
import type { KnowledgeTreeItem, SourceView } from "@/modules/knowledge/application/knowledge-query-service";
import type { WorkspaceAccessView, WorkspaceNavigationModel, WorkspaceNavigationItem } from "@/server/workspace-admin";
import { applicationServices } from "@/server/composition";

export type KnowledgeDocumentModel = {
  view: {
    documentId: string;
    sourceId: string;
    workspaceId: string;
    status: "ACTIVE" | "ARCHIVED";
    currentRevision: import("@/modules/knowledge/application/knowledge-query-service").KnowledgeRevisionView;
  };
  revisions: import("@/modules/knowledge/application/knowledge-query-service").KnowledgeRevisionView[];
  selectedRevision: import("@/modules/knowledge/application/knowledge-query-service").KnowledgeRevisionView;
};

/**
 * Task 5 read model: Workspace/Source-scoped Document load. Trusted caller
 * identity comes from the provider and the query service re-enforces
 * membership; route IDs are navigation scope only, never authorization proof.
 * After loading, the Document's owning Workspace/Source must match the route —
 * a mismatch (or any access failure) resolves to null, never to another
 * scope's content. `revisionNo` selects a historical revision (?revision=N).
 */
export async function getKnowledgeDocumentModel(
  workspaceId: string,
  sourceId: string,
  documentId: string,
  input: { includeArchived?: boolean; revisionNo?: number } = {},
): Promise<KnowledgeDocumentModel | null> {
  try {
    const services = applicationServices();
    const { caller } = await services.establishTrustedCaller();
    const view = await services.queries.getDocument(caller, documentId, { includeArchived: input.includeArchived });
    const revisions = await services.queries.listRevisions(caller, documentId, { includeArchived: input.includeArchived });
    const selectedRevision = input.revisionNo === undefined
      ? view.currentRevision
      : await services.queries.getRevision(caller, documentId, input.revisionNo, { includeArchived: input.includeArchived });
    if (view.workspaceId !== workspaceId || view.sourceId !== sourceId) return null;
    return { view, revisions, selectedRevision };
  } catch {
    return null;
  }
}

export type WorkspaceShellModel = {
  identityName: string;
  identityEmpId: string;
  workspaces: readonly WorkspaceNavigationItem[];
  workspace: WorkspaceNavigationItem;
  navigation: WorkspaceNavigationModel;
  access: WorkspaceAccessView;
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
  const { caller, identity } = await services.establishTrustedCaller();
  const navigation = await services.workspaceAdmin.navigation(caller);
  const workspaces = navigation.items;
  const workspace = workspaces.find((candidate) => candidate.id === workspaceId);
  if (!workspace) return null;
  const access = await services.workspaceAdmin.workspaceState(caller, workspaceId);
  return {
    navigation,
    access,
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
  const { caller } = await services.establishTrustedCaller();
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
  const { caller } = await services.establishTrustedCaller();
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
