import { notFound } from "next/navigation";
import { extractOutline } from "@/shared/markdown/outline";
import { DocumentEditor } from "@/components/knowledge/document-editor";
import { MarkdownArticle } from "@/components/knowledge/markdown-article";
import { getKnowledgeDocumentModel, getKnowledgeExplorerModel, getWorkspaceShellModel } from "@/server/knowledge-read";
import { documentLocation } from "@/server/document-location";
import { documentInspectorData } from "@/server/document-inspector-data";
import { getDocumentLinkModel } from "@/server/link-graph-read";
import { EditorInspector } from "@/components/knowledge/document-inspector";

export default async function EditDocumentPage({
  params,
}: {
  params: Promise<{ workspaceId: string; sourceId: string; documentId: string }>;
}) {
  const { workspaceId, sourceId, documentId } = await params;
  // Independent reads, each authorized on its own; the link read only feeds the Details panel.
  const [model, explorer, shell, linkView] = await Promise.all([
    getKnowledgeDocumentModel(workspaceId, sourceId, documentId),
    getKnowledgeExplorerModel(workspaceId, sourceId),
    getWorkspaceShellModel(workspaceId),
    getDocumentLinkModel(workspaceId, documentId, { localGraphDepth: 1 }),
  ]);
  // Hiding the entry point is not the boundary; the server refuses here too.
  if (!model || !explorer || !shell) notFound();
  // Explicit lifecycle gate: canWrite already implies this (spec §8.1), but a
  // direct URL into an ARCHIVED workspace should be refused at the door, not
  // discovered only via a 409 at Save.
  if (shell.access.workspace.lifecycleState === "ARCHIVED") notFound();
  if (!shell.access.actions.canWrite) notFound();
  if (explorer.source.ownership !== "HUB_MANAGED") notFound();
  if (model.view.status !== "ACTIVE") notFound();

  const current = model.view.currentRevision;
  // The Details panel the reader shows, so one left open while reading stays open, and still, here.
  const outline = extractOutline(current.markdown);
  const inspectorData = documentInspectorData({
    workspaceId,
    workspaceName: shell.workspace.name,
    sourceId,
    sourceName: explorer.source.name,
    sourcePath: model.sourcePath,
    documentId,
    status: model.view.status,
    revisions: model.revisions,
    selectedRevisionNo: current.revisionNo,
    includeArchived: false,
    linkView,
    canCreate: shell.access.actions.canWrite,
    graphDepth: 1,
    depthHrefs: null,
  });
  return (
    <DocumentEditor
      workspaceId={workspaceId}
      sourceId={sourceId}
      documentId={documentId}
      userId={shell.identityId}
      standIn={<MarkdownArticle markdown={current.markdown} />}
      initialOutline={outline}
      inspector={<EditorInspector data={inspectorData} outline={outline} />}
      location={documentLocation(workspaceId, sourceId, explorer.source.name, explorer.tree, documentId)}
      metadataTitle={current.metadata.title}
      currentRevisionId={current.id}
      initialTitle={current.title}
      initialMarkdown={current.markdown}
    />
  );
}
