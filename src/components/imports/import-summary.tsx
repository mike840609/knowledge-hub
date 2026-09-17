import type { ImportPreview } from "@/modules/sources/application/reconcile-import-snapshot";

export function ImportSummary({ preview }: { preview: ImportPreview }): React.JSX.Element {
  const documents = preview.summary.documents;
  const folders = preview.summary.folders;
  const assets = preview.summary.assets;
  return (
    <section aria-labelledby="import-summary-heading" className="rounded-md border border-kh-border bg-kh-bg p-4">
      <h2 id="import-summary-heading" className="text-sm font-semibold text-kh-text">
        Summary
      </h2>
      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
        <div className="flex gap-2">
          <dt className="w-24 shrink-0 text-kh-text-muted">Workspace</dt>
          <dd className="text-kh-text">{preview.workspaceName ?? preview.workspaceId}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-24 shrink-0 text-kh-text-muted">Source</dt>
          <dd className="text-kh-text">{preview.sourceName ?? preview.proposedSourceName ?? "New source"}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-24 shrink-0 text-kh-text-muted">Based on</dt>
          <dd className="text-kh-text">{preview.basedOnVersion === null ? "New source" : `Version ${preview.basedOnVersion}`}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-24 shrink-0 text-kh-text-muted">Documents</dt>
          <dd className="text-kh-text">
            {documents.added} added · {documents.updated} updated · {documents.moved} moved · {documents.renamed}{" "}
            renamed · {documents.archived} archived · {documents.restored} restored · {documents.unchanged} unchanged
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-24 shrink-0 text-kh-text-muted">Folders</dt>
          <dd className="text-kh-text">
            {folders.added} added · {folders.archived} archived · {folders.restored} restored
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-24 shrink-0 text-kh-text-muted">Assets</dt>
          <dd className="text-kh-text">
            {assets.added} added · {assets.updated} updated · {assets.removed} removed · {assets.unchanged} unchanged
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-24 shrink-0 text-kh-text-muted">Diagnostics</dt>
          <dd className="text-kh-text">
            {preview.summary.warnings} warnings · {preview.summary.blockers} blockers
          </dd>
        </div>
      </dl>
    </section>
  );
}
