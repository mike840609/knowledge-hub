"use client";

import Link from "next/link";
import { startTransition, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, FileText, Star } from "lucide-react";
import {
  buildKnowledgeTree,
  filterKnowledgeTree,
  reorderStep,
  type KnowledgeTreeNode,
} from "@/lib/knowledge-navigation";
import type { KnowledgeTreeItem } from "@/modules/knowledge/application/knowledge-query-service";
import { isStringArray, usePersistedJson } from "@/components/shell/use-persisted-state";
import { RowActionsTrigger, RowContextMenu } from "@/components/actions/action-menu";
import { claimedRowKeys, type Action } from "@/components/actions/action-registry";
import { actionForKey, isSingleKeyShortcut } from "@/lib/shortcut-keys";
import { REVEAL_FOLDER_EVENT } from "./move-request";
import { CLEAR_FILTER_TO_REORDER, alreadyAtEdge, reorderedNode } from "./organize-messages";
import { Status } from "@/components/ui/status";
import { Tooltip } from "@/components/ui/tooltip";

export type KnowledgeTreeProps = {
  items: KnowledgeTreeItem[];
  includeArchived?: boolean;
  /** Workspace/Source scope for canonical `/w/:workspaceId/knowledge/:sourceId/:documentId` hrefs. */
  workspaceId: string;
  sourceId: string;
  selectedDocumentId?: string;
  /** Sidebar sections above the tree can change height after persisted state arrives. */
  revealLayoutKey?: string;
  /** Persisted sidebar sections and initial favorite synchronization have settled. */
  sidebarReady?: boolean;
  /** Client-local filter text; ancestors stay visible and expansion is restored on clear. */
  query?: string;
  favoriteDocumentIds: ReadonlySet<string>;
  onToggleFavorite: (documentId: string) => void;
  /** What this reader may do to this document, from the one registry. */
  documentActions: (item: Extract<KnowledgeTreeItem, { type: "document" }>) => readonly Action[];
  /** And to this folder: the same registry, the same rules, a folder's own target. */
  folderActions: (item: Extract<KnowledgeTreeItem, { type: "folder" }>) => readonly Action[];
  onRunAction: (action: Action) => void;
  /**
   * Puts a node at a place among its siblings (Alt+↑/↓), and says whether that happened. The tree
   * decides which place from what it shows; whether it may is the actions' say, and the server's.
   */
  onReorder: (input: { nodeId: string; position: number }) => Promise<boolean>;
};

function documentHref(
  item: Extract<KnowledgeTreeItem, { type: "document" }>,
  scope: { workspaceId: string; sourceId: string },
  includeArchived: boolean,
): string {
  const suffix = includeArchived ? "?includeArchived=true" : "";
  return `/w/${scope.workspaceId}/knowledge/${scope.sourceId}/${item.documentId}${suffix}`;
}

