import Link from "next/link";
import { redirect } from "next/navigation";
import { findFirstReadableDocument } from "@/lib/knowledge-navigation";
import { getKnowledgeExplorerModel } from "@/server/knowledge-read";

export default async function SourceKnowledgePage({
  params,
}: {
  params: Promise<{ workspaceId: string; sourceId: string }>;
}) {
  const { workspaceId, sourceId } = await params;
  const model = await getKnowledgeExplorerModel(workspaceId, sourceId);
  if (!model) {
    return (
      <main className="mx-auto flex min-h-screen max-w-4xl flex-col justify-center px-6 py-16">
        <h1 className="text-2xl font-semibold">Not found or no access</h1>
      </main>
    );
  }
  const first = findFirstReadableDocument(model.tree);
  if (first) redirect(`/w/${workspaceId}/knowledge/${sourceId}/${first.documentId}`);
  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col justify-center px-6 py-16">
      <h1 className="text-2xl font-semibold">{model.source.name}</h1>
      <p className="mt-4 text-slate-600">This source does not contain any readable documents.</p>
      <Link
        className="mt-6 inline-flex w-fit items-center rounded-md border border-slate-300 px-4 py-2 font-medium"
        href={`/w/${workspaceId}/sources`}
      >
        Go to Sources
      </Link>
    </main>
  );
}
