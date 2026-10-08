"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { NavigationContext } from "./navigation-context";
import type { WorkspaceShellModel } from "@/server/knowledge-read";
import { DocumentTopbarContext, type DocumentTopbarState } from "./document-topbar-context";
import { Topbar } from "@/components/shell/topbar";
import {UserMenu} from "./user-menu";
import { PrimaryNav } from "@/components/shell/primary-nav";
import { WorkspaceSelector } from "@/components/shell/workspace-selector";
import { SearchNavItem } from "@/components/search/search-nav-item";
import { WorkspaceAuthorizationContext, useWorkspaceAuthorizationRefresh } from "./use-workspace-authorization";
import { ArchivedWorkspaceBanner } from "@/components/workspaces/archived-workspace-banner";
import { Drawer } from "@/components/ui/drawer";
import { isBoolean, readStored, removeStored, usePersistedJson } from "@/components/shell/use-persisted-state";
import { ToastProvider } from "@/components/ui/toast";
import { Tooltip, TooltipProvider } from "@/components/ui/tooltip";
import { buttonClasses } from "@/components/ui/button";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { NAV_TOGGLE_SHORTCUT } from "@/components/actions/action-registry";
import { matchesShortcut } from "@/lib/shortcut-keys";
import { TOGGLE_NAV_EVENT } from "./nav-toggle";

