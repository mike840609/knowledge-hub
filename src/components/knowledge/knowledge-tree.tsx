"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  buildKnowledgeTree,
  filterKnowledgeTree,
  type KnowledgeTreeNode,
} from "@/lib/knowledge-navigation";
import type { KnowledgeTreeItem } from "@/modules/knowledge/application/knowledge-query-service";

export type KnowledgeTreeProps = {
  items: KnowledgeTreeItem[];
  includeArchived?: boolean;
  /** Workspace/Source scope for canonical `/w/:workspaceId/knowledge/:sourceId/:documentId` hrefs. */
  workspaceId: string;
  sourceId: string;
  selectedDocumentId?: string;
  /** Client-local filter text; ancestors stay visible and expansion is restored on clear. */
  query?: string;
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
}) {
  const { item } = node;
  const isActive = activeId === null ? false : activeId === item.id;
  const tabIndex = activeId === null ? undefined : isActive ? 0 : -1;

  if (item.type === "document") {
    const selected = selectedDocumentId !== undefined && item.documentId === selectedDocumentId;
    return (
      <li
        role="treeitem"
        aria-label={item.label}
        aria-level={depth}
        aria-current={selected ? "page" : undefined}
        aria-selected={selected ? true : undefined}
        data-node-id={item.id}
        tabIndex={tabIndex}
        onFocus={() => onFocusNode(item.id)}
        className={`rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-kh-accent ${selected ? "bg-kh-bg-hover" : ""}`}
      >
        <Link
          href={documentHref(item, scope, includeArchived)}
          title={item.label}
          className={`block truncate rounded px-2 py-1.5 text-sm hover:bg-kh-bg-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-kh-accent ${
            selected ? "font-semibold text-kh-text" : "text-kh-text-muted"
          }`}
        >
          {item.label}
        </Link>
      </li>
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
      className="rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-kh-accent"
    >
      <button
        type="button"
        onClick={() => onToggle(item.id)}
        aria-expanded={!collapsed}
        title={item.label}
        tabIndex={-1}
        className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-sm font-medium text-kh-text hover:bg-kh-bg-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-kh-accent"
      >
        <span aria-hidden="true" className="inline-block w-3 shrink-0 text-kh-text-muted">
          {collapsed ? "▸" : "▾"}
        </span>
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
            />
          ))}
        </ul>
      ) : null}
      {!collapsed && node.children.length === 0 ? (
        <p className="py-1 pl-7 text-xs text-kh-text-muted">No documents yet.</p>
      ) : null}
    </li>
  );
}

export function KnowledgeTree({
  items,
  includeArchived = false,
  workspaceId,
  sourceId,
  selectedDocumentId,
  query = "",
}: KnowledgeTreeProps) {
  const router = useRouter();
  const treeRef = useRef<HTMLUListElement>(null);
  const [collapsedIds, setCollapsedIds] = useState<ReadonlySet<string>>(new Set());
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
    setCollapsedIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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
        if (current?.dataset.nodeId && (event.target as HTMLElement).tagName !== "A") {
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
      <p className="px-2 py-3 text-sm text-kh-text-muted">No matching documents.</p>
    ) : (
      <p className="text-sm text-kh-text-muted">This source has no active tree nodes.</p>
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
        />
      ))}
    </ul>
  );
}
