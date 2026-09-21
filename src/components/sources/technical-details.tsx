import type { SourceView } from "@/modules/knowledge/application/knowledge-query-service";

export function TechnicalDetails({ source }: { source: SourceView }) {
  const entries: [string, string][] = [
    ["Source ID", source.id],
    ["Workspace ID", source.workspaceId],
    ["Source type", source.sourceType],
    ["Ownership", source.ownership],
    ["Status", source.status],
    ["Sync version", String(source.syncVersion)],
  ];
  return (
    <details className="rounded-md border border-kh-border bg-kh-bg px-3 py-2.5">
      <summary className="cursor-pointer rounded-md text-body font-medium text-kh-text kh-focus-ring">Technical details</summary>
      <dl className="mt-3 flex flex-col gap-1.5">
        {entries.map(([term, value]) => (
          <div key={term} className="flex gap-2 text-caption">
            <dt className="w-28 shrink-0 text-kh-text-muted">{term}</dt>
            <dd className="min-w-0 break-all text-kh-text">{value}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
