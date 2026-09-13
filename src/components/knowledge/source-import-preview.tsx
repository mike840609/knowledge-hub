"use client";

import { useMemo, useState } from "react";
import type { ImportPreview } from "@/modules/sources/application/reconcile-import-snapshot";
import type { ImportPreviewChange } from "@/modules/sources/domain/import-plan";

type PreviewFilter = "Changed" | "Added" | "Updated" | "Moved" | "Archived" | "Warnings" | "All";

const FILTERS: PreviewFilter[] = ["Changed", "Added", "Updated", "Moved", "Archived", "Warnings", "All"];

function matchesFilter(change: ImportPreviewChange, filter: PreviewFilter): boolean {
  const labels = new Set(change.labels);
  switch (filter) {
    case "All":
      return true;
    case "Changed":
      return [...labels].some((label) => label !== "UNCHANGED");
    case "Added":
      return labels.has("ADDED");
    case "Updated":
      return labels.has("UPDATED");
    case "Moved":
      return labels.has("MOVED") || labels.has("RENAMED") || labels.has("RESTORED");
    case "Archived":
      return labels.has("ARCHIVED");
    case "Warnings":
      return change.diagnostics.some((diagnostic) => diagnostic.severity === "WARNING");
  }
}

function labelText(change: ImportPreviewChange): string {
  if (change.labels.length === 0) return "Changed";
  return [...change.labels].sort().join(" + ");
}

export function SourceImportPreview({ preview }: { preview: ImportPreview }) {
  const [filter, setFilter] = useState<PreviewFilter>("Changed");
  const changes = useMemo(() => preview.changes.filter((change) => matchesFilter(change, filter)), [preview.changes, filter]);
  const blockers = preview.changes.flatMap((change) => change.diagnostics.filter((diagnostic) => diagnostic.severity === "BLOCKING"));
  const warnings = preview.changes.flatMap((change) => change.diagnostics.filter((diagnostic) => diagnostic.severity === "WARNING"));

  return (
    <div className="space-y-6">
      <section aria-labelledby="preview-target-heading" className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 id="preview-target-heading" className="text-lg font-semibold text-ink">Target</h2>
        <dl className="mt-3 grid gap-2 text-sm text-slate-600 sm:grid-cols-2">
          <div><dt className="font-medium text-slate-700">Source</dt><dd>{preview.sourceId ?? preview.proposedSourceName ?? "New source"}</dd></div>
          <div><dt className="font-medium text-slate-700">Based on version</dt><dd>{preview.basedOnVersion === null ? "New source" : preview.basedOnVersion}</dd></div>
          <div><dt className="font-medium text-slate-700">State</dt><dd>{preview.state}{preview.expired ? " · expired" : ""}</dd></div>
          <div><dt className="font-medium text-slate-700">Expires</dt><dd>{new Date(preview.expiresAt).toLocaleString()}</dd></div>
        </dl>
      </section>
      <section aria-labelledby="preview-summary-heading" className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 id="preview-summary-heading" className="text-lg font-semibold text-ink">Summary</h2>
        <dl className="mt-3 grid gap-2 text-sm text-slate-600 sm:grid-cols-3">
          <div><dt className="font-medium text-slate-700">Documents</dt><dd>added {preview.summary.documents.added} · updated {preview.summary.documents.updated} · moved {preview.summary.documents.moved} · renamed {preview.summary.documents.renamed} · archived {preview.summary.documents.archived} · restored {preview.summary.documents.restored} · unchanged {preview.summary.documents.unchanged}</dd></div>
          <div><dt className="font-medium text-slate-700">Folders</dt><dd>added {preview.summary.folders.added} · archived {preview.summary.folders.archived} · restored {preview.summary.folders.restored}</dd></div>
          <div><dt className="font-medium text-slate-700">Assets</dt><dd>added {preview.summary.assets.added} · updated {preview.summary.assets.updated} · removed {preview.summary.assets.removed} · unchanged {preview.summary.assets.unchanged}</dd></div>
          <div><dt className="font-medium text-slate-700">Warnings</dt><dd>{preview.summary.warnings}</dd></div>
          <div><dt className="font-medium text-slate-700">Blockers</dt><dd>{preview.summary.blockers}</dd></div>
        </dl>
        {blockers.length > 0 ? (
          <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            <p className="font-semibold">Blocking diagnostics — fix the source folder and create a fresh preview.</p>
            <ul className="mt-2 list-disc pl-5">{blockers.map((diagnostic, index) => <li key={`${diagnostic.code}-${index}`}>{diagnostic.code}: {diagnostic.message}</li>)}</ul>
          </div>
        ) : null}
        {warnings.length > 0 ? (
          <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <p className="font-semibold">Warnings — review, then Apply may proceed.</p>
            <ul className="mt-2 list-disc pl-5">{warnings.map((diagnostic, index) => <li key={`${diagnostic.code}-${index}`}>{diagnostic.code}: {diagnostic.message}</li>)}</ul>
          </div>
        ) : null}
      </section>
      <section aria-labelledby="preview-changes-heading" className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="preview-changes-heading" className="text-lg font-semibold text-ink">Changes</h2>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Change filters">
            {FILTERS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setFilter(option)}
                aria-pressed={filter === option}
                className={`rounded-full px-3 py-1 text-xs font-medium ${filter === option ? "bg-accent text-white" : "bg-slate-100 text-slate-600"}`}
              >
                {option}
              </button>
            ))}
          </div>
        </div>
        {changes.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">No entries match this filter.</p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100">
            {changes.map((change) => (
              <li key={`${change.kind}-${change.sourcePath}`} className="py-2 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{change.kind}</span>
                  <span className="font-medium text-ink">{change.sourcePath}</span>
                  <span className="text-xs text-slate-500">{labelText(change)}</span>
                </div>
                {change.previousPath ? <p className="mt-1 text-xs text-slate-500">Previously: {change.previousPath}</p> : null}
                {change.diagnostics.length > 0 ? (
                  <ul className="mt-1 list-disc pl-5 text-xs text-slate-500">
                    {change.diagnostics.map((diagnostic, index) => <li key={`${diagnostic.code}-${index}`}>{diagnostic.severity}: {diagnostic.code} — {diagnostic.message}</li>)}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
