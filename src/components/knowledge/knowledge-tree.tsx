"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, FileText, Star } from "lucide-react";
import {
  buildKnowledgeTree,
  filterKnowledgeTree,
  type KnowledgeTreeNode,
} from "@/lib/knowledge-navigation";
import type { KnowledgeTreeItem } from "@/modules/knowledge/application/knowledge-query-service";
import { isStringArray, usePersistedJson } from "@/components/shell/use-persisted-state";
import { RowActionsTrigger, RowContextMenu } from "@/components/actions/action-menu";
import type { Action } from "@/components/actions/action-registry";

export type KnowledgeTreeProps = {
  items: KnowledgeTreeItem[];
  includeArchived?: boolean;
  /** Workspace/Source scope for canonical `/w/:workspaceId/knowledge/:sourceId/:documentId` hrefs. */
  workspaceId: string;
  sourceId: string;
  selectedDocumentId?: string;
  /** Client-local filter text; ancestors stay visible and expansion is restored on clear. */
  query?: string;
  favoriteDocumentIds: ReadonlySet<string>;
  onToggleFavorite: (documentId: string) => void;
  /** What this reader may do to this document, from the one registry. */
  documentActions: (item: Extract<KnowledgeTreeItem, { type: "document" }>) => readonly Action[];
  onRunAction: (action: Action) => void;
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
  onRunAction: (action: Action) => void;
}) {
  const { item } = node;
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
        tabIndex={tabIndex}
        onFocus={() => onFocusNode(item.id)}
        className={`kh-interactive-row group relative flex min-h-9 items-center ${selected ? "bg-kh-bg-selected hover:bg-kh-bg-selected" : ""}`}
      >
        <Link
          href={documentHref(item, scope, includeArchived)}
          title={item.label}
          className={`flex min-h-9 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-body kh-focus-ring ${
            selected ? "font-medium text-kh-selected-text" : "text-kh-text-muted"
          }`}
        >
          <FileText size={14} strokeWidth={1.8} className="shrink-0 text-kh-text-muted" aria-hidden="true" />
          <span className="truncate">{item.label}</span>
        </Link>
        <button type="button" onClick={() => onToggleFavorite(item.documentId)} aria-label={`${isFavorite ? "Remove from" : "Add to"} favorites: ${item.label}`} title={isFavorite ? "Remove from favorites" : "Add to favorites"} className={`mr-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md kh-focus-ring ${isFavorite ? "text-kh-selected-text" : "kh-row-action text-kh-text-muted hover:bg-kh-bg-hover"}`}>
          <Star size={14} strokeWidth={1.8} fill={isFavorite ? "currentColor" : "none"} aria-hidden="true" />
        </button>
        {/* Floated just inside the favourite toggle, carrying the row's own
            background: reserving a second control slot would have re-truncated
            every label in the tree to buy a button that is invisible most of
            the time. `right-8` is that toggle's width plus its margin. */}
        <div className="kh-row-action absolute right-8 top-1/2 flex -translate-y-1/2 items-center rounded-md bg-inherit">
          <RowActionsTrigger actions={actions} onRun={onRunAction} label={item.label} />
        </div>
      </RowContextMenu>
    );
  }

  const collapsed = collapsedIds.has(item.id);
  return (
    <li
      role="treeitem"
      aria-label={item.label}
      aria-level={depth}
      aria-expanded={!collapsed}
      data-node-id={item.id}
      tabIndex={tabIndex}
      onFocus={() => onFocusNode(item.id)}
      className="rounded-md kh-focus-ring"
    >
      <button
        type="button"
        onClick={() => onToggle(item.id)}
        aria-expanded={!collapsed}
        title={item.label}
        tabIndex={-1}
        className="kh-interactive-row flex min-h-9 w-full items-center gap-2 px-2 text-left text-body font-medium text-kh-text"
      >
        {collapsed ? <ChevronRight size={14} strokeWidth={1.8} className="shrink-0 text-kh-text-muted" aria-hidden="true" /> : <ChevronDown size={14} strokeWidth={1.8} className="shrink-0 text-kh-text-muted" aria-hidden="true" />}
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
      </button>
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
              onRunAction={onRunAction}
            />
          ))}
        </ul>
      ) : null}
      {!collapsed && node.children.length === 0 ? (
        <p className="py-1 pl-7 text-caption text-kh-text-muted">No documents yet.</p>
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
  query = "",
  favoriteDocumentIds,
  onToggleFavorite,
  documentActions,
  onRunAction,
}: KnowledgeTreeProps) {
  const router = useRouter();
  const treeRef = useRef<HTMLUListElement>(null);
  // Collapsed folders are per source: the same workspace can hold several
  // trees, and collapsing one should not fold another.
  const [collapsedList, setCollapsedList] = usePersistedJson<string[]>(
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

  // Reveal only the hidden portion of the selected row, without moving the
  // document pane or recentering a row that is already visible.
  useEffect(() => {
    const tree = treeRef.current;
    const selected = tree?.querySelector<HTMLElement>('[aria-current="page"]');
    const scroller = tree?.closest("nav");
    if (!selected || !scroller) return;
    const row = selected.getBoundingClientRect();
    const viewport = scroller.getBoundingClientRect();
    if (row.top < viewport.top) scroller.scrollTop += row.top - viewport.top;
    else if (row.bottom > viewport.bottom) scroller.scrollTop += row.bottom - viewport.bottom;
  }, [selectedDocumentId, effectiveCollapsed, roots]);

  const itemById = useMemo(() => {
    const map = new Map<string, KnowledgeTreeItem>();
    for (const item of items) map.set(item.id, item);
    return map;
  }, [items]);

  const toggle = (id: string) => {
    setCollapsedList((previous) =>
      previous.includes(id) ? previous.filter((entry) => entry !== id) : [...previous, id],
    );
    setActiveId(id);
  };

  function handleKeyDown(event: React.KeyboardEvent<HTMLElement>) {
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
    switch (event.key) {
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
    <ul
      ref={treeRef}
      role="tree"
      aria-label="Knowledge tree"
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
          onRunAction={onRunAction}
        />
      ))}
    </ul>
  );
}
