import { notFound } from "next/navigation";
import { NewDocumentForm } from "@/components/knowledge/new-document-form";
import { getWorkspaceShellModel } from "@/server/knowledge-read";

export default async function NewNotePage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const model = await getWorkspaceShellModel(workspaceId);
  if (!model?.access.actions.canWrite) notFound();
  return <NewDocumentForm workspaceId={workspaceId} workspaceName={model.workspace.name} />;
}
