"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { bufferTyping, plainClick } from "./typing-ahead";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronRight, Clock3, FileText, LockKeyhole, MoreHorizontal, Plus, ListFilter, Star, Share2 } from "lucide-react";
import { ActionIcon } from "@/components/actions/action-icon";
import { rememberDocument, toggleFavoriteDocument } from "@/lib/document-shortcuts";
import type { KnowledgeTreeItem, SourceView } from "@/modules/knowledge/application/knowledge-query-service";
import { useWorkspaceAuthorization } from "@/components/shell/use-workspace-authorization";
import { MenuCheckboxItem, MenuContent, MenuItem, MenuRoot, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import type { TreeLoadState } from "./source-tree-cache";
import { useSidebarShortcuts } from "./use-sidebar-shortcuts";
import { KnowledgeTree } from "./knowledge-tree";
import { useSharedTargets } from "./shared-folders";
import { SidebarGetStarted, hasNoDocuments, startActions } from "./sidebar-get-started";
import { TreeFilter } from "./tree-filter";
import { buttonClasses } from "@/components/ui/button";
import { Status } from "@/components/ui/status";
import { Tooltip } from "@/components/ui/tooltip";
import { isBoolean, isBooleanRecord, isString, usePersistedJson } from "@/components/shell/use-persisted-state";
import { documentShortcutKey, useDocumentShortcuts } from "./use-document-shortcuts";
import { useTreeMutations } from "./use-tree-mutations";
import { RowActionsTrigger, RowContextMenu, useActionRunner } from "@/components/actions/action-menu";
import { actionsFor, type ActionTarget, type FolderTarget, type SourceTarget } from "@/components/actions/action-registry";

/** Why a synced source's documents cannot be edited here; read after the name, never part of it. */
const READ_ONLY_DESCRIPTION = "Synced from a folder, read-only in the Hub";

export type SourceSidebarProps = {
  workspaceId: string;
  /** The source on the current Knowledge route, when there is one. */
  source: SourceView | null;
  defaultSourceId?: string;
  collections: { source: SourceView; tree: KnowledgeTreeItem[] }[];
  sources?: SourceView[];
  treeStates?: Record<string, TreeLoadState>;
  ensureTree?: (id: string) => Promise<void>;
  retryTree?: (id: string) => Promise<void>;
  selectedDocumentId?: string;
  onRetrySources?: () => void;
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
  const visible = items.filter((item) => !hidden(item));
  return visible.length === items.length ? items : visible;
}

export function SourceSidebar({ workspaceId, source, defaultSourceId, collections, sources, treeStates, ensureTree, retryTree, selectedDocumentId, onRetrySources }: SourceSidebarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { access, confirmed } = useWorkspaceAuthorization();
  // Only My Space's owner has links to be reminded of; the route refuses anyone else.
  const canShareSources = !onRetrySources && confirmed && access.workspace.type === "PERSONAL" && access.isPersonalOwner;
  const { folderIds: sharedFolderIds, sourceIds } = useSharedTargets(workspaceId, canShareSources);
  // The filter is work in progress rather than an arrangement, so it lasts
  // for the session: worth keeping across a refresh, not worth greeting
  // someone with a week later. Everything else below is a choice, and keeps.
  const [query, setQuery, queryReady] = usePersistedJson(`kh:tree-filter:${workspaceId}`, "", isString, "session");
  const [filterOpen, setFilterOpen, filterReady] = usePersistedJson(`kh:tree-filter-open:${workspaceId}`, false, isBoolean, "session");
  const filterTriggerRef = useRef<HTMLButtonElement>(null);
  const readOnlyDescriptionId = useId();
  const [expanded, setExpanded, expandedReady] = usePersistedJson<Record<string, boolean>>(`kh:tree-expanded:${workspaceId}`, {}, isBooleanRecord);
  const { shortcuts, update: updateShortcuts, ready: shortcutsReady } = useDocumentShortcuts(workspaceId);
  const [recentMenuOpen, setRecentMenuOpen] = useState(false);
  const [recentMenuKeys, setRecentMenuKeys] = useState<string[] | null>(null);
  const sidebarReady = queryReady && filterReady && expandedReady && shortcutsReady;
  const recentMenuPopulated = useRef(false);
  const showArchived = searchParams.get("includeArchived") === "true";
  const initiallyOpen = source && (showArchived || source.status === "ACTIVE") ? source.id : defaultSourceId;
  const currentDocumentKey = source && selectedDocumentId ? documentShortcutKey(source.id, selectedDocumentId) : null;
  const needle = query.trim().toLowerCase();
  const headers = useMemo(() => sources ?? collections.map(c => c.source), [sources, collections]);
  // Favorites and Recent have independent requests: unrelated favorite changes
  // must not clear the open menu's unloaded-source links or its error state.
  const shortcutIds = [...new Set(shortcuts.favorites.map(key => key.split(":")[1]))].sort().join(",");
  const recentIds = [...new Set((recentMenuKeys ?? shortcuts.recent).map(key => key.split(":")[1]))].sort().join(",");
  const shortcutMetadata = useSidebarShortcuts(workspaceId, ensureTree ? shortcutIds : "", showArchived, sources);
  const recentMetadata = useSidebarShortcuts(workspaceId, ensureTree ? recentIds : "", showArchived, sources);
  useEffect(() => {
    if (!expandedReady) return;
    for (const candidate of headers) {
      if (!showArchived && candidate.status === "ARCHIVED") continue;
      const currentDocumentSource = currentDocumentKey !== null && candidate.id === source?.id;
      if (needle || currentDocumentSource || (expanded[candidate.id] ?? candidate.id === initiallyOpen)) void ensureTree?.(candidate.id);
    }
  }, [headers, showArchived, needle, expanded, expandedReady, initiallyOpen, currentDocumentKey, source?.id, ensureTree]);
  const visibleCollections = useMemo(() => headers.map(candidate => ({ source: candidate, tree: collections.find(c => c.source.id === candidate.id)?.tree ?? [] }))
    .filter(({ source: candidate }) => showArchived || candidate.status === "ACTIVE")
    .map((collection) => ({ ...collection, tree: showArchived ? collection.tree : withoutArchivedSubtrees(collection.tree) }))
    .sort((a, b) => Number(b.source.sourceType === "HUB") - Number(a.source.sourceType === "HUB")),
  [headers, collections, showArchived]);
  const documents = useMemo(() => {
    const map = new Map<string, { documentId: string; sourceId: string; sourceName: string; ownership: SourceView["ownership"]; label: string; pageIcon: string | null }>();
    const visibleSourceIds = new Set(visibleCollections.map(({ source }) => source.id));
    const authoritativeSources = new Set(collections.filter(({ source }) => {
      const state = treeStates?.[source.id];
      return state?.status !== "loaded" || !state.stale;
    }).map(({ source }) => source.id));
    for (const collection of visibleCollections) {
      if (!authoritativeSources.has(collection.source.id)) continue;
      for (const item of collection.tree) {
        if (item.type === "document") map.set(`${collection.source.id}:${item.documentId}`, { documentId: item.documentId, sourceId: collection.source.id, sourceName: collection.source.name, ownership: collection.source.ownership, label: item.label, pageIcon: item.pageIcon ?? null });
      }
    }
    for (const document of [...shortcutMetadata.documents, ...recentMetadata.documents]) {
      // Current trees decide archive visibility. A tree retained across a
      // workspace refresh keeps its rows mounted while shortcuts use metadata.
      if (visibleSourceIds.has(document.sourceId) && !authoritativeSources.has(document.sourceId)) {
        map.set(`${document.sourceId}:${document.documentId}`, document);
      }
    }
    return map;
  }, [visibleCollections, shortcutMetadata.documents, recentMetadata.documents, collections, treeStates]);
  const favoriteKeys = shortcuts.favorites.filter((key) => documents.has(key));
  const favoritesLoading = !shortcutsReady || shortcutMetadata.loading;
  const recentCandidates = (recentMenuKeys ?? shortcuts.recent).filter((key) => documents.has(key) && !shortcuts.favorites.includes(key) && key !== currentDocumentKey);
  // Freeze only after a usable link has appeared. Raw history can contain
  // exclusively current, favorite, or inaccessible documents and still be empty.
  useEffect(() => {
    if (!recentMenuOpen || !shortcutsReady) return;
    if (recentCandidates.length > 0) recentMenuPopulated.current = true;
    if (!recentMenuPopulated.current && (recentMenuKeys === null || recentMenuKeys.length !== shortcuts.recent.length || recentMenuKeys.some((key, index) => key !== shortcuts.recent[index]))) {
      setRecentMenuKeys([...shortcuts.recent]);
    }
  }, [recentMenuOpen, shortcutsReady, recentCandidates.length, recentMenuKeys, shortcuts.recent]);
  const recentLoading = !shortcutsReady || recentMetadata.loading;
  const favoriteDocumentIds = new Set(shortcuts.favorites.map((key) => documents.get(key)?.documentId).filter((id): id is string => Boolean(id)));

  const recordedOpen = useRef<string | null>(null);
  useEffect(() => {
    const visit = currentDocumentKey ? `${workspaceId}:${currentDocumentKey}` : null;
    // Explorer refreshes and display filters rebuild `documents` while the
    // reader stays on the same document. Only entering it records an open.
    if (recordedOpen.current !== visit) recordedOpen.current = null;
    if (currentDocumentKey && documents.has(currentDocumentKey) && recordedOpen.current !== visit) {
      recordedOpen.current = visit;
      updateShortcuts((previous) => rememberDocument(previous, currentDocumentKey));
    }
  }, [workspaceId, currentDocumentKey, documents, updateShortcuts]);

  const toggleFavorite = useCallback((sourceId: string, documentId: string) => {
    updateShortcuts((previous) => toggleFavoriteDocument(previous, documentShortcutKey(sourceId, documentId)));
  }, [updateShortcuts]);

  const runAction = useActionRunner({ onToggleFavorite: toggleFavorite, workspaceId });
  const mutations = useTreeMutations(workspaceId);

  function shortcutMenuItem(key: string) {
    const document = documents.get(key);
    if (!document) return null;
    const selected = key === currentDocumentKey;
    return (
      <MenuItem
        key={key}
        render={<Link href={`/w/${workspaceId}/knowledge/${document.sourceId}/${document.documentId}${showArchived ? "?includeArchived=true" : ""}`} prefetch={selected ? false : undefined} aria-current={selected ? "page" : undefined} aria-describedby={document.ownership === "SOURCE_MANAGED" ? readOnlyDescriptionId : undefined} />}
        className={selected ? "bg-kh-bg-selected font-medium text-kh-selected-text" : ""}
      >
        {document.pageIcon ? <span className="shrink-0 text-body leading-none" aria-hidden="true">{document.pageIcon}</span> : <FileText size={14} className="shrink-0" aria-hidden="true" />}
        <span className="min-w-0 flex-1 truncate" title={document.label}>{document.label}</span>
        <span className="max-w-[40%] shrink-0 truncate text-caption text-kh-text-muted">{document.sourceName}</span>
        {document.ownership === "SOURCE_MANAGED" ? <LockKeyhole size={14} data-read-only-cue="" className="shrink-0 text-kh-text-muted" aria-hidden="true" /> : null}
      </MenuItem>
    );
  }

  const matches = visibleCollections.filter(({ source: candidate, tree }) => !needle || (ensureTree && treeStates?.[candidate.id]?.status !== "loaded") || candidate.name.toLowerCase().includes(needle) || tree.some((item) => item.label.toLowerCase().includes(needle)));
  const hasNotes = visibleCollections.some(({ source: candidate }) => candidate.sourceType === "HUB" && candidate.name === "Notes" && candidate.status === "ACTIVE");
  const canCreate = access.actions.canWrite && confirmed;
  const newNoteHref = `/w/${workspaceId}/knowledge/new`;
  const addNote = <Tooltip label="Create document"><Link href={newNoteHref} onClick={(event) => { if (!plainClick(event)) return; bufferTyping(); }} aria-label="Create document" className={buttonClasses({ variant: "ghost", icon: true })}><Plus size={15} aria-hidden="true" /></Link></Tooltip>;
  // What can be made here, from the registry like everything else: the button exists when the action does.
  const actionContext = { workspaceId, workspaceType: access.workspace.type, isPersonalOwner: access.isPersonalOwner, can: access.actions, confirmed };
  const createActions = actionsFor("create", actionContext);
  const createFolder = createActions.find((action) => action.id === "create.folder");
  const importAction = createActions.find((action) => action.id === "create.import");
  const allTreesLoaded = !ensureTree || headers.every(({ id }) => {
    const state = treeStates?.[id];
    return state?.status === "loaded" && !state.stale;
  });
  const getStarted = !needle && allTreesLoaded && hasNoDocuments(collections) ? startActions(actionContext) : null;
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
    <aside aria-label="Knowledge explorer" aria-busy={!sidebarReady} className="kh-sidebar-surface flex h-full min-h-0 min-w-0 flex-col gap-1 px-2 pt-1">
      <div className="flex min-w-0 shrink-0 items-center gap-x-1">
        <h2 className="min-w-0 flex-1 px-2 text-caption font-medium text-kh-text-muted">Knowledge</h2>
        {!onRetrySources && <div className="flex shrink-0 items-center gap-0.5">
          <MenuRoot>
            <MenuTrigger aria-label="Favorite documents" title="Favorite documents" className={buttonClasses({ variant: "ghost", icon: true })}>
              <Star size={16} aria-hidden="true" />
            </MenuTrigger>
            <MenuContent align="start" className="max-h-[min(24rem,60vh)] w-80 max-w-[calc(100vw-2rem)] overflow-y-auto overscroll-contain">
              {favoriteKeys.map(shortcutMenuItem)}
              {favoritesLoading ? <p role="status" className="px-2 py-2 text-body text-kh-text-muted">Loading favorite documents…</p>
                : shortcutMetadata.error ? <>
                  <p role="status" className="px-2 py-2 text-body text-kh-text-muted">Favorite documents could not be loaded.</p>
                  <MenuItem closeOnClick={false} onClick={shortcutMetadata.retry}>Retry</MenuItem>
                </> : favoriteKeys.length === 0 ? <p role="status" className="px-2 py-2 text-body text-kh-text-muted">No favorite documents</p> : null}
            </MenuContent>
          </MenuRoot>
          <MenuRoot open={recentMenuOpen} onOpenChange={(open) => {
            recentMenuPopulated.current = false;
            setRecentMenuOpen(open);
            setRecentMenuKeys(open && shortcutsReady ? [...shortcuts.recent] : null);
          }}>
            <MenuTrigger aria-label="Recent documents" title="Recent documents" className={buttonClasses({ variant: "ghost", icon: true })}>
              <Clock3 size={16} aria-hidden="true" />
            </MenuTrigger>
            <MenuContent align="start" className="max-h-[min(24rem,60vh)] w-80 max-w-[calc(100vw-2rem)] overflow-y-auto overscroll-contain">
              {recentCandidates.map(shortcutMenuItem)}
              {recentLoading ? <p role="status" className="px-2 py-2 text-body text-kh-text-muted">Loading recent documents…</p>
                : recentMetadata.error ? <>
                  <p role="status" className="px-2 py-2 text-body text-kh-text-muted">Recent documents could not be loaded.</p>
                  <MenuItem closeOnClick={false} onClick={recentMetadata.retry}>Retry</MenuItem>
                </> : recentCandidates.length === 0 ? <p role="status" className="px-2 py-2 text-body text-kh-text-muted">No recent documents</p> : null}
            </MenuContent>
          </MenuRoot>
          <Tooltip label="Filter documents and sources">
            <button
              ref={filterTriggerRef}
              type="button"
              aria-label="Filter documents and sources"
              aria-expanded={filterOpen}
              aria-controls={filterOpen ? "tree-filter" : undefined}
              onClick={() => filterOpen ? closeFilter() : setFilterOpen(true)}
              className={buttonClasses({ variant: "ghost", icon: true, className: "aria-expanded:bg-kh-bg-hover aria-expanded:text-kh-text" })}
            >
              <ListFilter size={16} aria-hidden="true" />
            </button>
          </Tooltip>
          <MenuRoot>
            <MenuTrigger aria-label="Document options" title="Document options" className={buttonClasses({ variant: "ghost", icon: true })}>
              <MoreHorizontal size={17} aria-hidden="true" />
            </MenuTrigger>
            <MenuContent align="end" className="w-52">
              {importAction?.effect.kind === "navigate" ? (
                <>
                  <MenuItem render={<Link href={importAction.effect.href} />}>
                    <ActionIcon name="import" className="h-4 w-4 shrink-0" />
                    Import folder
                  </MenuItem>
                  <MenuSeparator />
                </>
              ) : null}
              <MenuCheckboxItem checked={showArchived} onCheckedChange={toggleArchived}>
                Show archived
              </MenuCheckboxItem>
            </MenuContent>
          </MenuRoot>
        </div>}
      </div>
      {onRetrySources ? (
        <p role="status" className="px-2 pt-1 text-body text-kh-text-muted">
          Sources could not be loaded.{" "}
          <button type="button" className="underline kh-focus-ring" onClick={onRetrySources}>Retry</button>
        </p>
      ) : <>
      {filterOpen ? <div className="shrink-0"><TreeFilter value={query} onChange={setQuery} onClose={closeFilter} /></div> : null}
      {/* `relative`: the tree's absolutely placed boxes (its `sr-only` live regions) are placed against this
          scroller and clipped by it. Placed against the page they made it taller than the window, and a
          scrollIntoView the pane could not satisfy scrolled the whole shell away. */}
      <nav aria-label="Document tree" className="relative min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain">
        <span id={readOnlyDescriptionId} hidden>{READ_ONLY_DESCRIPTION}</span>
        {getStarted ? <SidebarGetStarted actions={getStarted} compact={pathname === `/w/${workspaceId}/knowledge`} /> : null}
        {!getStarted && !hasNotes && canCreate && (!needle || "notes".includes(needle)) ? (
          <div className="flex items-center justify-between pl-2">
            <Link href={newNoteHref} className="rounded-md text-body font-medium text-kh-text hover:underline kh-focus-ring">Notes</Link>
            <div className="flex items-center">{addFolder}{addNote}</div>
          </div>
        ) : null}
        {matches.map(({ source: candidate, tree }) => {
          const open = Boolean(needle) || (expanded[candidate.id] ?? candidate.id === initiallyOpen);
          const readOnly = candidate.ownership === "SOURCE_MANAGED";
          const isNotes = candidate.sourceType === "HUB" && candidate.name === "Notes" && candidate.status === "ACTIVE";
          const sourceActions = actionsFor("row", {
            workspaceId,
            workspaceType: access.workspace.type,
            isPersonalOwner: access.isPersonalOwner,
            can: access.actions,
            confirmed,
            source: { sourceId: candidate.id, label: candidate.name, status: candidate.status } satisfies SourceTarget,
          });
          return (
            <section key={candidate.id} aria-label={`${candidate.name} documents`}>
              <RowContextMenu as="div" actions={sourceActions} onRun={runAction} className="kh-interactive-row group flex items-center gap-1">
                <button type="button" aria-expanded={open} aria-controls={`collection-${candidate.id}`} aria-describedby={readOnly ? readOnlyDescriptionId : undefined} onClick={() => setExpanded((previous) => ({ ...previous, [candidate.id]: !open }))} title={readOnly ? `${candidate.name} · ${READ_ONLY_DESCRIPTION}` : candidate.name} className="group kh-control flex kh-rail-row min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 text-left kh-rail-text font-medium text-kh-text kh-focus-ring">
                  {/* One slot, Notion-style: the source's mark at rest, its chevron on hover (where hover exists) or keyboard focus. */}
                  <span className="relative size-3.5 shrink-0 text-kh-text-muted" aria-hidden="true">
                    {readOnly ? <LockKeyhole size={14} data-read-only-cue="" className="absolute inset-0 group-focus-visible:invisible [@media(hover:hover)_and_(pointer:fine)]:group-hover:invisible" /> : null}
                    <ChevronRight
                      size={14}
                      data-expand-cue=""
                      className={`invisible absolute inset-0 transition-transform duration-120 ease-out group-focus-visible:visible [@media(hover:hover)_and_(pointer:fine)]:group-hover:visible ${open ? "rotate-90" : ""}`}
                    />
                  </span>
                  <span className="truncate">{candidate.name}</span>
                  {canShareSources && candidate.status === "ACTIVE" && sourceIds.has(candidate.id) ? <Share2 size={14} aria-label="Shared" className="shrink-0 text-kh-text-muted" /> : null}
                  {candidate.status === "ARCHIVED" ? <Status kind="archived" className="ml-auto text-caption font-normal text-kh-text-muted">Archived</Status> : null}
                </button>
                <RowActionsTrigger actions={sourceActions} onRun={runAction} label={candidate.name} className="kh-row-action" />
                {/* `+` stays in sight, as Notion's new-page button does; the folder button shows on hover. */}
                {isNotes && canCreate ? <div className="flex items-center"><span className="kh-row-action flex items-center">{addFolder}</span>{addNote}</div> : null}
              </RowContextMenu>
              <div id={`collection-${candidate.id}`} hidden={!open} className="mt-1 pl-2">
                {open && ensureTree && treeStates?.[candidate.id]?.status !== "loaded" ? <p role="status" className="px-2 py-2 text-body text-kh-text-muted">
                  {treeStates?.[candidate.id]?.status === "error" ? <>Documents could not be loaded. <button className="kh-focus-ring underline" onClick={() => void retryTree?.(candidate.id)}>Retry</button></> : "Loading documents…"}
                </p> : open ? <KnowledgeTree
                  items={tree}
                  sidebarReady={sidebarReady}
                  workspaceId={workspaceId}
                  sourceId={candidate.id}
                  selectedDocumentId={candidate.id === source?.id ? selectedDocumentId : undefined}
                  revealLayoutKey={String(filterOpen)}
                  includeArchived={showArchived}
                  query={candidate.name.toLowerCase().includes(needle) ? "" : query}
                  favoriteDocumentIds={favoriteDocumentIds}
                  sharedFolderIds={sharedFolderIds}
                  onToggleFavorite={(documentId) => toggleFavorite(candidate.id, documentId)}
                  documentActions={(item) => actionsFor("row", {
                    workspaceId,
                    workspaceType: access.workspace.type,
                    isPersonalOwner: access.isPersonalOwner,
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
                    isPersonalOwner: access.isPersonalOwner,
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
                  isSourceArrangementPending={() => mutations.isSourceArrangementPending(candidate.id)}
                  onReorder={async (input, onRefreshRequested) => (await mutations.reorderNode({ ...input, sourceId: candidate.id }, onRefreshRequested)).ok}
                  onMove={async (input, onRefreshRequested) => (await mutations.moveNode({ ...input, sourceId: candidate.id }, "toast", onRefreshRequested)).ok}
                /> : null}
              </div>
            </section>
          );
        })}
        {matches.length === 0 && needle ? <p role="status" className="px-2 py-3 text-body text-kh-text-muted">No matching documents.</p> : null}
      </nav>
      </>}
    </aside>
  );
}
