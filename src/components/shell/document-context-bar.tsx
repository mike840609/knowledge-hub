"use client";

import { useContext } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MoreHorizontal, PanelRight } from "lucide-react";
import { DocumentTopbarContext } from "./document-topbar-context";
import { useWorkspaceAuthorization } from "./use-workspace-authorization";
import { buttonClasses } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { MenuRoot, MenuTrigger, MenuContent, MenuItem } from "@/components/ui/menu";
import { ActionIcon } from "@/components/actions/action-icon";
import { requestShare } from "@/components/actions/action-menu";
import { actionsFor } from "@/components/actions/action-registry";

/**
 * The document's title and its Edit / Share / Details, shown once the document's own header has scrolled
 * away. A wide screen draws it across the top of the document pane; a narrow one, in the topbar.
 */
export function DocumentContextBar({ workspaceId, className = "" }: { workspaceId: string; className?: string }) {
  const state = useContext(DocumentTopbarContext)?.document;
  const pathname = usePathname();
  const active = state?.pathname === pathname;
  const visible = active && state.visible;
  const { access, confirmed } = useWorkspaceAuthorization();
  const contextual = active ? actionsFor("palette", { workspaceId, workspaceType: access.workspace.type, can: access.actions, confirmed, target: { ...state.target, favorite: false } }) : [];
  const edit = contextual.find(action => action.id === "document.edit");
  const share = contextual.find(action => action.id === "document.share");
  return (
    <div aria-hidden={!visible} inert={!visible}
      className={`flex min-w-0 items-center gap-2 transition-opacity duration-120 ease-out ${visible ? "opacity-100" : "pointer-events-none opacity-0"} ${className}`}>
      <span className="min-w-0 flex-1 truncate text-body font-semibold text-kh-text" title={active ? state.title : undefined}>
        {active ? state.title : ""}
      </span>
      {edit?.effect.kind === "navigate" ? <Tooltip label="Edit" shortcut="E"><Link href={edit.effect.href} aria-label="Edit" className={buttonClasses({ variant: "ghost", icon: true, className: "hidden sm:inline-flex" })}><ActionIcon name="edit" className="h-4 w-4" /></Link></Tooltip> : null}
      {share && active ? <Tooltip label="Share link"><button type="button" aria-label="Share link…" onClick={() => requestShare(state.target.documentId)} className={buttonClasses({ variant: "ghost", icon: true, className: "hidden sm:inline-flex" })}><ActionIcon name="share" className="h-4 w-4" /></button></Tooltip> : null}
      <Tooltip label="Details" shortcut="Meta+I Control+I">
        <button type="button" aria-label="Document details" aria-keyshortcuts="Meta+I Control+I" onClick={active ? state.onDetailsClick : undefined}
          className={buttonClasses({ variant: "ghost", className: "hidden sm:inline-flex" })}>
          <PanelRight className="h-4 w-4" aria-hidden="true" />
          <span className="hidden sm:inline">Details</span>
        </button>
      </Tooltip>
      {active ? <MenuRoot>
        <MenuTrigger aria-label="Document actions" className={buttonClasses({ variant: "ghost", icon: true, className: "sm:hidden" })}><MoreHorizontal size={16} aria-hidden="true" /></MenuTrigger>
        <MenuContent align="end">
          {edit?.effect.kind === "navigate" ? <MenuItem render={<Link href={edit.effect.href} />}>Edit document</MenuItem> : null}
          {share ? <MenuItem onClick={() => requestShare(state.target.documentId)}>Share link…</MenuItem> : null}
          <MenuItem onClick={state.onDetailsClick}>Document details</MenuItem>
        </MenuContent>
      </MenuRoot> : null}
    </div>
  );
}
