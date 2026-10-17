import { EditableDocument } from "@/components/knowledge/editable-document";
import { OwnerReviewPanel } from "@/components/knowledge/owner-review-panel";
import { ReadRevisionMarker } from "@/components/knowledge/read-revision-marker";
import { RevisionRestore } from "@/components/knowledge/revision-restore";
import { getKnowledgeDocumentModel, getKnowledgeExplorerModel, getWorkspaceShellModel } from "@/server/knowledge-read";
import { documentLocation } from "@/server/document-location";
import { getDocumentLinkModel } from "@/server/link-graph-read";
import { DocumentDetailClient } from "@/components/knowledge/document-inspector";
import { documentInspectorData } from "@/server/document-inspector-data";
import { DocumentViewer } from "@/components/knowledge/document-viewer";
import { BacklinksFooter } from "@/components/knowledge/backlinks-footer";
import { renderedLinksFrom } from "@/components/knowledge/rendered-links";
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
  // Independent reads, each authorized on its own, so none waits for another.
  const [linkView, explorer, shell] = await Promise.all([
    getDocumentLinkModel(workspaceId, documentId, { includeArchived, revisionNo, localGraphDepth: graphDepth }),
    getKnowledgeExplorerModel(workspaceId, sourceId, { includeArchived: true }),
    getWorkspaceShellModel(workspaceId),
  ]);
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
    !isHistorical && revisionNo === undefined && explorer.source.status === "ACTIVE" &&
    shell.access.workspace.lifecycleState !== "ARCHIVED";
  const editHref = canEdit ? `/w/${workspaceId}/knowledge/${sourceId}/${documentId}/edit` : null;
  // A new document goes to the workspace's own Notes whatever this one is (a synced source's document
  // included), so what decides whether a broken link offers to make it is the capability to write here.
  const canCreate = shell?.access.actions.canWrite === true;
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

  const inspectorData = documentInspectorData({
    workspaceId,
    workspaceName: shell?.workspace.name,
    sourceId,
    sourceName: explorer?.source.name,
    sourcePath: model.sourcePath,
    documentId,
    status: view.status,
    revisions: model.revisions,
    selectedRevisionNo: selectedRevision.revisionNo,
    includeArchived,
    linkView,
    canCreate,
    graphDepth,
    depthHrefs: {
      1: `${documentHrefBase}${withParams({ graph: undefined })}`,
      2: `${documentHrefBase}${withParams({ graph: "2" })}`,
    },
  });

  const viewer = <DocumentViewer view={view} selectedRevision={selectedRevision} links={linkView ? renderedLinksFrom(linkView, inspectorData.createLinks ?? {}) : undefined} />;
  if (canEdit && shell && explorer) {
    return <EditableDocument key={documentId} markdown={selectedRevision.markdown} metadataTitle={selectedRevision.metadata.title}
      revisionId={selectedRevision.id} userId={shell.identityId} personal={shell.workspace.type === "PERSONAL"}
      standIn={viewer} links={linkView ? renderedLinksFrom(linkView, inspectorData.createLinks ?? {}) : undefined} backlinks={linkView ? <BacklinksFooter view={linkView} /> : null}
      detail={{ breadcrumb, title: selectedRevision.title, status: view.status, updatedAt: selectedRevision.createdAt,
        revisionBanner: null, inspectorData, editHref: null, sourceStatus: explorer.source.status, readOnly: false,
        syncHref: null, ownership: explorer.source.ownership, contentOwnsTitle, outline: extractOutline(selectedRevision.markdown) }} />;
  }
  return (
    <DocumentDetailClient
      breadcrumb={breadcrumb}
      title={selectedRevision.title}
      status={view.status}
      updatedAt={selectedRevision.createdAt}
      revisionBanner={
        revisionNo !== undefined
          ? {
              viewingNo: selectedRevision.revisionNo,
              backHref: `/w/${workspaceId}/knowledge/${sourceId}/${documentId}${archivedSuffix}`,
            }
          : null
      }
      inspectorData={inspectorData}
      readOnlyReason={!sourceManaged && !canEdit ? <span>Read only{revisionNo !== undefined ? " · revision snapshot" : view.status === "ARCHIVED" || explorer?.source.status === "ARCHIVED" || shell?.access.workspace.lifecycleState === "ARCHIVED" ? " · archived" : " · no edit permission"}</span> : undefined}
      editHref={editHref}
      sourceStatus={explorer?.source.status ?? "ARCHIVED"}
      readOnly={sourceManaged}
      syncHref={explorer?.source.sourceType === "FOLDER_SYNC" && explorer.source.status === "ACTIVE" ? `/w/${workspaceId}/sources/${sourceId}/update` : null}
      ownership={explorer?.source.ownership ?? "SOURCE_MANAGED"}
      contentOwnsTitle={contentOwnsTitle}
      outline={extractOutline(selectedRevision.markdown)}
    >
      <div className="kh-reading-column py-6">
        {isHistorical && <RevisionRestore documentId={documentId} href={`/w/${workspaceId}/knowledge/${sourceId}/${documentId}`} historical={selectedRevision} current={view.currentRevision} editable={!sourceManaged && view.status === "ACTIVE" && explorer?.source.status === "ACTIVE"} />}
        {shell?.workspace.type === "PERSONAL" ? <ReadRevisionMarker workspaceId={workspaceId} documentId={documentId} revisionId={selectedRevision.id}/> : null}
        {/* The owner's discussions go beside the article they are about, so the panel holds it. */}
        {shell?.workspace.type === "PERSONAL" && !isHistorical
          ? <OwnerReviewPanel key={documentId} readOnly={view.status !== "ACTIVE" || explorer?.source.status !== "ACTIVE"} documentId={documentId} revisionId={view.currentRevision.id} markdown={view.currentRevision.markdown}>{viewer}</OwnerReviewPanel>
          : viewer}
        {linkView ? <BacklinksFooter view={linkView} /> : null}
      </div>
    </DocumentDetailClient>
  );
}
