import { notFound } from "next/navigation";
import { DocumentEditor } from "@/components/knowledge/document-editor";
import { getKnowledgeDocumentModel, getKnowledgeExplorerModel, getWorkspaceShellModel } from "@/server/knowledge-read";

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

  return (
    <DocumentEditor
      workspaceId={workspaceId}
      sourceId={sourceId}
      documentId={documentId}
      expectedCurrentRevisionId={model.view.currentRevision.id}
      initialTitle={model.view.currentRevision.title}
      initialMarkdown={model.view.currentRevision.markdown}
    />
  );
}
