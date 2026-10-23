import { applicationServices } from "./composition";
import { getWorkspaceShellModel } from "./knowledge-read";
import { isHiddenReadFailure } from "./read-errors";

export type DraftRecoveryModel = {
  draft: { key: string; title: string; markdown: string; updatedAt: string };
  document: {
    documentId: string;
    sourceId: string;
    status: "ACTIVE" | "ARCHIVED";
    sourceStatus: "ACTIVE" | "ARCHIVED";
    ownership: "HUB_MANAGED" | "SOURCE_MANAGED";
    title: string;
  };
  canRestore: boolean;
  canWrite: boolean;
  sourceArchived: boolean;
  workspaceArchived: boolean;
  folderArchived: boolean;
  treeNodeMissing: boolean;
};

/**
 * The read model behind the read-only draft recovery page. The draft is already
 * authorized by PersonalService.get; the document and source are read with
 * includeArchived so an archived original still explains why it cannot be edited.
 * A known not-found/access failure is the same answer as a missing draft; anything
 * else must reach the route error boundary.
 */
export async function getDraftRecoveryModel(
  workspaceId: string,
  sourceId: string,
  documentId: string,
): Promise<DraftRecoveryModel | null> {
  const services = applicationServices();
  const { caller } = await services.establishTrustedCaller();
  try {
    const item = await services.personal.get(caller, workspaceId, `draft:${documentId}`);
    const value = item.value;
    const title = value?.title;
    const markdown = value?.markdown;
    if (typeof title !== "string" || typeof markdown !== "string") return null;

    const document = await services.queries.getDocument(caller, documentId, { includeArchived: true });
    if (document.workspaceId !== workspaceId || document.sourceId !== sourceId) return null;
    const source = await services.queries.getSource(caller, sourceId, { includeArchived: true });
    const tree = await services.queries.listTree(caller, sourceId, { includeArchived: true });
    const shell = await getWorkspaceShellModel(workspaceId);
    if (!shell) return null;

    const byId = new Map(tree.map(node => [node.id, node]));
    const node = tree.find(candidate => candidate.type === "document" && candidate.documentId === documentId);
    let treeNodeMissing = !node;
    let folderArchived = false;
    if (node) {
      let parentId = node.parentId;
      while (parentId) {
        const parent = byId.get(parentId);
        if (!parent) { treeNodeMissing = true; break; }
        if (parent.type === "folder" && parent.status === "ARCHIVED") { folderArchived = true; break; }
        parentId = parent.parentId;
      }
    }

    const canWrite = shell.access.actions.canWrite;
    const workspaceArchived = shell.access.workspace.lifecycleState === "ARCHIVED";
    const canRestore =
      canWrite &&
      !workspaceArchived &&
      !folderArchived &&
      !treeNodeMissing &&
      document.status === "ARCHIVED" &&
      source.status === "ACTIVE" &&
      source.ownership === "HUB_MANAGED";

    return {
      draft: { key: item.key, title, markdown, updatedAt: item.updatedAt },
      document: {
        documentId: document.documentId,
        sourceId: document.sourceId,
        status: document.status,
        sourceStatus: source.status,
        ownership: source.ownership,
        title: document.currentRevision.title,
      },
      canRestore,
      canWrite,
      sourceArchived: source.status === "ARCHIVED",
      workspaceArchived,
      folderArchived,
      treeNodeMissing,
    };
  } catch (error) {
    if (isHiddenReadFailure(error)) return null;
    throw error;
  }
}
