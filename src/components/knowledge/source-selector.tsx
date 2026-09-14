"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { sortSourcesByName } from "@/lib/knowledge-navigation";
import type { SourceView } from "@/modules/knowledge/application/knowledge-query-service";

type SourceSelectorProps = {
  sources: SourceView[];
  selectedSourceId: string | undefined;
  /** Workspace-scoped explorer selector; navigates to `/w/:workspaceId/knowledge/:sourceId`. */
  workspaceId: string;
};

export function SourceSelector({ sources, selectedSourceId, workspaceId }: SourceSelectorProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const ordered = sortSourcesByName(sources);
  const archivedSuffix = searchParams.get("includeArchived") === "true" ? "?includeArchived=true" : "";
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
            router.push(`/w/${workspaceId}/knowledge/${next}${archivedSuffix}`);
          }
        }}
        className="mt-1 min-h-10 w-full truncate rounded-md border border-kh-border bg-kh-bg px-3 py-2 text-sm text-kh-text outline-none focus:border-kh-accent focus-visible:ring-2 focus-visible:ring-kh-accent"
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
