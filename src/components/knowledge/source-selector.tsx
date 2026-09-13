"use client";

import { useRouter } from "next/navigation";
import { sortSourcesByName } from "@/lib/knowledge-navigation";
import type { SourceView } from "@/modules/knowledge/application/knowledge-query-service";

type SourceSelectorProps = {
  sources: SourceView[];
  selectedSourceId: string | undefined;
  /**
   * Workspace-scoped explorer mode: slim selector without "All sources" that
   * navigates to `/w/:workspaceId/knowledge/:sourceId`. When omitted, the
   * legacy browser form mode (`Choose a source` + `All sources`) is rendered.
   */
  workspaceId?: string;
};

export function SourceSelector({ sources, selectedSourceId, workspaceId }: SourceSelectorProps) {
  const router = useRouter();

  if (workspaceId) {
    const ordered = sortSourcesByName(sources);
    return (
      <div className="min-w-0">
        <label className="block text-xs font-medium text-kh-text-muted" htmlFor="source-selector">
          Source
        </label>
        <select
          id="source-selector"
          value={selectedSourceId ?? ""}
          onChange={(event) => {
            const next = event.target.value;
            if (next !== "" && next !== selectedSourceId) {
              router.push(`/w/${workspaceId}/knowledge/${next}`);
            }
          }}
          className="mt-1 min-h-10 w-full truncate rounded-md border border-kh-border bg-kh-bg px-3 py-2 text-sm text-kh-text"
        >
          {ordered.map((source) => (
            <option key={source.id} value={source.id}>
              {source.name}
            </option>
          ))}
        </select>
      </div>
    );
  }

  return (
    <div className="min-w-64">
      <label className="block text-sm font-medium text-slate-700" htmlFor="source-selector">Choose a source</label>
      <select id="source-selector" name="sourceId" defaultValue={selectedSourceId ?? ""} className="mt-1 min-h-10 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm">
        <option value="">All sources</option>
        {sources.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}
      </select>
    </div>
  );
}
