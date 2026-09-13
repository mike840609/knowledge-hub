import { History } from "lucide-react";
import type { SyncRun } from "@/modules/sources/domain/sync-run";
import { syncStatusLabel } from "@/components/sources/source-list-row";

function formatTimestamp(value: Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return date.toLocaleString();
}

function describeRun(run: SyncRun): string {
  const result = run.resultVersion === null ? "no new version" : `version ${run.resultVersion}`;
  return `from version ${run.basedOnVersion} → ${result}`;
}

export function ImportHistory({ runs }: { runs: SyncRun[] }) {
  if (runs.length === 0) {
    return <p className="text-sm text-kh-text-muted">No sync runs recorded for this source yet.</p>;
  }
  return (
    <ul className="flex flex-col gap-2">
      {runs.map((run) => (
        <li
          key={run.id}
          className="flex items-center gap-3 rounded-md border border-kh-border bg-kh-bg px-3 py-2.5"
        >
          <History size={15} strokeWidth={2} aria-hidden="true" className="shrink-0 text-kh-text-muted" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-kh-text">
              {syncStatusLabel(run.status)} <span className="font-normal text-kh-text-muted">{describeRun(run)}</span>
            </p>
            <p className="mt-0.5 text-xs text-kh-text-muted">
              <time dateTime={new Date(run.startedAt).toISOString()}>{formatTimestamp(run.startedAt)}</time>
              {run.completedAt ? (
                <>
                  {" → "}
                  <time dateTime={new Date(run.completedAt).toISOString()}>{formatTimestamp(run.completedAt)}</time>
                </>
              ) : null}
              {" · triggered by "}
              {run.triggeredBy}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}
