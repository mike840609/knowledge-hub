"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { WorkspaceShellModel } from "@/server/knowledge-read";
import { Topbar } from "@/components/shell/topbar";
import { PrimaryNav } from "@/components/shell/primary-nav";
import { Drawer } from "@/components/ui/drawer";

export function AppShell({ model, children }: { model: WorkspaceShellModel; children: ReactNode }) {
  const [navOpen, setNavOpen] = useState(false);

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

  return (
    <div className="flex h-screen flex-col bg-kh-bg-subtle text-kh-text">
      <Topbar model={model} onMenuClick={openNav} />
      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-40 shrink-0 border-r border-kh-border bg-kh-bg lg:block">
          <PrimaryNav workspaceId={model.workspace.id} />
        </aside>
        <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
      </div>
      <Drawer open={navOpen} onOpenChange={setNavOpen} title="Menu">
        <PrimaryNav workspaceId={model.workspace.id} onNavigate={() => setNavOpen(false)} />
      </Drawer>
    </div>
  );
}
