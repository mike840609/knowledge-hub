import type { KnowledgeQueryService } from "@/modules/knowledge/application/knowledge-query-service";

type DocumentDetails = Awaited<ReturnType<KnowledgeQueryService["getDocument"]>>;

export function DocumentViewer({ view }: { view: DocumentDetails }) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">Current revision {view.currentRevision.revisionNo}</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink">{view.currentRevision.title}</h1>
        </div>
      </div>
      <pre className="mt-6 whitespace-pre-wrap break-words font-mono text-sm leading-7 text-slate-700">{view.currentRevision.markdown}</pre>
      <p className="mt-8 text-xs text-slate-400">Created by identity: {view.currentRevision.createdBy}</p>
      <p className="mt-8 text-xs text-slate-400">Document ID: {view.documentId}</p>
    </article>
  );
}
