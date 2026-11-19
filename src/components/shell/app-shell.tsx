"use client";

import { useCallback, useEffect, useId, useRef, useState, type MouseEvent, type ReactNode, type Ref } from "react";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { Menu, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import type { SourceView } from "@/modules/knowledge/application/knowledge-query-service";
import type { WorkspaceShellModel } from "@/server/knowledge-read";
import { NAV_TOGGLE_SHORTCUT } from "@/components/actions/action-registry";
import { PeekHost } from "@/components/knowledge/peek-host";
import { PEEK_REQUEST_EVENT } from "@/components/knowledge/peek-request";
import { plainClick } from "@/components/knowledge/typing-ahead";
import { useIsWide } from "@/components/knowledge/use-is-wide";
import { WorkspaceKnowledgeNavigation } from "@/components/knowledge/workspace-knowledge-navigation";
import { SearchNavItem } from "@/components/search/search-nav-item";
import { buttonClasses } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { ToastProvider } from "@/components/ui/toast";
import { Tooltip, TooltipProvider } from "@/components/ui/tooltip";
import { ArchivedWorkspaceBanner } from "@/components/workspaces/archived-workspace-banner";
import { matchesShortcut } from "@/lib/shortcut-keys";
import { DocumentTopbarContext, type DocumentTopbarState } from "./document-topbar-context";
import { TOGGLE_NAV_EVENT } from "./nav-toggle";
import { InboxHeaderLink, PrimaryNav } from "./primary-nav";
import { Topbar } from "./topbar";
import { useInboxUnread } from "./use-inbox-unread";
import { UserMenu } from "./user-menu";
import { isBoolean, readStored, removeStored, usePersistedJson } from "./use-persisted-state";
import { WorkspaceAuthorizationContext, useWorkspaceAuthorizationRefresh } from "./use-workspace-authorization";
import { WorkspaceSelector } from "./workspace-selector";

function WorkspaceSidebarContent({
  model,
  knowledgeSlot,
  compact = false,
  inboxUnread,
  inboxRef,
  id,
}: {
  model: WorkspaceShellModel;
  knowledgeSlot: Ref<HTMLDivElement>;
  compact?: boolean;
  inboxUnread?: number;
  inboxRef?: Ref<HTMLAnchorElement>;
  id?: string;
}) {
  const workspaceId = model.workspace.id;
  return (
    <>
      <div id={id} className="flex min-h-0 flex-1 flex-col">
        {/* Keep room for the tree's own scroll pane even on short displays. */}
        <div className={`min-h-0 overflow-y-auto overscroll-contain ${compact ? "flex-1" : "max-h-[60%] shrink-0"}`}>
          <div className="flex flex-col gap-0.5 px-2">
            <WorkspaceSelector workspaceId={workspaceId} compact={compact} />
            <SearchNavItem compact={compact} />
          </div>
          <PrimaryNav workspaceId={workspaceId} compact={compact} inboxUnread={inboxUnread} inboxRef={inboxRef} />
        </div>
        <div ref={knowledgeSlot} hidden={compact} className="min-h-0 flex-1" />
      </div>
      <div className="shrink-0 border-t border-kh-border p-2">
        <UserMenu
          identityName={model.identityName}
          identityEmpId={model.identityEmpId}
          workspaceId={workspaceId}
          compact={compact}
          insightsHref={!compact && model.workspace.type === "PERSONAL" ? `/w/${workspaceId}/profile` : undefined}
        />
      </div>
    </>
  );
}

// Inbox can fit its 1200px split beside a 17rem sidebar from 1472px.
const INBOX_INLINE_NAV_MIN_WIDTH = 1472;

export function AppShell({
  model,
  sources,
  children,
}: {
  model: WorkspaceShellModel;
  sources: SourceView[] | null;
  children: ReactNode;
}) {
  const workspaceId = model.workspace.id;
  const pathname = usePathname();
  const authorization = useWorkspaceAuthorizationRefresh(model.access, model.navigation);
  const personal = model.workspace.type === "PERSONAL";
  const unread = useInboxUnread(personal);
  const inboxUnread = personal ? unread : undefined;
  const [documentTopbar, setDocumentTopbar] = useState<DocumentTopbarState | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const [navCollapsed, setNavCollapsed] = usePersistedJson("kh:nav-collapsed", false, isBoolean);
  const [accessNotice, setAccessNotice] = useState(false);
  const [desktopKnowledgeSlot, setDesktopKnowledgeSlot] = useState<HTMLDivElement | null>(null);
  const [drawerKnowledgeSlot, setDrawerKnowledgeSlot] = useState<HTMLDivElement | null>(null);
  const desktopNavId = useId();
  const drawerId = useId();
  const desktopTrigger = useRef<HTMLButtonElement>(null);
  const mobileTrigger = useRef<HTMLButtonElement>(null);
  const navOpener = useRef<HTMLElement | null>(null);
  const restoreNavFocus = useRef(true);
  const restoreInboxFocus = useRef(false);
  const desktop = useIsWide();
  const inboxHasSidebarRoom = useIsWide(INBOX_INLINE_NAV_MIN_WIDTH);
  const inboxHref = `/w/${workspaceId}/inbox`;
  const isInbox = pathname === inboxHref;
  const inboxCompact = isInbox && !inboxHasSidebarRoom;
  const compact = navCollapsed || inboxCompact;
  const sidebarWidth = navCollapsed ? "w-12" : isInbox ? "w-12 min-[1472px]:w-[17rem]" : "w-[17rem]";
  const usesDrawer = !desktop || inboxCompact;
  const drawerOpen = usesDrawer && navOpen && !authorization.revoked;

  // Entering Inbox or resizing can replace its focused desktop link in place.
  const desktopInboxRef = useCallback((link: HTMLAnchorElement | null) => {
    if (!link) return;
    const doc = link.ownerDocument;
    if (restoreInboxFocus.current && doc.activeElement === doc.body) link.focus({ preventScroll: true });
    restoreInboxFocus.current = false;
    return () => { restoreInboxFocus.current = doc.activeElement === link; };
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("notice") === "access-changed" || readStored("session", "kh:workspace-access-notice") === "1") {
      setAccessNotice(true);
      removeStored("session", "kh:workspace-access-notice");
      url.searchParams.delete("notice");
      window.history.replaceState(null, "", url.pathname + url.search);
    }
  }, []);

  const closeForHandoff = useCallback(() => {
    restoreNavFocus.current = false;
    setNavOpen(false);
  }, []);

  useEffect(() => {
    window.addEventListener("kh:open-inspector", closeForHandoff);
    window.addEventListener(PEEK_REQUEST_EVENT, closeForHandoff);
    return () => {
      window.removeEventListener("kh:open-inspector", closeForHandoff);
      window.removeEventListener(PEEK_REQUEST_EVENT, closeForHandoff);
    };
  }, [closeForHandoff]);

  useEffect(() => {
    if (!usesDrawer) setNavOpen(false);
  }, [usesDrawer]);

  useEffect(() => {
    closeForHandoff();
  }, [pathname, closeForHandoff]);

  const openNav = useCallback((opener?: HTMLElement) => {
    const active = document.activeElement;
    navOpener.current = opener ?? (active instanceof HTMLElement ? active : null);
    restoreNavFocus.current = true;
    setNavOpen(true);
    window.dispatchEvent(new CustomEvent("kh:open-nav"));
  }, []);

  const drawerOpener = useCallback(() => {
    const opener = navOpener.current;
    if (opener && opener !== document.body && opener.getClientRects().length) return opener;
    return (desktop ? desktopTrigger : mobileTrigger).current;
  }, [desktop]);

  const onSearchOpen = useCallback(() => {
    if (!drawerOpen) return null;
    closeForHandoff();
    return drawerOpener();
  }, [closeForHandoff, drawerOpen, drawerOpener]);

  // React click events also reach this handler from links in portaled menus.
  const closeDrawerForLink = useCallback((event: MouseEvent) => {
    if (!drawerOpen || !plainClick(event) || !(event.target instanceof Element)) return;
    const link = event.target.closest<HTMLAnchorElement>("a[href]:not([download])");
    if (!link || (link.target && link.target.toLowerCase() !== "_self")) return;
    const current = window.location;
    const samePage = link.origin === current.origin && link.pathname === current.pathname && (!link.hash || link.hash === current.hash);
    if (samePage) setNavOpen(false);
    else closeForHandoff();
  }, [drawerOpen, closeForHandoff]);

  const toggleNav = useCallback(() => {
    const active = document.activeElement;
    const trigger = desktopTrigger.current;
    const inboxFocused = active instanceof HTMLAnchorElement && active.pathname === inboxHref
      && active.closest("aside") === trigger?.closest("aside");
    const compactDestinationFocused = navCollapsed && active instanceof HTMLElement
      && active.hasAttribute("data-compact-destination") && active.closest("aside") === trigger?.closest("aside");
    if (inboxFocused || compactDestinationFocused || (!navCollapsed && desktopKnowledgeSlot?.contains(active))) {
      trigger?.focus();
    }
    setNavCollapsed((collapsed) => !collapsed);
  }, [desktopKnowledgeSlot, inboxHref, navCollapsed, setNavCollapsed]);

  const toggleNavigation = useCallback(() => {
    if (!usesDrawer) toggleNav();
    else if (drawerOpen) setNavOpen(false);
    else openNav();
  }, [drawerOpen, openNav, toggleNav, usesDrawer]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !matchesShortcut(event, NAV_TOGGLE_SHORTCUT)) return;
      const dialogOrMenu = event.target instanceof Element && event.target.closest('[role="dialog"], [role="menu"]');
      if (dialogOrMenu && dialogOrMenu.id !== drawerId) return;
      event.preventDefault();
      toggleNavigation();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener(TOGGLE_NAV_EVENT, toggleNavigation);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener(TOGGLE_NAV_EVENT, toggleNavigation);
    };
  }, [drawerId, toggleNavigation]);

  const desktopToggleLabel = compact ? "Expand navigation" : "Collapse navigation";
  const content = (
    <main id="kh-workspace-main" tabIndex={-1} className="relative min-h-0 min-w-0 flex-1 overflow-y-auto bg-kh-bg outline-none has-[[data-document-pane]]:overflow-hidden">
      {authorization.revoked ? <p role="status">Workspace access changed. Returning to My Space…</p> : children}
    </main>
  );

  return (
    <WorkspaceAuthorizationContext.Provider value={authorization}>
      <DocumentTopbarContext.Provider value={{ document: documentTopbar, setDocument: setDocumentTopbar }}>
        <ToastProvider>
          <TooltipProvider delay={500} closeDelay={0}>
            <div className="flex h-screen flex-col overflow-hidden bg-kh-bg-subtle text-kh-text supports-[height:100dvh]:h-dvh">
              <a href="#kh-workspace-main" className="kh-skip-link">Skip to content</a>
              <Topbar
                model={model}
                onSearchOpen={onSearchOpen}
                menuTrigger={(
                  <button
                    ref={mobileTrigger}
                    type="button"
                    aria-label="Open menu"
                    aria-haspopup="dialog"
                    aria-expanded={drawerOpen}
                    aria-controls={drawerOpen ? drawerId : undefined}
                    onClick={(event) => openNav(event.currentTarget)}
                    className={buttonClasses({ variant: "ghost", icon: true })}
                  >
                    <Menu className="h-4 w-4" aria-hidden="true" />
                  </button>
                )}
              />
              {accessNotice && <p role="status" className="border-b border-kh-border bg-kh-bg p-3 text-body">You no longer have access to this workspace.<button aria-label="Dismiss access notice" className="ml-3 underline" onClick={() => setAccessNotice(false)}>Dismiss</button></p>}
              {!authorization.confirmed && !authorization.revoked && <p role="alert" className="bg-kh-bg p-3 text-body text-kh-danger">Unable to confirm workspace access. Changes are paused. <button className="underline" onClick={() => void authorization.refresh()}>Retry</button></p>}
              {authorization.access.workspace.lifecycleState === "ARCHIVED" && <ArchivedWorkspaceBanner workspaceId={workspaceId} canRestore={authorization.confirmed && authorization.access.actions.canRestore} />}
              <div className="flex min-h-0 flex-1">
                <aside aria-label="Workspace navigation" className={`hidden shrink-0 border-r border-kh-border bg-kh-bg-sunken lg:flex lg:flex-col ${sidebarWidth}`}>
                  <div className={`flex h-12 shrink-0 items-center gap-1 px-2 ${compact ? "justify-center" : ""}`}>
                    {!compact && (
                      <>
                        <Image src="/icon.svg" width={20} height={20} alt="" className="shrink-0" />
                        <span className="min-w-0 flex-1 truncate text-caption font-semibold text-kh-text">Knowledge Hub</span>
                        {inboxUnread !== undefined && <InboxHeaderLink ref={desktopInboxRef} workspaceId={workspaceId} unread={inboxUnread} />}
                      </>
                    )}
                    <Tooltip label={desktopToggleLabel} shortcut={NAV_TOGGLE_SHORTCUT} side={compact ? "right" : "bottom"}>
                      <button
                        ref={desktopTrigger}
                        type="button"
                        onClick={(event) => inboxCompact ? openNav(event.currentTarget) : toggleNav()}
                        aria-label={desktopToggleLabel}
                        aria-keyshortcuts={NAV_TOGGLE_SHORTCUT}
                        aria-haspopup={inboxCompact ? "dialog" : undefined}
                        aria-expanded={inboxCompact ? drawerOpen : !compact}
                        aria-controls={inboxCompact ? (drawerOpen ? drawerId : undefined) : desktopNavId}
                        className={buttonClasses({ variant: "ghost", icon: true, size: compact ? "md" : "sm" })}
                      >
                        {compact ? <PanelLeftOpen className="h-4 w-4" aria-hidden="true" /> : <PanelLeftClose className="h-4 w-4" aria-hidden="true" />}
                      </button>
                    </Tooltip>
                  </div>
                  <WorkspaceSidebarContent model={model} knowledgeSlot={setDesktopKnowledgeSlot} compact={compact} inboxUnread={compact ? inboxUnread : undefined} inboxRef={desktopInboxRef} id={desktopNavId} />
                </aside>
                {authorization.revoked ? content : <PeekHost>{content}</PeekHost>}
              </div>
              <Drawer
                id={drawerId}
                side="left"
                open={drawerOpen}
                onOpenChange={setNavOpen}
                title="Menu"
                surfaceClassName="!w-[17rem] bg-kh-bg-sunken"
                contentClassName="flex flex-col"
                finalFocus={() => restoreNavFocus.current && drawerOpener()}
              >
                <div onClick={closeDrawerForLink} className="flex min-h-0 flex-1 flex-col pt-2">
                  <WorkspaceSidebarContent model={model} knowledgeSlot={setDrawerKnowledgeSlot} inboxUnread={inboxUnread} />
                </div>
              </Drawer>
              {!authorization.revoked && (
                <WorkspaceKnowledgeNavigation
                  workspaceId={workspaceId}
                  sources={sources}
                  target={drawerOpen && drawerKnowledgeSlot ? drawerKnowledgeSlot : desktopKnowledgeSlot}
                  onClick={closeDrawerForLink}
                />
              )}
            </div>
          </TooltipProvider>
        </ToastProvider>
      </DocumentTopbarContext.Provider>
    </WorkspaceAuthorizationContext.Provider>
  );
}
