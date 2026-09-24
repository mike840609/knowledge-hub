import { notFound } from "next/navigation";
import { NewDocumentForm } from "@/components/knowledge/new-document-form";
import { getWorkspaceShellModel } from "@/server/knowledge-read";
import { PageHeader } from "@/components/shell/page-header";

export default async function NewNotePage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const model = await getWorkspaceShellModel(workspaceId);
  if (!model?.access.actions.canWrite) notFound();
  return (
    <main className="kh-reading-column py-6">
      <PageHeader location="Documents" locationHref={`/w/${workspaceId}/knowledge`} title="New document" description={`Write a document or upload a Markdown file to Notes in ${model.workspace.name}.`} />
      <div className="mt-6"><NewDocumentForm workspaceId={workspaceId} variant="empty" /></div>
    </main>
  );
}
