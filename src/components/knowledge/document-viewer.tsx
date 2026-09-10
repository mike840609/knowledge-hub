import type { DocumentView } from "@/modules/knowledge/application/service";

export function DocumentViewer({ view }: { view: DocumentView }) {
  const ownershipLabel = view.source.ownership === "SOURCE_MANAGED" ? "來源同步 · 唯讀" : "Hub 管理";
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">Current revision {view.revision.revisionNo}</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink">{view.revision.title}</h1>
        </div>
        <span className="rounded-full bg-teal-50 px-3 py-1 text-xs font-medium text-teal-800">{ownershipLabel}</span>
      </div>
      <pre className="mt-6 whitespace-pre-wrap break-words font-mono text-sm leading-7 text-slate-700">{view.revision.markdown}</pre>
      <p className="mt-8 text-xs text-slate-400">Created by identity: {view.document.createdBy}</p>
      <p className="mt-8 text-xs text-slate-400">Document ID: {view.document.id}</p>
    </article>
  );
}
