"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, ChevronRight, Clock3, FileText, MoreHorizontal, Plus, ListFilter, Star } from "lucide-react";
import { ActionIcon } from "@/components/actions/action-icon";
import { favoritesInPlace, rememberDocument, toggleFavoriteDocument } from "@/lib/document-shortcuts";
import type { KnowledgeTreeItem, SourceView } from "@/modules/knowledge/application/knowledge-query-service";
import { useWorkspaceAuthorization } from "@/components/shell/use-workspace-authorization";
import { MenuCheckboxItem, MenuContent, MenuItem, MenuRoot, MenuTrigger } from "@/components/ui/menu";
import { KnowledgeTree } from "./knowledge-tree";
import { TreeFilter } from "./tree-filter";
import { buttonClasses } from "@/components/ui/button";
import { Status } from "@/components/ui/status";
import { Tooltip } from "@/components/ui/tooltip";
import { isBoolean, isBooleanRecord, isString, usePersistedJson } from "@/components/shell/use-persisted-state";
import { documentShortcutKey, useDocumentShortcuts } from "./use-document-shortcuts";
import { useTreeMutations } from "./use-tree-mutations";
import { useActionRunner } from "@/components/actions/action-menu";
import { actionsFor, type ActionTarget, type FolderTarget } from "@/components/actions/action-registry";

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
  // The newest few are listed in place; the rest are one click away in "Show all", which lists every one, so a
  // favorite that is starred and not shown is never one that cannot be found.
  const favoriteKeys = shortcuts.favorites.filter((key) => documents.has(key));
  // The section is the same height however many are starred: the newest few, and a row for the rest.
  const { inPlace: favoritesInPlaceKeys, showAll: favoritesTotal } = favoritesInPlace(favoriteKeys);
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
  const mutations = useTreeMutations();

  function shortcutRow(key: string, favorite: boolean) {
    const document = documents.get(key);
    if (!document) return null;
    const selected = document.documentId === resolvedDocumentId;
    return <li key={key} className={`kh-interactive-row group flex min-h-8 items-center ${selected ? "bg-kh-bg-selected hover:bg-kh-bg-selected" : ""}`}>
      <Link href={`/w/${workspaceId}/knowledge/${document.sourceId}/${document.documentId}${showArchived ? "?includeArchived=true" : ""}`} prefetch={selected ? false : undefined} title={`${document.label} · ${document.sourceName}`} aria-current={selected ? "page" : undefined} className={`flex min-h-8 min-w-0 flex-1 items-center gap-2 px-2 text-body kh-focus-ring ${selected ? "font-medium text-kh-selected-text" : "text-kh-text-muted"}`}>
        {favorite ? <FileText size={14} className="shrink-0" aria-hidden="true" /> : <Clock3 size={14} className="shrink-0" aria-hidden="true" />}
        <span className="truncate">{document.label}</span>
      </Link>
      <Tooltip label={favorite ? "Remove from favorites" : "Add to favorites"}>
        <button type="button" onClick={() => toggleFavorite(document.sourceId, document.documentId)} aria-label={`${favorite ? "Remove from" : "Add to"} favorites: ${document.label}`} className={`mr-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-kh-text-muted kh-focus-ring ${favorite ? "opacity-80" : "kh-row-action"}`}>
          <Star size={14} fill={favorite ? "currentColor" : "none"} aria-hidden="true" />
        </button>
      </Tooltip>
    </li>;
  }
  const matches = visibleCollections.filter(({ source: candidate, tree }) => !needle || candidate.name.toLowerCase().includes(needle) || tree.some((item) => item.label.toLowerCase().includes(needle)));
  const hasNotes = visibleCollections.some(({ source: candidate }) => candidate.sourceType === "HUB" && candidate.name === "Notes" && candidate.status === "ACTIVE");
  const canCreate = access.actions.canWrite && confirmed;
  const newNoteHref = `/w/${workspaceId}/knowledge/new`;
  const addNote = <Tooltip label="Create document" shortcut="C"><Link href={newNoteHref} aria-label="Create document" aria-keyshortcuts="C" className={buttonClasses({ variant: "ghost", icon: true })}><Plus size={15} aria-hidden="true" /></Link></Tooltip>;
  // What can be made here, from the registry like everything else: the button exists when the action does.
  const createFolder = actionsFor("create", { workspaceId, workspaceType: access.workspace.type, can: access.actions, confirmed }).find((action) => action.id === "create.folder");
  const addFolder = createFolder ? (
    <Tooltip label="Create folder">
      <button type="button" aria-label="Create folder" onClick={() => runAction(createFolder)} className={buttonClasses({ variant: "ghost", icon: true })}>
        <ActionIcon name="new-folder" className="h-4 w-4 shrink-0" />
      </button>
    </Tooltip>
  ) : null;

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
        <h2 className="px-2 text-caption font-medium text-kh-text-muted">Documents</h2>
        <div className="flex items-center gap-0.5">
          <Tooltip label="Filter documents and sources">
            <button
              ref={filterTriggerRef}
              type="button"
              aria-label="Filter documents and sources"
              aria-expanded={filterOpen}
              aria-controls={filterOpen ? "tree-filter" : undefined}
              onClick={() => filterOpen ? closeFilter() : setFilterOpen(true)}
              className={buttonClasses({ variant: "ghost", icon: true, className: filterOpen ? "bg-kh-bg-hover text-kh-text" : "" })}
            >
              <ListFilter size={16} aria-hidden="true" />
            </button>
          </Tooltip>
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
          {favoritesOpen ? <ul className="mt-0.5 space-y-0.5">
            {favoritesInPlaceKeys.map((key) => shortcutRow(key, true))}
            {favoritesTotal !== null ? <li>
              <MenuRoot>
                <MenuTrigger className="kh-interactive-row kh-focus-ring flex min-h-8 w-full items-center gap-2 px-2 text-left text-caption font-medium text-kh-text-muted">
                  <MoreHorizontal size={14} className="shrink-0" aria-hidden="true" />
                  <span>Show all {favoritesTotal}</span>
                </MenuTrigger>
                <MenuContent side="right" align="start" className="max-h-[min(24rem,60vh)] w-96 max-w-[calc(100vw-2rem)] overflow-y-auto overscroll-contain">
                  {favoriteKeys.map((key) => {
                    const document = documents.get(key);
                    if (!document) return null;
                    const selected = document.documentId === resolvedDocumentId;
                    return (
                      <MenuItem
                        key={key}
                        render={<Link href={`/w/${workspaceId}/knowledge/${document.sourceId}/${document.documentId}${showArchived ? "?includeArchived=true" : ""}`} prefetch={selected ? false : undefined} aria-current={selected ? "page" : undefined} />}
                        className={selected ? "bg-kh-bg-selected font-medium text-kh-selected-text" : ""}
                      >
                        <FileText size={14} className="shrink-0" aria-hidden="true" />
                        <span className="min-w-0 flex-1 truncate" title={document.label}>{document.label}</span>
                        <span className="max-w-[40%] shrink-0 truncate text-caption text-kh-text-muted">{document.sourceName}</span>
                      </MenuItem>
                    );
                  })}
                </MenuContent>
              </MenuRoot>
            </li> : null}
          </ul> : null}
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
            <div className="flex items-center">{addFolder}{addNote}</div>
          </div>
        ) : null}
        {matches.map(({ source: candidate, tree }) => {
          const open = Boolean(needle) || (expanded[candidate.id] ?? candidate.id === source.id);
          const Icon = open ? ChevronDown : ChevronRight;
          const isNotes = candidate.sourceType === "HUB" && candidate.name === "Notes" && candidate.status === "ACTIVE";
          return (
            <section key={candidate.id} aria-label={`${candidate.name} documents`}>
              <div className="flex items-center gap-1">
                <button type="button" aria-expanded={open} aria-controls={`collection-${candidate.id}`} onClick={() => setExpanded((previous) => ({ ...previous, [candidate.id]: !open }))} title={candidate.name} className="flex min-h-8 min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 text-left text-body font-medium text-kh-text hover:bg-kh-bg-hover kh-focus-ring">
                  <Icon size={14} className="shrink-0 text-kh-text-muted" aria-hidden="true" />
                  <span className="truncate">{candidate.name}</span>
                  {candidate.status === "ARCHIVED" ? <Status kind="archived" className="ml-auto text-caption font-normal text-kh-text-muted">Archived</Status> : null}
                </button>
                {isNotes && canCreate ? <div className="flex items-center">{addFolder}{addNote}</div> : null}
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
                      sourceStatus: candidate.status,
                      revision: "CURRENT",
                      favorite: shortcuts.favorites.includes(documentShortcutKey(candidate.id, item.documentId)),
                    } satisfies ActionTarget,
                  })}
                  folderActions={(item) => actionsFor("row", {
                    workspaceId,
                    workspaceType: access.workspace.type,
                    can: access.actions,
                    confirmed,
                    includeArchived: showArchived,
                    // The same three axes as a document: the source's ownership, and the folder's own
                    // state — plus the source's, since an archived source refuses every change to it.
                    folder: {
                      nodeId: item.id,
                      sourceId: candidate.id,
                      label: item.label,
                      ownership: candidate.ownership,
                      status: item.status,
                      sourceStatus: candidate.status,
                    } satisfies FolderTarget,
                  })}
                  onRunAction={runAction}
                  onReorder={async (input) => (await mutations.reorderNode(input)).ok}
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
