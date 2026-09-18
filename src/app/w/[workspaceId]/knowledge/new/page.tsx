import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { NewDocumentForm } from "@/components/knowledge/new-document-form";
import { getWorkspaceShellModel } from "@/server/knowledge-read";

export default async function NewNotePage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const model = await getWorkspaceShellModel(workspaceId);
  if (!model?.access.actions.canWrite) notFound();
  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 px-6 py-8">
      <Link href={`/w/${workspaceId}/knowledge`} className="inline-flex min-h-10 items-center gap-2 rounded text-sm text-kh-text-muted hover:text-kh-text focus:outline-none focus-visible:ring-2 focus-visible:ring-kh-focus">
        <ArrowLeft size={15} aria-hidden="true" /> Back to documents
      </Link>
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-kh-text">Add to Notes</h1>
        <p className="text-sm text-kh-text-muted">Write a document or upload a Markdown file to Notes in {model.workspace.name}.</p>
      </header>
      <NewDocumentForm workspaceId={workspaceId} variant="empty" />
    </main>
  );
}
