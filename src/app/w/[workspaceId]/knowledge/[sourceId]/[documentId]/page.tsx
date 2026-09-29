import { getKnowledgeDocumentModel, getKnowledgeExplorerModel, getWorkspaceShellModel } from "@/server/knowledge-read";
import { documentLocation } from "@/server/document-location";
import { DocumentDetailClient, type DocumentInspectorData } from "@/components/knowledge/document-inspector";
import { DocumentViewer } from "@/components/knowledge/document-viewer";
import { StatusMessage } from "@/components/ui/status-message";
import { markdownOpensWithHeading } from "@/lib/markdown-title";
import { extractOutline } from "@/shared/markdown/outline";

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
        <StatusMessage
          title="Not found or no access"
          description="This content does not exist or you do not have access to it."
        />
      );
    }
    const parsed = Number(query.revision);
    if (!Number.isSafeInteger(parsed) || parsed < 1) {
      return (
        <StatusMessage
          title="Not found or no access"
          description="This content does not exist or you do not have access to it."
        />
      );
    }
    revisionNo = parsed;
  }

  const model = await getKnowledgeDocumentModel(workspaceId, sourceId, documentId, { includeArchived, revisionNo });
  if (!model) {
    return (
      <StatusMessage
        title="Not found or no access"
        description="This content does not exist or you do not have access to it."
      />
    );
  }

  const { view, selectedRevision } = model;
  const contentOwnsTitle = markdownOpensWithHeading(selectedRevision.markdown);
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
    ? [...documentLocation(workspaceId, sourceId, explorer.source.name, explorer.tree, documentId), { label: selectedRevision.title }]
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
      sourceStatus={explorer?.source.status ?? "ARCHIVED"}
      readOnly={sourceManaged}
      ownership={explorer?.source.ownership ?? "SOURCE_MANAGED"}
      contentOwnsTitle={contentOwnsTitle}
      outline={extractOutline(selectedRevision.markdown)}
    >
      <div className="kh-reading-column py-6">
        <DocumentViewer view={view} selectedRevision={selectedRevision} />
      </div>
    </DocumentDetailClient>
  );
}
