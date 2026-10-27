"use client";

import { useContext } from "react";
import { useParams } from "next/navigation";
import type { SourceView } from "@/modules/knowledge/application/knowledge-query-service";
import { SourceSidebar } from "@/components/knowledge/source-sidebar";
import { SourceTreesContext } from "@/components/knowledge/use-source-trees";

/**
 * The tree half of the one sidebar, on every workspace page. Mounted exactly once — in the frame, or in the
 * drawer while that is open — so the filter's IDs and its persisted state have one owner.
 */
export function SidebarTree({ workspaceId, sources }: { workspaceId: string; sources: SourceView[] }) {
  const trees = useContext(SourceTreesContext);
  const params = useParams();
  const source = sources.find((candidate) => candidate.id === params?.sourceId) ?? null;
  if (!trees) return null;
  return (
    <SourceSidebar
      workspaceId={workspaceId}
      source={source}
      sources={sources}
      collections={trees.collections}
      treeStates={trees.states}
      ensureTree={trees.ensure}
      retryTree={trees.retry}
      includeArchived
    />
  );
}
