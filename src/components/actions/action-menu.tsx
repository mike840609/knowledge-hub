"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import { buttonClasses } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
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

export const SHARE_REQUEST_EVENT = "kh:request-share";

/**
 * Ask the share-link dialog (ShareLinkDialogHost, mounted by the knowledge
 * layout) to open for a document. The one way every surface asks, so the
 * event's shape lives in one place.
 */
export function requestShare(documentId: string): void {
  window.dispatchEvent(new CustomEvent(SHARE_REQUEST_EVENT, { detail: { documentId } }));
}

/**
 * Write an in-app href to the clipboard as an absolute URL. False when the
 * browser refuses — an insecure origin, a denied permission, a document
 * without focus — so each caller can say so in its own place.
 */
export async function writeLinkToClipboard(href: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(new URL(href, window.location.origin).toString());
    return true;
  } catch {
    return false;
  }
}

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
  const toast = useToast();
  return useCallback(
    (action: Action) => {
      const { effect } = action;
      switch (effect.kind) {
        case "navigate":
          router.push(effect.href);
          return;
        case "load":
          window.location.assign(effect.href);
          return;
        case "open-new-tab":
          // `noopener` so the new tab cannot reach back into this one.
          window.open(effect.href, "_blank", "noopener");
          return;
        case "copy-link":
          void copyLink(effect.href, toast);
          return;
        case "command":
          switch (effect.command) {
            case "document.toggle-favorite":
              onToggleFavorite(effect.sourceId, effect.documentId);
              return;
            case "document.open-details":
              // The inspector belongs to the document pane, which owns whether
              // it is open; asking is the only thing a detached surface can do.
              window.dispatchEvent(new CustomEvent("kh:request-details"));
              return;
            case "document.open-share":
              // The dialog lives with the knowledge layout; any surface asks
              // for it the same way it asks for details.
              requestShare(effect.documentId);
              return;
          }
      }
    },
    [router, toast, onToggleFavorite],
  );
}

/**
 * The browser's own "Copy link address" gave no feedback because the menu it
 * lived in was the feedback. This one closes before the copy lands, so it has
 * to say whether it worked — and the clipboard can refuse: an insecure origin,
 * a denied permission, a document without focus.
 */
async function copyLink(href: string, toast: ReturnType<typeof useToast>) {
  if (await writeLinkToClipboard(href)) toast({ message: "Link copied." });
  else toast({ message: "Could not copy the link. Your browser blocked the clipboard.", tone: "danger" });
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
