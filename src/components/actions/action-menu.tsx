"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import { buttonClasses } from "@/components/ui/button";
import {
  ContextMenuContent,
  ContextMenuRoot,
  ContextMenuTrigger,
  MenuContent,
  MenuItem,
  MenuRoot,
  MenuTrigger,
} from "@/components/ui/menu";
import { ActionIcon } from "./action-icon";
import type { Action } from "./action-registry";

/**
 * Turning registry entries into rows, and running what a reader picks.
 *
 * Every surface renders the same component for the same action, so a menu
 * opened by right-click, a menu opened by the `⋯` button and the palette
 * cannot disagree about an action's label, its icon or what it does.
 */

export type ActionHandlers = {
  /** Client-local, so it is a callback rather than a request. */
  onToggleFavorite: (sourceId: string, documentId: string) => void;
};

export function useActionRunner({ onToggleFavorite }: ActionHandlers) {
  const router = useRouter();
  return useCallback(
    (action: Action) => {
      if (action.effect.kind === "navigate") {
        router.push(action.effect.href);
        return;
      }
      switch (action.effect.command) {
        case "document.toggle-favorite":
          onToggleFavorite(action.effect.sourceId, action.effect.documentId);
          break;
        case "document.open-details":
          // The inspector belongs to the document pane, which owns whether it
          // is open; asking is the only thing a detached surface can do.
          window.dispatchEvent(new CustomEvent("kh:request-details"));
          break;
      }
    },
    [router, onToggleFavorite],
  );
}

export function ActionMenuItems({
  actions,
  onRun,
}: {
  actions: readonly Action[];
  onRun: (action: Action) => void;
}) {
  return (
    <>
      {actions.map((action) => (
        <MenuItem key={action.id} onClick={() => onRun(action)}>
          <ActionIcon name={action.icon} />
          <span className="min-w-0 flex-1 truncate">{action.label}</span>
        </MenuItem>
      ))}
    </>
  );
}

/**
 * The `⋯` trigger. It exists so that the row's actions have a visible,
 * keyboard-reachable opening; right-click is the shortcut, not the only door.
 *
 * It does not place itself. A row that reserved a second control slot would
 * re-truncate every label in the tree to buy a button that is invisible most
 * of the time, so the caller floats it over the row's own background instead.
 */
export function RowActionsTrigger({
  actions,
  onRun,
  label,
  className = "",
}: {
  actions: readonly Action[];
  onRun: (action: Action) => void;
  label: string;
  className?: string;
}) {
  if (actions.length === 0) return null;
  return (
    <MenuRoot>
      <MenuTrigger
        aria-label={`Actions for ${label}`}
        title="Actions"
        className={buttonClasses({ variant: "ghost", icon: true, size: "sm", className })}
      >
        <MoreHorizontal size={15} aria-hidden="true" />
      </MenuTrigger>
      <MenuContent align="end" className="w-48">
        <ActionMenuItems actions={actions} onRun={onRun} />
      </MenuContent>
    </MenuRoot>
  );
}

/**
 * Wraps a row so right-click and long-press open the same list. `render` hands
 * Base UI the element the row already is — a `<li role="treeitem">` here —
 * rather than nesting a div inside it and breaking the tree's own structure.
 */
/**
 * Spelled out rather than taken from `ComponentPropsWithoutRef<"li">`: Base UI
 * types its trigger against a `<div>`, and the two element types disagree
 * about every event handler. These are the attributes a tree row actually
 * sets, and naming them keeps both branches below type-checked.
 */
type RowProps = {
  role: string;
  tabIndex?: number;
  className?: string;
  onFocus?: () => void;
  "aria-label"?: string;
  "aria-level"?: number;
  "aria-expanded"?: boolean;
  "aria-current"?: "page";
  "aria-selected"?: boolean;
  "data-node-id"?: string;
};

export function RowContextMenu({
  actions,
  onRun,
  children,
  ...rowProps
}: {
  actions: readonly Action[];
  onRun: (action: Action) => void;
  children: React.ReactNode;
} & RowProps) {
  if (actions.length === 0) return <li {...rowProps}>{children}</li>;
  return (
    <ContextMenuRoot>
      <ContextMenuTrigger render={<li />} {...rowProps}>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ActionMenuItems actions={actions} onRun={onRun} />
      </ContextMenuContent>
    </ContextMenuRoot>
  );
}
