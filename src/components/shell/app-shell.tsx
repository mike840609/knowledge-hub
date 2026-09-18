"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { WorkspaceShellModel } from "@/server/knowledge-read";
import { DocumentTopbarContext, type DocumentTopbarState } from "./document-topbar-context";
import { Topbar } from "@/components/shell/topbar";
import { PrimaryNav } from "@/components/shell/primary-nav";
import { WorkspaceAuthorizationContext, useWorkspaceAuthorizationRefresh } from "./use-workspace-authorization";
import { ArchivedWorkspaceBanner } from "@/components/workspaces/archived-workspace-banner";
import { Drawer } from "@/components/ui/drawer";

export function AppShell({ model, children }: { model: WorkspaceShellModel; children: ReactNode }) {
  const authorization = useWorkspaceAuthorizationRefresh(model.access, model.navigation);
  const [documentTopbar, setDocumentTopbar] = useState<DocumentTopbarState | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [accessNotice, setAccessNotice] = useState(false);
  useEffect(() => {
    setNavCollapsed(window.localStorage.getItem("kh:nav-collapsed") === "1");
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("notice") === "access-changed" || window.sessionStorage.getItem("kh:workspace-access-notice") === "1") {
      setAccessNotice(true);
      window.sessionStorage.removeItem("kh:workspace-access-notice");
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
    setNavCollapsed((collapsed) => {
      window.localStorage.setItem("kh:nav-collapsed", collapsed ? "0" : "1");
      return !collapsed;
    });
  }, []);

  return (
    <WorkspaceAuthorizationContext.Provider value={authorization}>
    <DocumentTopbarContext.Provider value={{ document: documentTopbar, setDocument: setDocumentTopbar }}>
    <div className="flex h-screen overflow-hidden flex-col bg-kh-bg-subtle text-kh-text supports-[height:100dvh]:h-dvh">
      <Topbar model={model} onMenuClick={openNav} navCollapsed={navCollapsed} onToggleNav={toggleNav} />
      {accessNotice && <p role="status" className="border-b border-kh-border bg-kh-bg p-3 text-sm">You no longer have access to this workspace.<button aria-label="Dismiss access notice" className="ml-3 underline" onClick={() => setAccessNotice(false)}>Dismiss</button></p>}
      {!authorization.confirmed && !authorization.revoked && <p role="alert" className="bg-kh-bg p-3 text-sm text-kh-danger">Unable to confirm workspace access. Changes are paused. <button className="underline" onClick={() => void authorization.refresh()}>Retry</button></p>}
      {authorization.access.workspace.lifecycleState === "ARCHIVED" && <ArchivedWorkspaceBanner workspaceId={model.workspace.id} canRestore={authorization.confirmed && authorization.access.actions.canRestore} />}
      <div className="flex min-h-0 flex-1">
        <aside className={`hidden shrink-0 border-r border-kh-border bg-kh-bg lg:block ${navCollapsed ? "w-12" : "w-40"}`}>
          <PrimaryNav workspaceId={model.workspace.id} compact={navCollapsed} />
        </aside>
        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto has-[[data-document-pane]]:overflow-hidden">{authorization.revoked ? <p role="status">Workspace access changed. Returning to My Space…</p> : children}</main>
      </div>
      <Drawer open={navOpen} onOpenChange={setNavOpen} title="Menu">
        <PrimaryNav workspaceId={model.workspace.id} onNavigate={() => setNavOpen(false)} />
      </Drawer>
    </div>
    </DocumentTopbarContext.Provider>
    </WorkspaceAuthorizationContext.Provider>
  );
}
