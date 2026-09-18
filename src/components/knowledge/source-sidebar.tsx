"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, ChevronRight, MoreHorizontal, Plus } from "lucide-react";
import type { KnowledgeTreeItem, SourceView } from "@/modules/knowledge/application/knowledge-query-service";
import { useWorkspaceAuthorization } from "@/components/shell/use-workspace-authorization";
import { KnowledgeTree } from "./knowledge-tree";
import { TreeFilter } from "./tree-filter";

export type SourceSidebarProps = {
  workspaceId: string;
  source: SourceView;
  collections: { source: SourceView; tree: KnowledgeTreeItem[] }[];
  selectedDocumentId?: string;
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

export function SourceSidebar({ workspaceId, source, collections, selectedDocumentId, includeArchived }: SourceSidebarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const routeParams = useParams();
  const { access, confirmed } = useWorkspaceAuthorization();
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const showArchived = searchParams.get("includeArchived") === "true";
  const resolvedDocumentId = selectedDocumentId ?? (typeof routeParams?.documentId === "string" ? routeParams.documentId : undefined);
  const needle = query.trim().toLowerCase();
  const visibleCollections = useMemo(() => collections
    .filter(({ source: candidate }) => showArchived || candidate.status === "ACTIVE")
    .map((collection) => ({ ...collection, tree: showArchived && includeArchived ? collection.tree : withoutArchivedSubtrees(collection.tree) }))
    .sort((a, b) => Number(b.source.sourceType === "HUB") - Number(a.source.sourceType === "HUB")),
  [collections, showArchived, includeArchived]);
  const matches = visibleCollections.filter(({ source: candidate, tree }) => !needle || candidate.name.toLowerCase().includes(needle) || tree.some((item) => item.label.toLowerCase().includes(needle)));
  const hasNotes = visibleCollections.some(({ source: candidate }) => candidate.sourceType === "HUB" && candidate.name === "Notes" && candidate.status === "ACTIVE");
  const canCreate = access.actions.canWrite && confirmed;
  const newNoteHref = `/w/${workspaceId}/knowledge/new`;
  const addNote = <Link href={newNoteHref} aria-label="Add to Notes" title="Add to Notes" className="inline-flex min-h-9 min-w-9 shrink-0 items-center justify-center rounded text-kh-text-muted hover:bg-kh-bg-hover hover:text-kh-text focus:outline-none focus-visible:ring-2 focus-visible:ring-kh-focus"><Plus size={15} aria-hidden="true" /></Link>;

  function toggleArchived(checked: boolean) {
    const params = new URLSearchParams(searchParams.toString());
    if (checked) params.set("includeArchived", "true");
    else params.delete("includeArchived");
    router.push(`${pathname}${params.size ? `?${params}` : ""}`);
  }

  return (
    <aside aria-label="Knowledge explorer" className="flex h-full min-h-0 w-full shrink-0 flex-col gap-3 border-r border-kh-border bg-kh-bg p-3 lg:w-72">
      <div className="flex shrink-0 items-center justify-between gap-2">
        <h2 className="px-2 text-sm font-semibold text-kh-text">Documents</h2>
        <details className="relative" onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.currentTarget.open = false;
            event.currentTarget.querySelector("summary")?.focus();
          }
        }}>
          <summary aria-label="Document display options" title="Document display options" className="flex min-h-9 min-w-9 cursor-pointer list-none items-center justify-center rounded text-kh-text-muted hover:bg-kh-bg-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-kh-focus [&::-webkit-details-marker]:hidden">
            <MoreHorizontal size={17} aria-hidden="true" />
          </summary>
          <div className="absolute right-0 top-full z-20 mt-1 w-52 rounded-md border border-kh-border bg-kh-bg p-2 shadow-md">
            <label className="flex min-h-10 cursor-pointer items-center gap-2 rounded px-2 text-sm text-kh-text hover:bg-kh-bg-hover">
              <input type="checkbox" checked={showArchived} onChange={(event) => toggleArchived(event.target.checked)} className="h-4 w-4 accent-kh-primary" />
              Show archived
            </label>
          </div>
        </details>
      </div>
      <div className="shrink-0"><TreeFilter value={query} onChange={setQuery} /></div>
      <nav aria-label="Document tree" className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain">
        {!hasNotes && canCreate && (!needle || "notes".includes(needle)) ? (
          <div className="flex items-center justify-between pl-2">
            <Link href={newNoteHref} className="rounded text-sm font-medium text-kh-text hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-kh-focus">Notes</Link>
            {addNote}
          </div>
        ) : null}
        {matches.map(({ source: candidate, tree }) => {
          const open = Boolean(needle) || (expanded[candidate.id] ?? candidate.id === source.id);
          const Icon = open ? ChevronDown : ChevronRight;
          const isNotes = candidate.sourceType === "HUB" && candidate.name === "Notes" && candidate.status === "ACTIVE";
          return (
            <section key={candidate.id} aria-label={`${candidate.name} documents`}>
              <div className="flex items-center gap-1">
                <button type="button" aria-expanded={open} aria-controls={`collection-${candidate.id}`} onClick={() => setExpanded((previous) => ({ ...previous, [candidate.id]: !open }))} title={candidate.name} className="flex min-h-9 min-w-0 flex-1 items-center gap-1.5 rounded px-2 text-left text-sm font-semibold text-kh-text hover:bg-kh-bg-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-kh-focus">
                  <Icon size={14} className="shrink-0 text-kh-text-muted" aria-hidden="true" />
                  <span className="truncate">{candidate.name}</span>
                  {candidate.status === "ARCHIVED" ? <span className="ml-auto text-xs font-normal text-kh-text-muted">Archived</span> : null}
                </button>
                {isNotes && canCreate ? addNote : null}
              </div>
              <div id={`collection-${candidate.id}`} hidden={!open} className="mt-1 pl-2">
                {open ? <KnowledgeTree items={tree} workspaceId={workspaceId} sourceId={candidate.id} selectedDocumentId={resolvedDocumentId} includeArchived={showArchived} query={candidate.name.toLowerCase().includes(needle) ? "" : query} /> : null}
              </div>
            </section>
          );
        })}
        {matches.length === 0 && needle ? <p role="status" className="px-2 py-3 text-sm text-kh-text-muted">No matching documents.</p> : null}
      </nav>
    </aside>
  );
}
