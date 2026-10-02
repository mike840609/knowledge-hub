import { PageHeader } from "@/components/shell/page-header";
import { Status } from "@/components/ui/status";
import Link from "next/link";
import type { SourceDetailModel } from "@/server/source-read";
import { isFolderSyncable } from "@/modules/knowledge/domain/source-policy";
import { ImportHistory } from "@/components/sources/import-history";
import { RememberedFolderRow } from "@/components/sources/remembered-folder-row";
import { SourceSyncActions } from "@/components/sources/source-sync-actions";
import { sourceTypeLabel } from "@/components/sources/source-list-row";
import { TechnicalDetails } from "@/components/sources/technical-details";

export function SourceDetail({ model, showImportSuccess = false }: { model: SourceDetailModel; showImportSuccess?: boolean }) {
  const { workspace, source, runs } = model;
  const syncable = isFolderSyncable(source);
  return (
    <div className="flex flex-col gap-6">
      {showImportSuccess ? (
        <p role="status" className="rounded-md border border-kh-success/40 bg-kh-bg px-3 py-2 text-body text-kh-success">
          Import applied successfully.
        </p>
      ) : null}
      <PageHeader location="Sources" locationHref={`/w/${workspace.id}/sources`} title={source.name}
        actions={syncable ? (
          <SourceSyncActions workspaceId={workspace.id} sourceId={source.id} />
        ) : undefined}
      />
      <p className="flex flex-wrap items-center gap-2 text-caption text-kh-text-muted">
        <span className="rounded-md border border-kh-border px-1.5 py-0.5">{sourceTypeLabel(source.sourceType)}</span>
        <Status kind={source.status === "ARCHIVED" ? "archived" : "active"}>{source.status === "ARCHIVED" ? "Archived" : "Active"}</Status>
      </p>

      <section aria-labelledby="source-overview-heading" className="rounded-md border border-kh-border bg-kh-bg p-4">
        <h2 id="source-overview-heading" className="text-body font-semibold text-kh-text">Overview</h2>
        <dl className="mt-3 grid gap-2 text-body sm:grid-cols-2">
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
            <dd><Link className="rounded-md text-kh-link underline underline-offset-4 kh-focus-ring" href={`/w/${workspace.id}/knowledge/${source.id}${source.status === "ARCHIVED" ? "?includeArchived=true" : ""}`}>Browse documents</Link></dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-24 shrink-0 text-kh-text-muted">Sync runs</dt>
            <dd className="text-kh-text">{runs.length}</dd>
          </div>
          <RememberedFolderRow sourceId={source.id} />
        </dl>
      </section>

      <section aria-labelledby="import-history-heading" className="flex flex-col gap-3">
        <h2 id="import-history-heading" className="text-body font-semibold text-kh-text">Import history</h2>
        <ImportHistory runs={runs} />
      </section>

      <TechnicalDetails source={source} />
    </div>
  );
}
