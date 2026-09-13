import { getKnowledgeDocumentModel } from "@/server/knowledge-read";

/**
 * Minimal Task 3 placeholder so Workspace-scoped Document URLs resolve
 * inside the App Shell. Task 5 replaces this with safe GFM rendering,
 * the compact Document Header, and the revision-aware read model.
 */
export default async function KnowledgeDocumentPage({
  params,
}: {
  params: Promise<{ workspaceId: string; sourceId: string; documentId: string }>;
}) {
  const { workspaceId, sourceId, documentId } = await params;
  let title: string | null = null;
  try {
    const model = await getKnowledgeDocumentModel(documentId);
    if (model.view.workspaceId === workspaceId && model.view.sourceId === sourceId) {
      title = model.view.currentRevision.title;
    }
  } catch {
    title = null;
  }
  if (!title) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-16">
        <h1 className="text-2xl font-semibold">Not found or no access</h1>
      </div>
    );
  }
  return (
    <article className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="text-2xl font-semibold">{title}</h1>
    </article>
  );
}
