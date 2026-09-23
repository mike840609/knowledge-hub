"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, ChevronRight, Clock3, FileText, MoreHorizontal, Plus, ListFilter, Star } from "lucide-react";
import { rememberDocument, toggleFavoriteDocument } from "@/lib/document-shortcuts";
import type { KnowledgeTreeItem, SourceView } from "@/modules/knowledge/application/knowledge-query-service";
import { useWorkspaceAuthorization } from "@/components/shell/use-workspace-authorization";
import { MenuCheckboxItem, MenuContent, MenuRoot, MenuTrigger } from "@/components/ui/menu";
import { KnowledgeTree } from "./knowledge-tree";
import { TreeFilter } from "./tree-filter";
import { buttonClasses } from "@/components/ui/button";
import { isBoolean, isBooleanRecord, isString, usePersistedJson } from "@/components/shell/use-persisted-state";
import { documentShortcutKey, useDocumentShortcuts } from "./use-document-shortcuts";
import { useActionRunner } from "@/components/actions/action-menu";
import { actionsFor, type ActionTarget } from "@/components/actions/action-registry";

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
  // The filter is work in progress rather than an arrangement, so it lasts
  // for the session: worth keeping across a refresh, not worth greeting
  // someone with a week later. Everything else below is a choice, and keeps.
  const [query, setQuery] = usePersistedJson(`kh:tree-filter:${workspaceId}`, "", isString, "session");
  const [filterOpen, setFilterOpen] = usePersistedJson(`kh:tree-filter-open:${workspaceId}`, false, isBoolean, "session");
  const filterTriggerRef = useRef<HTMLButtonElement>(null);
  const [expanded, setExpanded] = usePersistedJson<Record<string, boolean>>(`kh:tree-expanded:${workspaceId}`, {}, isBooleanRecord);
  const { shortcuts, update: updateShortcuts } = useDocumentShortcuts(workspaceId);
  const [favoritesOpen, setFavoritesOpen] = usePersistedJson(`kh:sidebar-favorites:${workspaceId}`, false, isBoolean);
  const [recentOpen, setRecentOpen] = usePersistedJson(`kh:sidebar-recent:${workspaceId}`, false, isBoolean);
  const showArchived = searchParams.get("includeArchived") === "true";
  const resolvedDocumentId = selectedDocumentId ?? (typeof routeParams?.documentId === "string" ? routeParams.documentId : undefined);
  const needle = query.trim().toLowerCase();
  const visibleCollections = useMemo(() => collections
    .filter(({ source: candidate }) => showArchived || candidate.status === "ACTIVE")
    .map((collection) => ({ ...collection, tree: showArchived && includeArchived ? collection.tree : withoutArchivedSubtrees(collection.tree) }))
    .sort((a, b) => Number(b.source.sourceType === "HUB") - Number(a.source.sourceType === "HUB")),
  [collections, showArchived, includeArchived]);
  const documents = useMemo(() => {
    const map = new Map<string, { documentId: string; sourceId: string; sourceName: string; label: string }>();
    for (const collection of visibleCollections) {
      for (const item of collection.tree) {
        if (item.type === "document") map.set(`${collection.source.id}:${item.documentId}`, { documentId: item.documentId, sourceId: collection.source.id, sourceName: collection.source.name, label: item.label });
      }
    }
    return map;
  }, [visibleCollections]);
  const favoriteKeys = shortcuts.favorites.filter((key) => documents.has(key)).slice(0, 4);
  const recentKeys = shortcuts.recent.filter((key) => documents.has(key) && !shortcuts.favorites.includes(key) && key !== `${source.id}:${resolvedDocumentId}`).slice(0, 4);
  const favoriteDocumentIds = new Set(shortcuts.favorites.map((key) => documents.get(key)?.documentId).filter((id): id is string => Boolean(id)));

  useEffect(() => {
    const key = resolvedDocumentId ? documentShortcutKey(source.id, resolvedDocumentId) : null;
    if (key && documents.has(key)) updateShortcuts((previous) => rememberDocument(previous, key));
  }, [source.id, resolvedDocumentId, documents, updateShortcuts]);

  const toggleFavorite = useCallback((sourceId: string, documentId: string) => {
    updateShortcuts((previous) => toggleFavoriteDocument(previous, documentShortcutKey(sourceId, documentId)));
  }, [updateShortcuts]);

  // Favourites can now be starred from a row menu or the palette as well as
  // from here, so the section reveals itself whenever the list grows rather
  // than only when this component was the one that did it.
  const previousFavorites = useRef(shortcuts.favorites);
  useEffect(() => {
    if (shortcuts.favorites.length > previousFavorites.current.length) setFavoritesOpen(true);
    previousFavorites.current = shortcuts.favorites;
  }, [shortcuts.favorites, setFavoritesOpen]);

  const runAction = useActionRunner({ onToggleFavorite: toggleFavorite });

  function shortcutRow(key: string, favorite: boolean) {
    const document = documents.get(key);
    if (!document) return null;
    const selected = document.documentId === resolvedDocumentId;
    return <li key={key} className={`kh-interactive-row group flex min-h-9 items-center ${selected ? "bg-kh-bg-selected hover:bg-kh-bg-selected" : ""}`}>
      <Link href={`/w/${workspaceId}/knowledge/${document.sourceId}/${document.documentId}${showArchived ? "?includeArchived=true" : ""}`} title={`${document.label} · ${document.sourceName}`} aria-current={selected ? "page" : undefined} className={`flex min-h-9 min-w-0 flex-1 items-center gap-2 px-2 text-body kh-focus-ring ${selected ? "font-medium text-kh-selected-text" : "text-kh-text-muted"}`}>
        {favorite ? <FileText size={14} strokeWidth={1.8} className="shrink-0" aria-hidden="true" /> : <Clock3 size={14} strokeWidth={1.8} className="shrink-0" aria-hidden="true" />}
        <span className="truncate">{document.label}</span>
      </Link>
      <button type="button" onClick={() => toggleFavorite(document.sourceId, document.documentId)} aria-label={`${favorite ? "Remove from" : "Add to"} favorites: ${document.label}`} title={favorite ? "Remove from favorites" : "Add to favorites"} className={`mr-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-kh-text-muted kh-focus-ring ${favorite ? "opacity-80" : "kh-row-action"}`}>
        <Star size={14} strokeWidth={1.8} fill={favorite ? "currentColor" : "none"} aria-hidden="true" />
      </button>
    </li>;
  }
  const matches = visibleCollections.filter(({ source: candidate, tree }) => !needle || candidate.name.toLowerCase().includes(needle) || tree.some((item) => item.label.toLowerCase().includes(needle)));
  const hasNotes = visibleCollections.some(({ source: candidate }) => candidate.sourceType === "HUB" && candidate.name === "Notes" && candidate.status === "ACTIVE");
  const canCreate = access.actions.canWrite && confirmed;
  const newNoteHref = `/w/${workspaceId}/knowledge/new`;
  const addNote = <Link href={newNoteHref} aria-label="Add to Notes" title="Add to Notes" className={buttonClasses({ variant: "ghost", icon: true })}><Plus size={15} aria-hidden="true" /></Link>;

  function toggleArchived(checked: boolean) {
    const params = new URLSearchParams(searchParams.toString());
    if (checked) params.set("includeArchived", "true");
    else params.delete("includeArchived");
    router.push(`${pathname}${params.size ? `?${params}` : ""}`);
  }

  function closeFilter() {
    setQuery("");
    setFilterOpen(false);
    filterTriggerRef.current?.focus();
  }

  return (
    <aside aria-label="Knowledge explorer" className="kh-sidebar-surface flex h-full min-h-0 w-full shrink-0 flex-col gap-3 border-r border-kh-border bg-kh-bg-sunken p-3 lg:w-72">
      <div className="flex shrink-0 items-center justify-between gap-2">
        <h2 className="px-2 text-body font-semibold text-kh-text">Documents</h2>
        <div className="flex items-center gap-0.5">
          <button
            ref={filterTriggerRef}
            type="button"
            aria-label="Filter documents and sources"
            aria-expanded={filterOpen}
            aria-controls={filterOpen ? "tree-filter" : undefined}
            title="Filter documents and sources"
            onClick={() => filterOpen ? closeFilter() : setFilterOpen(true)}
            className={buttonClasses({ variant: "ghost", icon: true, className: filterOpen ? "bg-kh-bg-hover text-kh-text" : "" })}
          >
            <ListFilter size={16} aria-hidden="true" />
          </button>
          <MenuRoot>
            <MenuTrigger aria-label="Document display options" title="Document display options" className={buttonClasses({ variant: "ghost", icon: true })}>
              <MoreHorizontal size={17} aria-hidden="true" />
            </MenuTrigger>
            <MenuContent align="end" className="w-52">
              <MenuCheckboxItem checked={showArchived} onCheckedChange={toggleArchived}>
                Show archived
              </MenuCheckboxItem>
            </MenuContent>
          </MenuRoot>
        </div>
      </div>
      {filterOpen ? <div className="shrink-0"><TreeFilter value={query} onChange={setQuery} onClose={closeFilter} /></div> : null}
      <nav aria-label="Document tree" className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain">
        {!needle && favoriteKeys.length > 0 ? <section aria-label="Favorites" className="pb-1">
          <h3><button type="button" aria-expanded={favoritesOpen} onClick={() => setFavoritesOpen((open) => !open)} className="kh-interactive-row flex min-h-8 w-full items-center gap-2 px-2 text-left text-caption font-medium text-kh-text-muted">
            {favoritesOpen ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
            <span>Favorites</span>
          </button></h3>
          {favoritesOpen ? <ul className="mt-0.5 space-y-0.5">{favoriteKeys.map((key) => shortcutRow(key, true))}</ul> : null}
        </section> : null}
        {!needle && recentKeys.length > 0 ? <section aria-label="Recent documents" className="pb-1">
          <h3><button type="button" aria-expanded={recentOpen} onClick={() => setRecentOpen((open) => !open)} className="kh-interactive-row flex min-h-8 w-full items-center gap-2 px-2 text-left text-caption font-medium text-kh-text-muted">
            {recentOpen ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
            <span>Recent</span>
          </button></h3>
          {recentOpen ? <ul className="mt-0.5 space-y-0.5">{recentKeys.map((key) => shortcutRow(key, false))}</ul> : null}
        </section> : null}
        {!hasNotes && canCreate && (!needle || "notes".includes(needle)) ? (
          <div className="flex items-center justify-between pl-2">
            <Link href={newNoteHref} className="rounded-md text-body font-medium text-kh-text hover:underline kh-focus-ring">Notes</Link>
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
                <button type="button" aria-expanded={open} aria-controls={`collection-${candidate.id}`} onClick={() => setExpanded((previous) => ({ ...previous, [candidate.id]: !open }))} title={candidate.name} className="flex min-h-9 min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 text-left text-body font-medium text-kh-text hover:bg-kh-bg-hover kh-focus-ring">
                  <Icon size={14} className="shrink-0 text-kh-text-muted" aria-hidden="true" />
                  <span className="truncate">{candidate.name}</span>
                  {candidate.status === "ARCHIVED" ? <span className="ml-auto text-caption font-normal text-kh-text-muted">Archived</span> : null}
                </button>
                {isNotes && canCreate ? addNote : null}
              </div>
              <div id={`collection-${candidate.id}`} hidden={!open} className="mt-1 pl-2">
                {open ? <KnowledgeTree
                  items={tree}
                  workspaceId={workspaceId}
                  sourceId={candidate.id}
                  selectedDocumentId={resolvedDocumentId}
                  includeArchived={showArchived}
                  query={candidate.name.toLowerCase().includes(needle) ? "" : query}
                  favoriteDocumentIds={favoriteDocumentIds}
                  onToggleFavorite={(documentId) => toggleFavorite(candidate.id, documentId)}
                  documentActions={(item) => actionsFor("row", {
                    workspaceId,
                    workspaceType: access.workspace.type,
                    can: access.actions,
                    confirmed,
                    includeArchived: showArchived,
                    // Ownership comes from the collection, not the row: it is
                    // the source that decides whether the Hub may write here.
                    target: {
                      documentId: item.documentId,
                      sourceId: candidate.id,
                      label: item.label,
                      ownership: candidate.ownership,
                      // A document stays ACTIVE inside an archived collection;
                      // what may be done to it follows the collection too.
                      status: candidate.status === "ARCHIVED" ? "ARCHIVED" : item.status,
                      revision: "CURRENT",
                      favorite: shortcuts.favorites.includes(documentShortcutKey(candidate.id, item.documentId)),
                    } satisfies ActionTarget,
                  })}
                  onRunAction={runAction}
                /> : null}
              </div>
            </section>
          );
        })}
        {matches.length === 0 && needle ? <p role="status" className="px-2 py-3 text-body text-kh-text-muted">No matching documents.</p> : null}
      </nav>
    </aside>
  );
}
