import { History } from "lucide-react";
import type { SyncRun } from "@/modules/sources/domain/sync-run";
import { syncStatusLabel } from "@/components/sources/source-list-row";
import { Timestamp } from "@/components/ui/timestamp";

function describeRun(run: SyncRun): string {
  const result = run.resultVersion === null ? "no new version" : `version ${run.resultVersion}`;
  return `from version ${run.basedOnVersion} → ${result}`;
}

export function ImportHistory({ runs }: { runs: SyncRun[] }) {
  if (runs.length === 0) {
    return <p className="text-body text-kh-text-muted">No sync runs recorded for this source yet.</p>;
  }
  return (
    <ul className="flex flex-col gap-2">
      {runs.map((run) => (
        <li
          key={run.id}
          className="flex items-center gap-3 rounded-md border border-kh-border bg-kh-bg px-3 py-2.5"
        >
          <History size={15} aria-hidden="true" className="shrink-0 text-kh-text-muted" />
          <div className="min-w-0 flex-1">
            <p className="text-body font-medium text-kh-text">
              {syncStatusLabel(run.status)} <span className="font-normal text-kh-text-muted">{describeRun(run)}</span>
            </p>
            <p className="mt-0.5 text-caption text-kh-text-muted">
              <Timestamp value={run.startedAt} />
              {run.completedAt ? (
                <>
                  {" → "}
                  <Timestamp value={run.completedAt} />
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
