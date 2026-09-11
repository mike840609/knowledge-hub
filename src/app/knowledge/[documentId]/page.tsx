import Link from "next/link";
import { notFound } from "next/navigation";
import { DocumentViewer } from "@/components/knowledge/document-viewer";
import { NotFoundError } from "@/modules/knowledge/domain/errors";
import { getKnowledgeDocumentModel } from "@/server/knowledge-read";

export const dynamic = "force-dynamic";

export default async function DocumentPage({ params, searchParams }: { params: Promise<{ documentId: string }>; searchParams?: Promise<{ includeArchived?: string }> }) {
  const { documentId } = await params;
  const includeArchived = (await searchParams)?.includeArchived === "true";
  try {
    const { view, revisions } = await getKnowledgeDocumentModel(documentId, { includeArchived });
    return (
      <main className="mx-auto min-h-screen max-w-4xl px-6 py-10">
        <Link className="text-sm font-semibold text-accent" href="/knowledge">← Back to Knowledge</Link>
        <div className="mt-6"><DocumentViewer view={view} /></div>
        <section aria-labelledby="history-heading" className="mt-8 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 id="history-heading" className="text-lg font-semibold text-ink">Revision history</h2>
          <ul className="mt-3 space-y-2">
            {revisions.map((revision) => <li key={revision.id} className="text-sm text-slate-700">Revision {revision.revisionNo} — {revision.title}</li>)}
          </ul>
        </section>
      </main>
    );
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}
