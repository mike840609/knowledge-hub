import { getKnowledgeDocumentModel, getKnowledgeExplorerModel, getWorkspaceShellModel } from "@/server/knowledge-read";
import { documentLocation } from "@/server/document-location";
import { getDocumentLinkModel } from "@/server/link-graph-read";
import { DocumentDetailClient, type DocumentInspectorData } from "@/components/knowledge/document-inspector";
import { DocumentViewer } from "@/components/knowledge/document-viewer";
import { BacklinksFooter } from "@/components/knowledge/backlinks-footer";
import { renderedLinksFrom } from "@/components/knowledge/rendered-links";
import { toGraphViewData } from "@/components/knowledge/graph-model";
import { StatusMessage } from "@/components/ui/status-message";
import { markdownOpensWithHeading } from "@/lib/markdown-title";
import { extractOutline } from "@/shared/markdown/outline";

export default async function KnowledgeDocumentPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string; sourceId: string; documentId: string }>;
  searchParams?: Promise<{ includeArchived?: string; revision?: string; graph?: string }>;
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

  // What this document links to and what links to it, for the revision on
  // screen. Absent, the page still renders: links are then just their text.
  const graphDepth: 1 | 2 = query?.graph === "2" ? 2 : 1;
  const linkView = await getDocumentLinkModel(workspaceId, documentId, { includeArchived, revisionNo, localGraphDepth: graphDepth });
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

  // The current address with one parameter changed, for the depth toggle.
  const documentHrefBase = `/w/${workspaceId}/knowledge/${sourceId}/${documentId}`;
  const withParams = (change: { graph: string | undefined }) => {
    const next = new URLSearchParams();
    if (includeArchived) next.set("includeArchived", "true");
    if (query?.revision !== undefined) next.set("revision", query.revision);
    if (change.graph !== undefined) next.set("graph", change.graph);
    const text = next.toString();
    return text === "" ? "" : `?${text}`;
  };

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
    links: linkView,
    localGraph: linkView?.localGraph && linkView.localGraph.nodes.length > 0
      ? {
          data: toGraphViewData({
            workspaceId,
            nodes: linkView.localGraph.nodes,
            edges: linkView.localGraph.edges,
            sourceNames: new Map([[sourceId, explorer?.source.name ?? ""]]),
          }),
          depth: graphDepth,
          openHref: `/w/${workspaceId}/graph?focus=${documentId}`,
          depthHrefs: {
            1: `${documentHrefBase}${withParams({ graph: undefined })}`,
            2: `${documentHrefBase}${withParams({ graph: "2" })}`,
          },
        }
      : null,
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
        <DocumentViewer view={view} selectedRevision={selectedRevision} links={linkView ? renderedLinksFrom(linkView) : undefined} />
        {linkView ? <BacklinksFooter view={linkView} /> : null}
      </div>
    </DocumentDetailClient>
  );
}
