"use client";

import { useParams, useRouter } from "next/navigation";
import { PanelLeftClose } from "lucide-react";
import type { WorkspaceExplorerModel, WorkspaceShellModel } from "@/server/knowledge-read";
import { NAV_TOGGLE_SHORTCUT } from "@/components/actions/action-registry";
import { SourceSidebar } from "@/components/knowledge/source-sidebar";
import { SearchNavItem } from "@/components/search/search-nav-item";
import { buttonClasses } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { PrimaryNav } from "./primary-nav";
import { UserMenu } from "./user-menu";
import { WorkspaceSelector } from "./workspace-selector";

/**
 * Navigation and the document tree in one column: a fixed head (workspace, Search, and every destination),
 * one scroll region (Favorites, Recent, Documents) that ends with the tree, and the account row. The tree is
 * the only part whose length varies, so it goes last and moves nothing below it.
 * Rendered once — in the wide frame or in the narrow drawer, never both. `documentsHidden` drops the
 * tree once access to the workspace is revoked: the payload it was drawn from is no longer the reader's to see.
 */
export function Sidebar({ model, explorer, onCollapse, documentsHidden = false }: { model: WorkspaceShellModel; explorer: WorkspaceExplorerModel | null; onCollapse?: () => void; documentsHidden?: boolean }) {
  const params = useParams();
  const currentSourceId = typeof params?.sourceId === "string" ? params.sourceId : undefined;
  const workspaceId = model.workspace.id;
  return (
    <div className="kh-sidebar-surface group/sidebar flex h-full min-h-0 flex-col bg-kh-bg-sunken">
      <div className="flex h-12 shrink-0 items-center gap-1 px-2">
        <div className="min-w-0 flex-1"><WorkspaceSelector workspaceId={workspaceId} /></div>
        {onCollapse ? (
          <Tooltip label="Collapse navigation" shortcut={NAV_TOGGLE_SHORTCUT} side="bottom">
            <button type="button" onClick={onCollapse} aria-label="Collapse navigation" aria-keyshortcuts={NAV_TOGGLE_SHORTCUT} className={buttonClasses({ variant: "ghost", icon: true, className: "opacity-0 focus-visible:opacity-100 group-hover/sidebar:opacity-100 [@media(hover:none)]:opacity-100" })}>
              <PanelLeftClose className="h-4 w-4" aria-hidden="true" />
            </button>
          </Tooltip>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-col gap-0.5 px-2">
        <SearchNavItem />
        <PrimaryNav workspaceId={workspaceId} group="top" />
        <PrimaryNav workspaceId={workspaceId} group="bottom" />
      </div>
      <div data-sidebar-scroll className="mt-2 min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {documentsHidden ? null : explorer ? <SourceSidebar workspaceId={workspaceId} currentSourceId={currentSourceId} collections={explorer.collections} /> : <ExplorerUnavailable />}
      </div>
      <div className="shrink-0 border-t border-kh-border p-2"><UserMenu identityName={model.identityName} workspaceId={workspaceId} /></div>
    </div>
  );
}

function ExplorerUnavailable() {
  const router = useRouter();
  return (
    <p role="status" className="px-4 py-2 text-body text-kh-text-muted">
      Documents could not be loaded.{" "}
      <button type="button" onClick={() => router.refresh()} className="underline kh-focus-ring">Retry</button>
    </p>
  );
}
