import { buttonClasses } from "@/components/ui/button";
import Link from "next/link";
import type { SyncRunDetail } from "@/modules/sources/application/get-sync-run-detail";
import { PageHeader } from "@/components/shell/page-header";
import { Timestamp } from "@/components/ui/timestamp";
export function SyncRunDetailView({ detail }: { detail: SyncRunDetail }) {
  const { source, run, changes } = detail,
    base = `/w/${source.workspaceId}`;
  const docs=run.summary.documents;
  const documentSummary=docs&&typeof docs==="object" ? docs as Record<string,unknown> : null;
  const count=(key:string)=>typeof documentSummary?.[key]==="number"?documentSummary[key]:"Not recorded";
  const summaryText=documentSummary?`Added ${count("added")} · Updated ${count("updated")} · Archived ${count("archived")} · Warnings ${typeof run.summary.warnings==="number"?run.summary.warnings:"Not recorded"}`:null;
  const readable = changes.find(
    (c) =>
      c.href && (c.labels.includes("ADDED") || c.labels.includes("UPDATED")),
  );
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        location={source.name}
        locationHref={`${base}/sources/${source.id}`}
        title={run.status === "APPLIED" ? "Folder synced" : "Sync history"}
      />
      <p className="text-body text-kh-text-muted">
        {run.status} · Version {run.resultVersion ?? run.basedOnVersion} ·{" "}
        <Timestamp value={run.completedAt ?? run.startedAt} />
      </p>
      {summaryText?<p className="text-body text-kh-text-secondary">{summaryText}</p>:null}
      {run.status === "APPLIED" && readable?.href ? <p className="text-body text-kh-text-muted">Your changes are saved. Open an imported document to check its content, then search for a phrase from it.</p> : null}
      <div aria-label="Next steps" className="flex flex-wrap items-center gap-3 text-body text-kh-link">
        {run.status === "APPLIED" && readable?.href ? (
          <Link className={buttonClasses()} href={readable.href}>Read this update</Link>
        ) : null}
        <Link href={`${base}/knowledge/${source.id}?includeArchived=true`}>
          Browse this folder
        </Link>
        <Link
          href={detail.workspaceType === "PERSONAL" ? base : `${base}/sources`}
        >
          {detail.workspaceType === "PERSONAL"
            ? "Back to My Space"
            : "Back to sources"}
        </Link>
      </div>
      {!detail.hasRecordedChanges ? (
        <p className="text-body text-kh-text-muted">
          Article details were not recorded for this sync. Its original summary
          is still available.
        </p>
      ) : (
        <ul className="divide-y divide-kh-border">
          {changes.map((c) => (
            <li key={c.id} className="py-3">
              <div className="flex gap-3 text-body">
                <span className="text-caption text-kh-text-muted">
                  {c.labels.join(" · ")}
                </span>
                {c.href ? (
                  <Link className="text-kh-link" href={c.href}>
                    {c.title}
                  </Link>
                ) : (
                  <span>{c.title}</span>
                )}
              </div>
              <p className="text-caption text-kh-text-muted">
                {c.previousPath ? `${c.previousPath} → ` : ""}
                {c.sourcePath}
              </p>
              {c.revisionUnavailable ? (
                <p>Historical revision unavailable.</p>
              ) : null}
              {c.diagnostics.map((d, i) => (
                <p key={i} className="text-caption text-kh-text-muted">
                  {d.message}
                </p>
              ))}
              {c.diff ? (
                <details className="mt-2 text-caption">
                  <summary className="cursor-pointer text-kh-link">
                    View changes
                  </summary>
                  {c.diff.titleChanges ? (
                    <p>
                      Title: {c.diff.titleChanges.before ?? "—"} →{" "}
                      {c.diff.titleChanges.after ?? "—"}
                    </p>
                  ) : null}
                  {c.diff.metadataChanges.map((m) => (
                    <p key={m.key}>
                      {m.key}: {m.before ?? "—"} → {m.after ?? "—"}
                    </p>
                  ))}
                  <pre className="max-h-96 overflow-auto rounded border border-kh-border p-3">
                    {c.diff.lines.map((l, i) => (
                      <div
                        key={i}
                        className={
                          l.kind === "added"
                            ? "text-kh-success"
                            : l.kind === "removed"
                              ? "text-kh-danger"
                              : ""
                        }
                      >
                        {l.kind === "added"
                          ? "+ "
                          : l.kind === "removed"
                            ? "− "
                            : "  "}
                        {l.text}
                      </div>
                    ))}
                  </pre>
                  {c.diff.truncated ? (
                    <p>
                      Comparison truncated. Open the recorded revision to read
                      the complete article.
                    </p>
                  ) : null}
                </details>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <details className="text-caption">
        <summary className="cursor-pointer">Sync summary</summary>
        <pre className="overflow-auto">
          {JSON.stringify(run.summary, null, 2)}
        </pre>
      </details>
      {detail.nextOrdinal !== null ? (
        <Link
          className="text-kh-link"
          href={`${base}/sources/${source.id}/runs/${run.id}?after=${detail.nextOrdinal}`}
        >
          Next changes
        </Link>
      ) : null}
    </div>
  );
}
