"use client";

import { useContext } from "react";
import { usePathname } from "next/navigation";
import { DocumentTopbarContext } from "./document-topbar-context";
import { Menu, MoreHorizontal, PanelLeftClose, PanelLeftOpen, PanelRight } from "lucide-react";
import type { WorkspaceShellModel } from "@/server/knowledge-read";
import { QuickSearch } from "@/components/search/quick-search";
import { buttonClasses } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { MenuRoot, MenuTrigger, MenuContent, MenuItem } from "@/components/ui/menu";
import Link from "next/link";
import { ActionIcon } from "@/components/actions/action-icon";
import { requestShare } from "@/components/actions/action-menu";
import { useWorkspaceAuthorization } from "./use-workspace-authorization";
import { actionsFor } from "@/components/actions/action-registry";
import { NAV_TOGGLE_SHORTCUT } from "@/components/actions/action-registry";

export function Topbar({
  model,
  onMenuClick,
  navCollapsed,
  onToggleNav,
}: {
  model: WorkspaceShellModel;
  onMenuClick?: () => void;
  navCollapsed: boolean;
  onToggleNav: () => void;
}) {
  const state = useContext(DocumentTopbarContext)?.document;
  const pathname = usePathname();
  const active = state?.pathname === pathname;
  const visible = active && state.visible;
  const { access, confirmed } = useWorkspaceAuthorization();
  const contextual = active ? actionsFor("palette", { workspaceId: model.workspace.id, workspaceType: access.workspace.type, can: access.actions, confirmed, target: { ...state.target, favorite: false } }) : [];
  const edit = contextual.find(action => action.id === "document.edit");
  const share = contextual.find(action => action.id === "document.share");
  return (
    <header className="flex h-12 shrink-0 items-center border-b border-kh-border bg-kh-bg-raised">
      <div className={`flex shrink-0 items-center gap-2 px-3 lg:h-full lg:border-r lg:border-kh-border lg:bg-kh-bg-sunken ${navCollapsed ? "lg:w-12 lg:px-2" : "lg:w-40"}`}>
        {onMenuClick ? <button type="button" aria-label="Open menu" onClick={onMenuClick} className={buttonClasses({ variant: "ghost", icon: true, className: "lg:hidden" })}><Menu className="h-4 w-4" aria-hidden="true" /></button> : null}
        <Tooltip label={navCollapsed ? "Expand navigation" : "Collapse navigation"} shortcut={NAV_TOGGLE_SHORTCUT}>
          <button type="button" onClick={onToggleNav} aria-label={navCollapsed ? "Expand navigation" : "Collapse navigation"} aria-keyshortcuts={NAV_TOGGLE_SHORTCUT} className={buttonClasses({ variant: "ghost", icon: true, className: "max-lg:hidden" })}>
            {navCollapsed ? <PanelLeftOpen className="h-4 w-4" aria-hidden="true" /> : <PanelLeftClose className="h-4 w-4" aria-hidden="true" />}
          </button>
        </Tooltip>
        <span className={`hidden whitespace-nowrap text-caption font-semibold text-kh-text sm:block ${navCollapsed ? "lg:hidden" : ""}`}>Knowledge Hub</span>
      </div>
      {/* Aligned with the 288px explorer below it; the workspace switcher heads the rail instead. */}
      <div className="flex h-full w-32 min-w-0 shrink-0 items-center pr-2 sm:w-64 sm:px-3 lg:w-72">
        <QuickSearch workspaceId={model.workspace.id} />
      </div>
      <div aria-hidden={!visible} inert={!visible}
        className={`flex min-w-0 flex-1 items-center gap-2 px-3 transition-opacity duration-120 ease-out ${visible ? "opacity-100" : "pointer-events-none opacity-0"}`}>
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

    </header>
  );
}
