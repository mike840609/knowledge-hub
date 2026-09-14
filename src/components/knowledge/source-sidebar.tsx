"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import type { KnowledgeTreeItem, SourceView } from "@/modules/knowledge/application/knowledge-query-service";
import { isFolderSyncable } from "@/modules/knowledge/domain/source-policy";
import { KnowledgeTree } from "./knowledge-tree";
import { SourceSelector } from "./source-selector";
import { TreeFilter } from "./tree-filter";

export type SourceSidebarProps = {
  workspaceId: string;
  sources: SourceView[];
  source: SourceView;
  tree: KnowledgeTreeItem[];
  selectedDocumentId?: string;
  /**
   * Whether the loaded dataset includes archived nodes. Visibility is decided
   * client-side from `?includeArchived=true` because layouts cannot read
   * search params; archived nodes stay out of the DOM unless the flag is set.
   */
  includeArchived: boolean;
};

function withoutArchivedSubtrees(items: KnowledgeTreeItem[]): KnowledgeTreeItem[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const hidden = (item: KnowledgeTreeItem): boolean => {
    let current: KnowledgeTreeItem | undefined = item;
    while (current) {
      if (current.status === "ARCHIVED") return true;
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    return false;
  };
  return items.filter((item) => !hidden(item));
}

export function SourceSidebar({
  workspaceId,
  sources,
  source,
  tree,
  selectedDocumentId,
  includeArchived,
}: SourceSidebarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const routeParams = useParams();
  const [query, setQuery] = useState("");

  const showArchived = searchParams.get("includeArchived") === "true";
  const resolvedDocumentId =
    selectedDocumentId ?? (typeof routeParams?.documentId === "string" ? routeParams.documentId : undefined);

  const visibleSources = useMemo(
    () => (showArchived ? sources : sources.filter((candidate) => candidate.status === "ACTIVE")),
    [sources, showArchived],
  );
  const visibleTree = useMemo(
    () => (showArchived && includeArchived ? tree : withoutArchivedSubtrees(tree)),
    [tree, showArchived, includeArchived],
  );
  const syncable = isFolderSyncable(source);

  function handleArchivedToggle(event: React.ChangeEvent<HTMLInputElement>) {
    if (event.target.checked) {
      router.push(`${pathname}?includeArchived=true`);
    } else {
      router.push(pathname);
    }
  }

  return (
    <aside aria-label="Knowledge explorer" className="flex w-72 shrink-0 flex-col gap-4 border-r border-kh-border bg-kh-bg p-3">
      <div className="flex flex-col gap-2 border-b border-kh-border pb-3">
        <SourceSelector workspaceId={workspaceId} sources={visibleSources} selectedSourceId={source.id} />
        {syncable ? (
          <Link
            className="w-fit rounded text-sm font-medium text-kh-text-muted underline-offset-4 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-kh-accent"
            href={`/w/${workspaceId}/sources/${source.id}/update`}
          >
            Update from folder
          </Link>
        ) : null}
        <label className="flex min-h-10 cursor-pointer items-center gap-2 text-sm text-kh-text" htmlFor="show-archived">
          <input
            id="show-archived"
            type="checkbox"
            checked={showArchived}
            onChange={handleArchivedToggle}
            className="h-4 w-4"
          />
          Show archived
        </label>
      </div>
      <TreeFilter value={query} onChange={setQuery} />
      <nav aria-label="Document tree" className="min-h-0 flex-1 overflow-y-auto">
        <KnowledgeTree
          items={visibleTree}
          workspaceId={workspaceId}
          sourceId={source.id}
          selectedDocumentId={resolvedDocumentId}
          includeArchived={showArchived}
          query={query}
        />
      </nav>
    </aside>
  );
}