export function AppShell({ model, children }: { model: WorkspaceShellModel; children: ReactNode }) {
  const [mobileExplorerTarget, setMobileExplorerTarget] = useState<HTMLElement | null>(null);
  const authorization = useWorkspaceAuthorizationRefresh(model.access, model.navigation);
  const [documentTopbar, setDocumentTopbar] = useState<DocumentTopbarState | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const [navCollapsed, setNavCollapsed] = usePersistedJson("kh:nav-collapsed", false, isBoolean);
  const [accessNotice, setAccessNotice] = useState(false);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("notice") === "access-changed" || readStored("session", "kh:workspace-access-notice") === "1") {
      setAccessNotice(true);
      removeStored("session", "kh:workspace-access-notice");
      url.searchParams.delete("notice");
      window.history.replaceState(null, "", url.pathname + url.search);
    }
  }, []);

  useEffect(() => {
    const close = () => setNavOpen(false);
    window.addEventListener("kh:open-browse", close);
    window.addEventListener("kh:open-inspector", close);
    return () => {
      window.removeEventListener("kh:open-browse", close);
      window.removeEventListener("kh:open-inspector", close);
    };
  }, []);

  const openNav = useCallback(() => {
    setNavOpen(true);
    window.dispatchEvent(new CustomEvent("kh:open-nav"));
  }, []);

  const toggleNav = useCallback(() => {
    setNavCollapsed((collapsed) => !collapsed);
  }, [setNavCollapsed]);

  // ⌘\ and the palette's "Toggle navigation". Where the rail is on screen it collapses or expands; where it
  // is not (a narrow window, whose navigation is the menu) that is what it opens, or closes.
  const toggleNavigation = useCallback(() => {
    if (window.matchMedia("(min-width: 1024px)").matches) toggleNav();
    else if (navOpen) setNavOpen(false);
    else openNav();
  }, [navOpen, openNav, toggleNav]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !matchesShortcut(event, NAV_TOGGLE_SHORTCUT)) return;
      // A dialog or menu that is open owns its keys; the palette is one, and toggling the page behind it is not what was asked.
      if (event.target instanceof HTMLElement && event.target.closest('[role="dialog"], [role="menu"]')) return;
      // No field types ⌘\, so it acts in the composer's title and editor too — where the writer most wants the room.
      event.preventDefault();
      toggleNavigation();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener(TOGGLE_NAV_EVENT, toggleNavigation);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener(TOGGLE_NAV_EVENT, toggleNavigation);
    };
  }, [toggleNavigation]);

  return (
    <WorkspaceAuthorizationContext.Provider value={authorization}>
    <DocumentTopbarContext.Provider value={{ document: documentTopbar, setDocument: setDocumentTopbar }}>
    <NavigationContext.Provider value={{ mobileExplorerTarget, closeNavigation: () => setNavOpen(false) }}>
    <ToastProvider>
    <TooltipProvider delay={500} closeDelay={0}>
    <div className="flex h-screen overflow-hidden flex-col bg-kh-bg-subtle text-kh-text supports-[height:100dvh]:h-dvh">
      <Topbar model={model} onMenuClick={openNav} />
      {accessNotice && <p role="status" className="border-b border-kh-border bg-kh-bg p-3 text-body">You no longer have access to this workspace.<button aria-label="Dismiss access notice" className="ml-3 underline" onClick={() => setAccessNotice(false)}>Dismiss</button></p>}
      {!authorization.confirmed && !authorization.revoked && <p role="alert" className="bg-kh-bg p-3 text-body text-kh-danger">Unable to confirm workspace access. Changes are paused. <button className="underline" onClick={() => void authorization.refresh()}>Retry</button></p>}
      {authorization.access.workspace.lifecycleState === "ARCHIVED" && <ArchivedWorkspaceBanner workspaceId={model.workspace.id} canRestore={authorization.confirmed && authorization.access.actions.canRestore} />}
      <div className="flex min-h-0 flex-1">
        <aside className={`hidden shrink-0 border-r border-kh-border bg-kh-bg-sunken lg:flex lg:flex-col ${navCollapsed ? "w-12" : "w-40"}`}>
          {/* The wordmark and the rail's own collapse control head it; there is no wide-screen topbar. */}
          <div className={`flex h-12 shrink-0 items-center gap-2 ${navCollapsed ? "justify-center px-2" : "px-4 pr-2"}`}>
            {navCollapsed ? null : <span className="min-w-0 flex-1 truncate whitespace-nowrap text-caption font-semibold text-kh-text">Knowledge Hub</span>}
            <Tooltip label={navCollapsed ? "Expand navigation" : "Collapse navigation"} shortcut={NAV_TOGGLE_SHORTCUT} side={navCollapsed ? "right" : "bottom"}>
              <button type="button" onClick={toggleNav} aria-label={navCollapsed ? "Expand navigation" : "Collapse navigation"} aria-keyshortcuts={NAV_TOGGLE_SHORTCUT} className={buttonClasses({ variant: "ghost", icon: true })}>
                {navCollapsed ? <PanelLeftOpen className="h-4 w-4" aria-hidden="true" /> : <PanelLeftClose className="h-4 w-4" aria-hidden="true" />}
              </button>
            </Tooltip>
          </div>
          <div className="flex shrink-0 flex-col gap-0.5 px-2">
            <WorkspaceSelector workspaceId={model.workspace.id} compact={navCollapsed} />
            <SearchNavItem compact={navCollapsed} />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto"><PrimaryNav workspaceId={model.workspace.id} compact={navCollapsed} /></div>
          <div className="shrink-0 border-t border-kh-border p-2"><UserMenu identityName={model.identityName} workspaceId={model.workspace.id} compact={navCollapsed}/></div>
        </aside>
        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto bg-kh-bg has-[[data-document-pane]]:overflow-hidden">{authorization.revoked ? <p role="status">Workspace access changed. Returning to My Space…</p> : children}</main>
      </div>
      <Drawer side="left" open={navOpen} onOpenChange={setNavOpen} title="Menu">
        <div className="flex h-full min-h-0 flex-col" onClick={(event) => {
          if ((event.target as HTMLElement).closest("a") && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) setNavOpen(false);
        }}>
          <div className="shrink-0 pb-2"><WorkspaceSelector workspaceId={model.workspace.id} /></div>
          <PrimaryNav workspaceId={model.workspace.id} />
          <div ref={setMobileExplorerTarget} className="min-h-0 flex-1 overflow-y-auto" />
          <div className="shrink-0 border-t border-kh-border pt-3"><UserMenu identityName={model.identityName} workspaceId={model.workspace.id}/></div>
        </div>
      </Drawer>
    </div>
    </TooltipProvider>
    </ToastProvider>
    </NavigationContext.Provider>
    </DocumentTopbarContext.Provider>
    </WorkspaceAuthorizationContext.Provider>
  );
}