function TreeNodeRow({
  node,
  depth,
  scope,
  includeArchived,
  selectedDocumentId,
  collapsedIds,
  activeId,
  onToggle,
  onFocusNode,
  favoriteDocumentIds,
  onToggleFavorite,
  documentActions,
  folderActions,
  onRunAction,
}: {
  node: KnowledgeTreeNode;
  depth: number;
  scope: { workspaceId: string; sourceId: string };
  includeArchived: boolean;
  selectedDocumentId: string | undefined;
  collapsedIds: ReadonlySet<string>;
  activeId: string | null;
  onToggle: (id: string) => void;
  onFocusNode: (id: string) => void;
  favoriteDocumentIds: ReadonlySet<string>;
  onToggleFavorite: (documentId: string) => void;
  documentActions: (item: Extract<KnowledgeTreeItem, { type: "document" }>) => readonly Action[];
  folderActions: (item: Extract<KnowledgeTreeItem, { type: "folder" }>) => readonly Action[];
  onRunAction: (action: Action) => void;
}) {
  const { item } = node;
  const archived = item.status === "ARCHIVED";
  const isActive = activeId === null ? false : activeId === item.id;
  const tabIndex = activeId === null ? undefined : isActive ? 0 : -1;

  if (item.type === "document") {
    const selected = selectedDocumentId !== undefined && item.documentId === selectedDocumentId;
    const isFavorite = favoriteDocumentIds.has(item.documentId);
    const actions = documentActions(item);
    return (
      <RowContextMenu
        actions={actions}
        onRun={onRunAction}
        role="treeitem"
        aria-label={item.label}
        aria-level={depth}
        aria-current={selected ? "page" : undefined}
        aria-selected={selected ? true : undefined}
        data-node-id={item.id}
        data-status={item.status}
        tabIndex={tabIndex}
        onFocus={() => onFocusNode(item.id)}
        className={`kh-interactive-row group relative flex min-h-8 items-center ${selected ? "bg-kh-bg-selected hover:bg-kh-bg-selected" : ""}`}
      >
        <Link
          href={documentHref(item, scope, includeArchived)}
          // Never prefetch the page being read: prefetched from itself, the
          // server sends the whole page, and the router applies that copy on
          // the next visit however old it is, so the return from a save
          // showed the revision before it. Keyboard-shortcuts spec §9.
          prefetch={selected ? false : undefined}
          title={item.label}
          className={`kh-tree-document-link kh-control flex min-h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-body kh-focus-ring ${
            selected ? "font-medium text-kh-selected-text" : "text-kh-text-muted"
          }`}
        >
          <FileText size={14} className="shrink-0 text-kh-text-muted" aria-hidden="true" />
          <span className="truncate">{item.label}</span>
          {archived ? <Status kind="archived" className="ml-auto shrink-0 text-caption font-normal text-kh-text-muted">Archived</Status> : null}
        </Link>
        <Tooltip label={isFavorite ? "Remove from favorites" : "Add to favorites"}><button type="button" onClick={() => onToggleFavorite(item.documentId)} aria-label={`${isFavorite ? "Remove from" : "Add to"} favorites: ${item.label}`} className={`mr-1 inline-flex kh-control kh-icon-control h-6 w-6 shrink-0 items-center justify-center rounded-md kh-focus-ring ${isFavorite ? "text-kh-selected-text" : "kh-row-action text-kh-text-muted hover:bg-kh-bg-hover"}`}>
          <Star size={14} fill={isFavorite ? "currentColor" : "none"} aria-hidden="true" />
        </button></Tooltip>
        {/* Floated just inside the favourite toggle, carrying the row's own
            background: reserving a second control slot would have re-truncated
            every label in the tree to buy a button that is invisible most of
            the time. `right-8` is that toggle's width plus its margin. */}
        <div className="kh-tree-row-actions kh-row-action absolute right-8 top-1/2 flex -translate-y-1/2 items-center rounded-md bg-inherit">
          <RowActionsTrigger actions={actions} onRun={onRunAction} label={item.label} />
        </div>
      </RowContextMenu>
    );
  }

  const collapsed = collapsedIds.has(item.id);
  const actions = item.type === "folder" ? folderActions(item) : [];
  return (
    <li
      role="treeitem"
      aria-label={item.label}
      aria-level={depth}
      aria-expanded={!collapsed}
      data-node-id={item.id}
      data-status={item.status}
      tabIndex={tabIndex}
      onFocus={() => onFocusNode(item.id)}
      className="rounded-md kh-focus-ring"
    >
      <RowContextMenu
        as="div"
        actions={actions}
        onRun={onRunAction}
        className="kh-interactive-row group relative flex min-h-8 items-center"
      >
        <button
          type="button"
          onClick={() => onToggle(item.id)}
          aria-expanded={!collapsed}
          title={item.label}
          tabIndex={-1}
          className={`kh-tree-folder-button kh-control flex min-h-8 min-w-0 flex-1 items-center gap-2 px-2 text-left text-body font-medium kh-focus-ring rounded-md ${archived ? "text-kh-text-muted" : "text-kh-text"}`}
        >
          {collapsed ? <ChevronRight size={14} className="shrink-0 text-kh-text-muted" aria-hidden="true" /> : <ChevronDown size={14} className="shrink-0 text-kh-text-muted" aria-hidden="true" />}
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
          {archived ? <Status kind="archived" className="shrink-0 text-caption font-normal text-kh-text-muted">Archived</Status> : null}
        </button>
        {/* Floated over the header's own background, as a document row's is: a
            second control slot would have re-truncated every folder name. */}
        <div className="kh-row-action absolute right-1 top-1/2 flex -translate-y-1/2 items-center rounded-md bg-inherit">
          <RowActionsTrigger actions={actions} onRun={onRunAction} label={item.label} />
        </div>
      </RowContextMenu>
      {!collapsed && node.children.length > 0 ? (
        <ul role="group" className="ml-3 border-l border-kh-border pl-2">
          {node.children.map((child) => (
            <TreeNodeRow
              key={child.item.id}
              node={child}
              depth={depth + 1}
              scope={scope}
              includeArchived={includeArchived}
              selectedDocumentId={selectedDocumentId}
              collapsedIds={collapsedIds}
              activeId={activeId}
              onToggle={onToggle}
              onFocusNode={onFocusNode}
              favoriteDocumentIds={favoriteDocumentIds}
              onToggleFavorite={onToggleFavorite}
              documentActions={documentActions}
              folderActions={folderActions}
              onRunAction={onRunAction}
            />
          ))}
        </ul>
      ) : null}
      {!collapsed && node.children.length === 0 ? (
        <p className="py-1 pl-6 text-caption text-kh-text-muted">No documents yet.</p>
      ) : null}
    </li>
  );
}

