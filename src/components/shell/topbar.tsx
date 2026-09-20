"use client";

import { useContext } from "react";
import { usePathname } from "next/navigation";
import { DocumentTopbarContext } from "./document-topbar-context";
import { Menu, PanelLeftClose, PanelLeftOpen, PanelRight } from "lucide-react";
import type { WorkspaceShellModel } from "@/server/knowledge-read";
import { WorkspaceSelector } from "@/components/shell/workspace-selector";
import { QuickSearch } from "@/components/search/quick-search";

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
  return (
    <header className="flex h-12 shrink-0 items-center border-b border-kh-border/60 bg-kh-bg-raised">
      <div className={`flex shrink-0 items-center gap-2 px-3 lg:h-full lg:border-r lg:border-kh-border lg:bg-kh-bg-sunken ${navCollapsed ? "lg:w-12 lg:px-2" : "lg:w-40"}`}>
        {onMenuClick ? (
          <button
            type="button"
            aria-label="Open menu"
            onClick={onMenuClick}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-kh-text-muted hover:bg-kh-bg-hover hover:text-kh-text focus:outline-none focus-visible:ring-2 focus-visible:ring-kh-focus lg:hidden"
          >
            <Menu className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : null}
        <button type="button" onClick={onToggleNav} aria-label={navCollapsed ? "Expand navigation" : "Collapse navigation"} title={navCollapsed ? "Expand navigation" : "Collapse navigation"} className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-md text-kh-text-muted hover:bg-kh-bg-hover hover:text-kh-text focus-visible:ring-2 focus-visible:ring-kh-focus lg:inline-flex">
          {navCollapsed ? <PanelLeftOpen className="h-4 w-4" aria-hidden="true" /> : <PanelLeftClose className="h-4 w-4" aria-hidden="true" />}
        </button>
        <span className={`hidden whitespace-nowrap text-caption font-semibold text-kh-text sm:block ${navCollapsed ? "lg:hidden" : ""}`}>Knowledge Hub</span>
      </div>
      <div className="flex h-full w-28 min-w-0 shrink-0 items-center pr-2 sm:w-64 sm:px-3 lg:w-72">
        <WorkspaceSelector workspaceId={model.workspace.id} />
      </div>
      <QuickSearch workspaceId={model.workspace.id} />
      <div aria-hidden={!visible} inert={!visible}
        className={`flex min-w-0 flex-1 items-center gap-2 px-3 transition-opacity duration-150 motion-reduce:transition-none ${visible ? "opacity-100" : "pointer-events-none opacity-0"}`}>
        <span className="min-w-0 flex-1 truncate text-body font-semibold text-kh-text" title={active ? state.title : undefined}>
          {active ? state.title : ""}
        </span>
        <button type="button" aria-label="Document details" aria-keyshortcuts="Meta+I Control+I" title="Details (⌘/Ctrl I)" onClick={active ? state.onDetailsClick : undefined}
          className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md px-2 text-body text-kh-text-muted hover:bg-kh-bg-hover hover:text-kh-text focus-visible:ring-2 focus-visible:ring-kh-focus sm:px-3">
          <PanelRight className="h-4 w-4" aria-hidden="true" />
          <span className="hidden sm:inline">Details</span>
        </button>
      </div>
      <span className="ml-auto hidden min-w-0 truncate px-3 text-body text-kh-text-muted sm:block">{model.identityName}</span>
    </header>
  );
}
