import type { DocumentLinkView } from "@/modules/knowledge/application/knowledge-link-service";
import type { DocumentBreadcrumbSegment } from "@/components/knowledge/document-breadcrumb";
import { documentLocation } from "@/server/document-location";
import { getKnowledgeExplorerModel, getWorkspaceShellModel } from "@/server/knowledge-read";
import { workspaceHttp } from "@/server/workspace-http";

export async function GET(_request: Request, context: { params: Promise<{ documentId: string }> }) {
  return workspaceHttp(async (services, caller) => {
    const { documentId } = await context.params;
    // Scope is derived server-side: the document's own Source/Workspace decide
    // what the caller may see. Client workspace/source inputs are never trusted.
    // Both reads enforce membership and exclude archived documents/sources, so
    // unauthorized or archived access fails exactly like the preview route.
    const view = await services.queries.getDocument(caller, documentId);
    const source = await services.queries.getSource(caller, view.sourceId);
    // What this document links to and what links to it, for the side-peek
    // pane's clickable wikilinks. Like the full page's getDocumentLinkModel
    // null path, any failure becomes null and the pane renders plain text.
    let linkView: DocumentLinkView | null = null;
    try {
      const resolved = await services.links.getDocumentLinks(caller, documentId);
      linkView = resolved.workspaceId === view.workspaceId ? resolved : null;
    } catch {
      linkView = null;
    }
    // Header facts under the same conditions as the full page (page.tsx): the
    // explorer and the shell are authorized reads of their own, so either one
    // failing closes the facts it feeds instead of failing the peek.
    const [explorer, shell] = await Promise.all([
      getKnowledgeExplorerModel(view.workspaceId, view.sourceId, { includeArchived: true }).catch(() => null),
      getWorkspaceShellModel(view.workspaceId).catch(() => null),
    ]);
    const title = view.currentRevision.title;
    const breadcrumb: DocumentBreadcrumbSegment[] = explorer
      ? [...documentLocation(view.workspaceId, view.sourceId, explorer.source.name, explorer.tree, view.documentId), { label: title }]
      : [{ label: title }];
    const sourceManaged = explorer?.source.ownership !== "HUB_MANAGED";
    const canEdit =
      shell?.access.actions.canWrite === true &&
      explorer?.source.ownership === "HUB_MANAGED" &&
      view.status === "ACTIVE";
    return {
      title,
      markdown: view.currentRevision.markdown,
      ownership: source.ownership,
      workspaceId: view.workspaceId,
      sourceId: view.sourceId,
      documentId: view.documentId,
      linkView,
      breadcrumb,
      updatedAt: new Date(view.currentRevision.createdAt).toISOString(),
      status: view.status,
      sourceStatus: explorer?.source.status ?? "ARCHIVED",
      readOnly: sourceManaged,
      editHref: canEdit ? `/w/${view.workspaceId}/knowledge/${view.sourceId}/${view.documentId}/edit` : null,
      syncHref:
        explorer?.source.sourceType === "FOLDER_SYNC" && explorer.source.status === "ACTIVE"
          ? `/w/${view.workspaceId}/sources/${view.sourceId}/update`
          : null,
      canShare:
        shell?.workspace.type === "PERSONAL" && view.status === "ACTIVE" && explorer?.source.status === "ACTIVE",
    };
  });
}
