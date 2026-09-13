import { Suspense, type ReactNode } from "react";
import type { KnowledgeTreeItem, SourceView } from "@/modules/knowledge/application/knowledge-query-service";
import { SourceSidebar } from "./source-sidebar";

export function KnowledgeLayout({
  workspaceId,
  sources,
  source,
  tree,
  includeArchived,
  children,
}: {
  workspaceId: string;
  sources: SourceView[];
  source: SourceView;
  tree: KnowledgeTreeItem[];
  includeArchived: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1">
      <Suspense
        fallback={
          <aside aria-label="Knowledge explorer" className="w-72 shrink-0 border-r border-kh-border bg-kh-bg p-3">
            <p className="text-sm text-kh-text-muted">Loading source tree…</p>
          </aside>
        }
      >
        <SourceSidebar
          workspaceId={workspaceId}
          sources={sources}
          source={source}
          tree={tree}
          includeArchived={includeArchived}
        />
      </Suspense>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
