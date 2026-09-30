import { notFound } from "next/navigation";
import { DocumentEditor } from "@/components/knowledge/document-editor";
import { MarkdownArticle } from "@/components/knowledge/markdown-article";
import { getKnowledgeDocumentModel, getKnowledgeExplorerModel, getWorkspaceShellModel } from "@/server/knowledge-read";
import { documentLocation } from "@/server/document-location";

export default async function EditDocumentPage({
  params,
}: {
  params: Promise<{ workspaceId: string; sourceId: string; documentId: string }>;
}) {
  const { workspaceId, sourceId, documentId } = await params;
  const model = await getKnowledgeDocumentModel(workspaceId, sourceId, documentId);
  const explorer = await getKnowledgeExplorerModel(workspaceId, sourceId);
  const shell = await getWorkspaceShellModel(workspaceId);
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
  return (
    <DocumentEditor
      workspaceId={workspaceId}
      sourceId={sourceId}
      documentId={documentId}
      userId={shell.identityId}
      standIn={<MarkdownArticle markdown={current.markdown} />}
      location={documentLocation(workspaceId, sourceId, explorer.source.name, explorer.tree, documentId)}
      metadataTitle={current.metadata.title}
      currentRevisionId={current.id}
      initialTitle={current.title}
      initialMarkdown={current.markdown}
    />
  );
}
