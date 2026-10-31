"use client";

import { Menu } from "lucide-react";
import type { WorkspaceShellModel } from "@/server/knowledge-read";
import { QuickSearch } from "@/components/search/quick-search";
import { buttonClasses } from "@/components/ui/button";
import { DocumentContextBar } from "./document-context-bar";

/**
 * A narrow window's header: the Menu, Search, and the document's title and actions. A wide window has no
 * topbar — the rail carries the wordmark, switcher and Search, and the document pane its own title and
 * actions — but the palette stays mounted here, once, at every width.
 */
export function Topbar({ model, onMenuClick }: { model: WorkspaceShellModel; onMenuClick?: () => void }) {
  return (
    <header className="flex h-12 shrink-0 items-center border-b border-kh-border bg-kh-bg-raised lg:hidden">
      <div className="flex shrink-0 items-center gap-2 px-3">
        {onMenuClick ? <button type="button" aria-label="Open menu" onClick={onMenuClick} className={buttonClasses({ variant: "ghost", icon: true })}><Menu className="h-4 w-4" aria-hidden="true" /></button> : null}
        <span className="hidden whitespace-nowrap text-caption font-semibold text-kh-text sm:block">Knowledge Hub</span>
      </div>
      <QuickSearch workspaceId={model.workspace.id} />
      <DocumentContextBar workspaceId={model.workspace.id} className="flex-1 px-3" />
    </header>
  );
}
