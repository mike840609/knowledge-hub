import { RefreshCw } from "lucide-react";
import type { SourceDetailModel } from "@/server/source-read";
import { ImportHistory } from "@/components/sources/import-history";
import { sourceTypeLabel } from "@/components/sources/source-list-row";
import { TechnicalDetails } from "@/components/sources/technical-details";

export function SourceDetail({ model, showImportSuccess = false }: { model: SourceDetailModel; showImportSuccess?: boolean }) {
  const { workspace, source, runs } = model;
  return (
    <div className="flex flex-col gap-6">
      {showImportSuccess ? (
        <p role="status" className="rounded-md border border-kh-success/40 bg-kh-bg px-3 py-2 text-sm text-kh-success">
          Import applied successfully.
        </p>
      ) : null}
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-kh-text">{source.name}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-kh-text-muted">
            <span className="rounded border border-kh-border px-1.5 py-0.5">{sourceTypeLabel(source.sourceType)}</span>
            <span className="rounded border border-kh-border px-1.5 py-0.5">{source.status}</span>
            <span>Sync version {source.syncVersion}</span>
          </p>
        </div>
        <form method="get" action={`/w/${workspace.id}/sources/${source.id}/update`}>
          <button
            type="submit"
            className="inline-flex items-center gap-2 rounded-md border border-kh-border bg-kh-bg px-3 py-2 text-sm font-medium text-kh-text transition hover:bg-kh-bg-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-kh-accent"
          >
            <RefreshCw size={15} strokeWidth={2} aria-hidden="true" />
            Update from folder
          </button>
        </form>
      </header>

      <section aria-labelledby="source-overview-heading" className="rounded-md border border-kh-border bg-kh-bg p-4">
        <h2 id="source-overview-heading" className="text-sm font-semibold text-kh-text">Overview</h2>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          <div className="flex gap-2">
            <dt className="w-24 shrink-0 text-kh-text-muted">Workspace</dt>
            <dd className="text-kh-text">{workspace.name}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-24 shrink-0 text-kh-text-muted">Ownership</dt>
            <dd className="text-kh-text">{source.ownership === "SOURCE_MANAGED" ? "Source-managed (read-only)" : "Hub-managed"}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-24 shrink-0 text-kh-text-muted">Documents</dt>
            <dd className="text-kh-text">Browse under Knowledge</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-24 shrink-0 text-kh-text-muted">Sync runs</dt>
            <dd className="text-kh-text">{runs.length}</dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="import-history-heading" className="flex flex-col gap-3">
        <h2 id="import-history-heading" className="text-sm font-semibold text-kh-text">Import history</h2>
        <ImportHistory runs={runs} />
      </section>

      <TechnicalDetails source={source} />
    </div>
  );
}
