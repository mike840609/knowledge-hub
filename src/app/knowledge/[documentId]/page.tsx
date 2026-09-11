import Link from "next/link";
import { notFound } from "next/navigation";
import { DocumentViewer } from "@/components/knowledge/document-viewer";
import { NotFoundError } from "@/modules/knowledge/domain/errors";
import { getKnowledgeDocumentModel } from "@/server/knowledge-read";

export const dynamic = "force-dynamic";

export default async function DocumentPage({ params, searchParams }: { params: Promise<{ documentId: string }>; searchParams?: Promise<{ includeArchived?: string; revision?: string }> }) {
  const { documentId } = await params;
  const query = await searchParams;
  const includeArchived = query?.includeArchived === "true";
  let revisionNo: number | undefined;
  if (query?.revision !== undefined) {
    if (!/^[0-9]+$/.test(query.revision)) notFound();
    const parsed = Number(query.revision);
    if (!Number.isSafeInteger(parsed) || parsed < 1) notFound();
    revisionNo = parsed;
  }
  try {
    const { view, revisions, selectedRevision } = await getKnowledgeDocumentModel(documentId, { includeArchived, revisionNo });
    const archivedSuffix = includeArchived ? "includeArchived=true" : "";
    const historyHref = (target: number, isCurrent: boolean) => {
      const parts: string[] = [];
      if (!isCurrent) parts.push(`revision=${target}`);
      if (archivedSuffix) parts.push(archivedSuffix);
      return parts.length > 0 ? `/knowledge/${documentId}?${parts.join("&")}` : `/knowledge/${documentId}`;
    };
    return (
      <main className="mx-auto min-h-screen max-w-4xl px-6 py-10">
        <Link className="text-sm font-semibold text-accent" href="/knowledge">← Back to Knowledge</Link>
        <div className="mt-6"><DocumentViewer view={view} selectedRevision={selectedRevision} /></div>
        <section aria-labelledby="history-heading" className="mt-8 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 id="history-heading" className="text-lg font-semibold text-ink">Revision history</h2>
          <ul className="mt-3 space-y-2">
            {revisions.map((revision) => {
              const isCurrent = revision.revisionNo === view.currentRevision.revisionNo;
              const isSelected = revision.revisionNo === selectedRevision.revisionNo;
              return (
                <li key={revision.id} className="text-sm text-slate-700">
                  <Link
                    className="font-semibold text-accent underline"
                    href={historyHref(revision.revisionNo, isCurrent)}
                    aria-current={isSelected ? "page" : undefined}
                  >
                    Revision {revision.revisionNo} — {revision.title}
                  </Link>
                  {isCurrent ? " (current)" : null}
                  {isSelected && !isCurrent ? " (viewing)" : null}
                </li>
              );
            })}
          </ul>
        </section>
      </main>
    );
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}
