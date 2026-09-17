import { getKnowledgeDocumentModel, getKnowledgeExplorerModel, getWorkspaceShellModel } from "@/server/knowledge-read";
import type { KnowledgeTreeItem } from "@/modules/knowledge/application/knowledge-query-service";
import type { DocumentBreadcrumbSegment } from "@/components/knowledge/document-header";
import { DocumentDetailClient, type DocumentInspectorData } from "@/components/knowledge/document-inspector";
import { DocumentViewer } from "@/components/knowledge/document-viewer";

function buildBreadcrumb(
  workspaceId: string,
  sourceId: string,
  sourceName: string,
  tree: KnowledgeTreeItem[],
  documentId: string,
  title: string,
): DocumentBreadcrumbSegment[] {
  const byId = new Map(tree.map((item) => [item.id, item]));
  const node = tree.find((item) => item.type === "document" && item.documentId === documentId);
  const segments: DocumentBreadcrumbSegment[] = [
    { label: sourceName, href: `/w/${workspaceId}/knowledge/${sourceId}` },
  ];
  if (node) {
    const folders: string[] = [];
    let current = node.parentId ? byId.get(node.parentId) : undefined;
    while (current) {
      if (current.type === "folder") folders.unshift(current.label);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    for (const folder of folders) segments.push({ label: folder });
  }
  segments.push({ label: title });
  return segments;
}

export default async function KnowledgeDocumentPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string; sourceId: string; documentId: string }>;
  searchParams?: Promise<{ includeArchived?: string; revision?: string }>;
}) {
  const { workspaceId, sourceId, documentId } = await params;
  const query = await searchParams;
  const includeArchived = query?.includeArchived === "true";

  let revisionNo: number | undefined;
  if (query?.revision !== undefined) {
    if (!/^[0-9]+$/.test(query.revision)) {
      return (
        <div className="mx-auto w-full max-w-[860px] px-6 py-16">
          <h1 className="text-2xl font-semibold">Not found or no access</h1>
        </div>
      );
    }
    const parsed = Number(query.revision);
    if (!Number.isSafeInteger(parsed) || parsed < 1) {
      return (
        <div className="mx-auto w-full max-w-[860px] px-6 py-16">
          <h1 className="text-2xl font-semibold">Not found or no access</h1>
        </div>
      );
    }
    revisionNo = parsed;
  }

  const model = await getKnowledgeDocumentModel(workspaceId, sourceId, documentId, { includeArchived, revisionNo });
  if (!model) {
    return (
      <div className="mx-auto w-full max-w-[860px] px-6 py-16">
        <h1 className="text-2xl font-semibold">Not found or no access</h1>
      </div>
    );
  }

  const { view, selectedRevision } = model;
  const isHistorical = selectedRevision.id !== view.currentRevision.id;
  const archivedSuffix = includeArchived ? "?includeArchived=true" : "";

  const explorer = await getKnowledgeExplorerModel(workspaceId, sourceId, { includeArchived: true });
  const shell = await getWorkspaceShellModel(workspaceId);
  // Badge visibility is ownership, not editability (spec §8.3): a HUB_MANAGED
  // document is never "Read only" even when this particular view (e.g. a
  // historical revision, or a viewer without canWrite) cannot be edited right
  // now — that is communicated separately (the revision banner, or simply the
  // absence of an Edit link), not by mislabeling the document itself.
  const sourceManaged = explorer?.source.ownership !== "HUB_MANAGED";
  const canEdit =
    shell?.access.actions.canWrite === true &&
    explorer?.source.ownership === "HUB_MANAGED" &&
    view.status === "ACTIVE" &&
    !isHistorical;
  const editHref = canEdit ? `/w/${workspaceId}/knowledge/${sourceId}/${documentId}/edit` : null;
  const breadcrumb = explorer
    ? buildBreadcrumb(workspaceId, sourceId, explorer.source.name, explorer.tree, documentId, selectedRevision.title)
    : [{ label: selectedRevision.title }];

  const inspectorData: DocumentInspectorData = {
    workspaceId,
    workspaceName: shell?.workspace.name ?? workspaceId,
    sourceId,
    sourceName: explorer?.source.name ?? sourceId,
    documentId,
    status: view.status,
    revisions: model.revisions,
    selectedRevisionNo: selectedRevision.revisionNo,
    includeArchived,
  };

  return (
    <DocumentDetailClient
      breadcrumb={breadcrumb}
      title={selectedRevision.title}
      status={view.status}
      updatedAt={selectedRevision.createdAt}
      revisionBanner={
        isHistorical
          ? {
              viewingNo: selectedRevision.revisionNo,
              backHref: `/w/${workspaceId}/knowledge/${sourceId}/${documentId}${archivedSuffix}`,
            }
          : null
      }
      inspectorData={inspectorData}
      editHref={editHref}
      readOnly={sourceManaged}
    >
      <div className="mx-auto w-full max-w-[860px] px-6 py-6">
        <DocumentViewer view={view} selectedRevision={selectedRevision} />
      </div>
    </DocumentDetailClient>
  );
}