const EMPTY_COLLAPSED: string[] = [];

export function KnowledgeTree({
  items,
  includeArchived = false,
  workspaceId,
  sourceId,
  selectedDocumentId,
  revealLayoutKey,
  sidebarReady = true,
  query = "",
  favoriteDocumentIds,
  onToggleFavorite,
  documentActions,
  folderActions,
  onRunAction,
  onReorder,
}: KnowledgeTreeProps) {
  const router = useRouter();
  const treeRef = useRef<HTMLUListElement>(null);
  // Collapsed folders are per source: the same workspace can hold several
  // trees, and collapsing one should not fold another.
  const [collapsedList, setCollapsedList, collapsedReady] = usePersistedJson<string[]>(
    `kh:tree-collapsed:${workspaceId}:${sourceId}`,
    EMPTY_COLLAPSED,
    isStringArray,
  );
  const collapsedIds = useMemo<ReadonlySet<string>>(() => new Set(collapsedList), [collapsedList]);
  const [activeId, setActiveId] = useState<string | null>(null);

  const roots = useMemo(() => {
    const nested = buildKnowledgeTree(items);
    const needle = query.trim();
    if (needle === "") return nested;
    return filterKnowledgeTree(nested, needle);
  }, [items, query]);

  const filtering = query.trim() !== "";
  // While filtering, ancestors auto-expand; collapsed state is untouched so
  // clearing the filter restores the pre-filter expansion state.
  const effectiveCollapsed = useMemo(
    () => (filtering ? new Set<string>() : collapsedIds),
    [filtering, collapsedIds],
  );

  const layout = useMemo(
    () => ({ selectedDocumentId, effectiveCollapsed, roots, revealLayoutKey, sidebarReady, collapsedReady }),
    [selectedDocumentId, effectiveCollapsed, roots, revealLayoutKey, sidebarReady, collapsedReady],
  );
  const [settledLayout, setSettledLayout] = useState<typeof layout | null>(null);

  // Reveal only the hidden portion of the selected row, without moving the
  // document pane or recentering a row that is already visible.
  useLayoutEffect(() => {
    if (!sidebarReady || !collapsedReady) return;
    const tree = treeRef.current;
    const selected = tree?.querySelector<HTMLElement>('[aria-current="page"]');
    const scroller = tree?.closest("nav");
    if (selected && scroller) {
      const row = selected.getBoundingClientRect();
      const viewport = scroller.getBoundingClientRect();
      if (row.top < viewport.top) scroller.scrollTop += row.top - viewport.top;
      else if (row.bottom > viewport.bottom) scroller.scrollTop += row.bottom - viewport.bottom;
    }
    // Ancestor expansion runs in an effect. A newer layout cancels these frames before readiness is exposed.
    let second: number | undefined;
    const first = window.requestAnimationFrame(() => {
      second = window.requestAnimationFrame(() => startTransition(() => setSettledLayout(layout)));
    });
    return () => {
      window.cancelAnimationFrame(first);
      if (second !== undefined) window.cancelAnimationFrame(second);
    };
  }, [layout, sidebarReady, collapsedReady]);

  const itemById = useMemo(() => {
    const map = new Map<string, KnowledgeTreeItem>();
    for (const item of items) map.set(item.id, item);
    return map;
  }, [items]);

  // Opens `startId` and every folder above it, and only those: the reader's other folders stay as they were.
  const expandFrom = useCallback(
    (startId: string | null) => {
      const open = new Set<string>();
      for (let cursor = startId; cursor && !open.has(cursor); cursor = itemById.get(cursor)?.parentId ?? null) open.add(cursor);
      setCollapsedList((previous) => (previous.some((id) => open.has(id)) ? previous.filter((id) => !open.has(id)) : previous));
    },
    [itemById, setCollapsedList],
  );

  // A document opened from somewhere else — a search hit, a link, a new document made inside a
  // folder — is shown in the tree, not hidden in a folder that was collapsed. Once per document:
  // collapsing its folder afterwards is the reader's choice and stays.
  const revealedFor = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!selectedDocumentId || revealedFor.current === selectedDocumentId) return;
    const opened = items.find((item) => item.type === "document" && item.documentId === selectedDocumentId);
    if (!opened) return;
    revealedFor.current = selectedDocumentId;
    expandFrom(opened.parentId);
  }, [selectedDocumentId, items, expandFrom]);

  // Something was put inside a folder (the move dialog): open it, so it is seen where it went. Only
  // the tree that has that folder answers.
  useEffect(() => {
    const reveal = (event: Event) => {
      const folderId = (event as CustomEvent<{ folderId?: unknown }>).detail?.folderId;
      if (typeof folderId === "string" && itemById.get(folderId)?.type === "folder") expandFrom(folderId);
    };
    window.addEventListener(REVEAL_FOLDER_EVENT, reveal);
    return () => window.removeEventListener(REVEAL_FOLDER_EVENT, reveal);
  }, [itemById, expandFrom]);

  // Alt+↑/↓ moves the focused row among its siblings. A request is in flight until the tree it changed
  // arrives; a key pressed meanwhile is not aimed at a tree that is about to be different, but kept —
  // the latest one, so a held key goes one step per round trip and stops when it is let go, and a press
  // the other way is a step back rather than lost — and made when the new tree is here. The focus is
  // put back on the row then too, since a row that has changed its place in the list may have been
  // taken out of the page and put back, which drops focus.
  const reordering = useRef(false);
  const reorderGiveUp = useRef<number | undefined>(undefined);
  const queuedReorder = useRef<{ id: string; direction: -1 | 1 } | null>(null);
  const focusAfterReorder = useRef<string | null>(null);
  const [announcement, setAnnouncement] = useState({ text: "", sequence: 0 });
  const announce = (text: string) => setAnnouncement((previous) => ({ text, sequence: previous.sequence + 1 }));
  useEffect(() => () => window.clearTimeout(reorderGiveUp.current), []);
  useEffect(() => {
    reordering.current = false;
    window.clearTimeout(reorderGiveUp.current);
    const id = focusAfterReorder.current;
    focusAfterReorder.current = null;
    if (id) Array.from(treeRef.current?.querySelectorAll<HTMLElement>("[data-node-id]") ?? []).find((element) => element.dataset.nodeId === id)?.focus();
    const queued = queuedReorder.current;
    queuedReorder.current = null;
    const item = queued ? itemById.get(queued.id) : undefined;
    if (queued && item) void reorder(item, queued.direction);
    // The dependency is "the tree arrived"; `reorder` reads the render this effect is in, which is that one.
  }, [items]);

  async function reorder(item: KnowledgeTreeItem, direction: -1 | 1) {
    // A filtered tree shows some of the siblings, and the ones next to this row in it are not its neighbours.
    if (filtering) {
      announce(CLEAR_FILTER_TO_REORDER);
      return;
    }
    if (reordering.current) {
      queuedReorder.current = { id: item.id, direction };
      return;
    }
    const step = reorderStep(roots, item.id, direction);
    if (!step) return;
    if (step.kind === "edge") {
      announce(alreadyAtEdge(item.label, direction < 0 ? "first" : "last"));
      return;
    }
    reordering.current = true;
    // If the tree never arrives, the next key press is not lost for good.
    window.clearTimeout(reorderGiveUp.current);
    reorderGiveUp.current = window.setTimeout(() => {
      reordering.current = false;
      queuedReorder.current = null;
    }, 3000);
    if (await onReorder({ nodeId: item.id, position: step.position })) {
      focusAfterReorder.current = item.id;
      announce(reorderedNode(item.label, direction < 0 ? "up" : "down", step.index, step.count));
    } else {
      reordering.current = false;
      queuedReorder.current = null;
      window.clearTimeout(reorderGiveUp.current);
    }
  }

  const toggle = (id: string) => {
    setCollapsedList((previous) =>
      previous.includes(id) ? previous.filter((entry) => entry !== id) : [...previous, id],
    );
    setActiveId(id);
  };

  function handleKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    // Alt+arrow is a different key from the arrow: the plain one moves the focus, this one moves the row.
    if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      const row = (event.target as HTMLElement).closest?.('[role="treeitem"]') as HTMLElement | null;
      const item = row?.dataset.nodeId ? itemById.get(row.dataset.nodeId) : undefined;
      if (!item) return;
      const actions = item.type === "document" ? documentActions(item) : folderActions(item);
      // Only a row the reader may move: the same actions the row's menu is made of, so a row that has no
      // Move there has no reorder here, and the key is left alone for whatever else wanted it.
      if (!actions.some((action) => action.id === "document.move" || action.id === "folder.move")) return;
      event.preventDefault();
      void reorder(item, event.key === "ArrowUp" ? -1 : 1);
      return;
    }
    const container = event.currentTarget;
    const visible = Array.from(container.querySelectorAll<HTMLElement>('[role="treeitem"]'));
    if (visible.length === 0) return;
    const current = (event.target as HTMLElement).closest?.('[role="treeitem"]') as HTMLElement | null;
    const index = current ? visible.indexOf(current) : -1;
    const focusAt = (nextIndex: number) => {
      const target = visible[nextIndex];
      if (target) {
        target.focus();
        if (target.dataset.nodeId) setActiveId(target.dataset.nodeId);
      }
    };
    // A single key is only a key where it is not a character (`isSingleKeyShortcut`): not in a field, a
    // dialog or a menu, not with a modifier. Row keys and `j`/`k` ask that first.
    const single = isSingleKeyShortcut(event.nativeEvent) ? event.key.toLowerCase() : "";
    if (single && current?.dataset.nodeId) {
      const item = itemById.get(current.dataset.nodeId);
      if (item && claimedRowKeys(item.type).has(single)) {
        // The tree takes the key even where the row may not do the thing: the registry offers no Edit on a
        // read-only row, and the page's own E must not edit the document being read instead.
        event.preventDefault();
        const actions = item.type === "document" ? documentActions(item) : folderActions(item);
        const action = actionForKey(actions, event);
        if (action) onRunAction(action);
        return;
      }
    }
    // j and k are the arrows' other spelling; held with a modifier they are not keys at all.
    const arrow = single === "j" ? "ArrowDown" : single === "k" ? "ArrowUp" : event.key;
    switch (arrow) {
      case "ArrowDown":
        event.preventDefault();
        focusAt(index < 0 ? 0 : Math.min(index + 1, visible.length - 1));
        break;
      case "ArrowUp":
        event.preventDefault();
        focusAt(index < 0 ? 0 : Math.max(index - 1, 0));
        break;
      case "ArrowRight":
        if (current?.dataset.nodeId) {
          const item = itemById.get(current.dataset.nodeId);
          if (item?.type === "folder" && collapsedIds.has(item.id)) {
            event.preventDefault();
            toggle(item.id);
          }
        }
        break;
      case "ArrowLeft":
        if (current?.dataset.nodeId) {
          const item = itemById.get(current.dataset.nodeId);
          if (item?.type === "folder" && !collapsedIds.has(item.id)) {
            event.preventDefault();
            toggle(item.id);
          } else {
            const parent = current.parentElement?.closest?.('[role="treeitem"]') as HTMLElement | null;
            if (parent) {
              event.preventDefault();
              parent.focus();
              if (parent.dataset.nodeId) setActiveId(parent.dataset.nodeId);
            }
          }
        }
        break;
      case "Enter":
        if (current?.dataset.nodeId && !["A", "BUTTON"].includes((event.target as HTMLElement).tagName)) {
          const item = itemById.get(current.dataset.nodeId);
          if (item?.type === "folder") {
            event.preventDefault();
            toggle(item.id);
          } else if (item?.type === "document") {
            event.preventDefault();
            router.push(documentHref(item, { workspaceId, sourceId }, includeArchived));
          }
        }
        break;
      default:
        break;
    }
  }

  if (roots.length === 0) {
    return filtering ? (
      <p className="px-2 py-3 text-body text-kh-text-muted">No matching documents.</p>
    ) : (
      <p className="text-body text-kh-text-muted">No documents in this collection.</p>
    );
  }

  const firstId = roots[0]?.item.id;
  return (
    <>
    {/* Where a row went after Alt+↑/↓, said aloud. Remounted per message so the same words twice are heard twice.
        A live region and not `role="status"`: the toast layer is the page's one status, and a second would
        make every "the status" of a page with a tree ambiguous. */}
    <div aria-live="polite" aria-atomic="true" className="sr-only">
      <p key={announcement.sequence}>{announcement.text}</p>
    </div>
    <ul
      ref={treeRef}
      role="tree"
      aria-label="Knowledge tree"
      aria-busy={settledLayout !== layout}
      onKeyDown={handleKeyDown}
      className="space-y-0.5"
    >
      {roots.map((node) => (
        <TreeNodeRow
          key={node.item.id}
          node={node}
          depth={1}
          scope={{ workspaceId, sourceId }}
          includeArchived={includeArchived}
          selectedDocumentId={selectedDocumentId}
          collapsedIds={effectiveCollapsed}
          activeId={activeId ?? firstId ?? null}
          onToggle={toggle}
          onFocusNode={setActiveId}
          favoriteDocumentIds={favoriteDocumentIds}
          onToggleFavorite={onToggleFavorite}
          documentActions={documentActions}
          folderActions={folderActions}
          onRunAction={onRunAction}
        />
      ))}
    </ul>
    </>
  );
}
