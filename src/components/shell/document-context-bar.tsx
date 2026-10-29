"use client";

import { useContext } from "react";
import { usePathname } from "next/navigation";
import { MoreHorizontal, PanelRight, Star } from "lucide-react";
import { DocumentTopbarContext } from "./document-topbar-context";
import { useWorkspaceAuthorization } from "./use-workspace-authorization";
import { buttonClasses } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { MenuRoot, MenuTrigger, MenuContent } from "@/components/ui/menu";
import { ActionIcon } from "@/components/actions/action-icon";
import { ActionMenuItems, requestShare, useActionRunner } from "@/components/actions/action-menu";
import { actionsFor, type ActionId } from "@/components/actions/action-registry";
import { documentShortcutKey, useDocumentShortcuts } from "@/components/knowledge/use-document-shortcuts";
import { toggleFavoriteDocument } from "@/lib/document-shortcuts";

/**
 * The document's title and its actions, shown in a narrow window's topbar once
 * the document's own header has scrolled away. A wide window needs none: the
 * document pins its breadcrumb line instead.
 *
 * The star is the same personal favorite as the explorer's; the overflow is the
 * registry's row list, so a page can be duplicated, moved, exported or archived
 * without going back to the tree to find it.
 */
export function DocumentContextBar({ workspaceId, className = "" }: { workspaceId: string; className?: string }) {
  const state = useContext(DocumentTopbarContext)?.document;
  const pathname = usePathname();
  const active = state?.pathname === pathname;
  const visible = active && state.visible;
  const { access, confirmed } = useWorkspaceAuthorization();
  const { shortcuts, update } = useDocumentShortcuts(workspaceId);
  const favoriteKey = state ? documentShortcutKey(state.target.sourceId, state.target.documentId) : "";
  const favorite = active && shortcuts.favorites.includes(favoriteKey);
  const toggleFavorite = () => {
    if (active) update((previous) => toggleFavoriteDocument(previous, favoriteKey));
  };
  const runAction = useActionRunner({ onToggleFavorite: () => toggleFavorite() });
  const hidden = new Set<ActionId>(["document.favorite", "document.open-side-peek", "document.open-new-tab"]);
  const contextual = active
    ? actionsFor("row", { workspaceId, workspaceType: access.workspace.type, can: access.actions, confirmed, target: { ...state.target, favorite } })
    : [];
  const share = contextual.find((action) => action.id === "document.share");
  const actions = contextual.filter((action) => !hidden.has(action.id));
  return (
    <div aria-hidden={!visible} inert={!visible}
      className={`flex min-w-0 items-center gap-2 transition-opacity duration-120 ease-out ${visible ? "opacity-100" : "pointer-events-none opacity-0"} ${className}`}>
      <span className="min-w-0 flex-1 truncate text-body font-semibold text-kh-text" title={active ? state.title : undefined}>
        {active ? state.title : ""}
      </span>
      {share && active ? <Tooltip label="Share link"><button type="button" aria-label="Share link…" onClick={() => requestShare({ documentId: state.target.documentId })} className={buttonClasses({ variant: "ghost", icon: true, className: "hidden sm:inline-flex" })}><ActionIcon name="share" className="h-4 w-4" /></button></Tooltip> : null}
      {active ? <Tooltip label={favorite ? "Remove from favorites" : "Add to favorites"}>
        <button type="button" aria-label={favorite ? "Remove from favorites" : "Add to favorites"} aria-pressed={favorite} onClick={toggleFavorite}
          className={buttonClasses({ variant: "ghost", icon: true, className: favorite ? "text-kh-selected-text" : "" })}>
          <Star className="h-4 w-4" fill={favorite ? "currentColor" : "none"} aria-hidden="true" />
        </button>
      </Tooltip> : null}
      <Tooltip label="Details" shortcut="Meta+I Control+I">
        <button type="button" aria-label="Document details" aria-keyshortcuts="Meta+I Control+I" onClick={active ? state.onDetailsClick : undefined}
          className={buttonClasses({ variant: "ghost", className: "hidden sm:inline-flex" })}>
          <PanelRight className="h-4 w-4" aria-hidden="true" />
          <span className="hidden sm:inline">Details</span>
        </button>
      </Tooltip>
      {active && actions.length > 0 ? <MenuRoot>
        <MenuTrigger aria-label="Document actions" className={buttonClasses({ variant: "ghost", icon: true })}><MoreHorizontal size={16} aria-hidden="true" /></MenuTrigger>
        <MenuContent align="end" className="w-56">
          <ActionMenuItems actions={actions} onRun={runAction} />
        </MenuContent>
      </MenuRoot> : null}
    </div>
  );
}
