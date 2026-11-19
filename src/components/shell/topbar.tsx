"use client";

import Image from "next/image";
import type { ReactNode } from "react";
import type { WorkspaceShellModel } from "@/server/knowledge-read";
import { QuickSearch } from "@/components/search/quick-search";
import { DocumentContextBar } from "./document-context-bar";

/**
 * A narrow window's header: the Menu, Search, and the document's title and actions. A wide window has no
 * topbar — the rail carries the wordmark, switcher and Search, and the document pane its own title and
 * actions — but the palette stays mounted here, once, at every width.
 */
export function Topbar({
  model,
  menuTrigger,
  onSearchOpen,
}: {
  model: WorkspaceShellModel;
  menuTrigger: ReactNode;
  onSearchOpen: () => HTMLElement | null;
}) {
  return (
    <header className="flex h-12 shrink-0 items-center border-b border-kh-border bg-kh-bg-raised lg:hidden">
      <div className="flex shrink-0 items-center gap-2 px-3">
        {menuTrigger}
        <div className="hidden items-center gap-1 sm:flex">
          <Image src="/icon.svg" width={20} height={20} alt="" className="shrink-0" />
          <span className="whitespace-nowrap text-caption font-semibold text-kh-text">Knowledge Hub</span>
        </div>
      </div>
      <QuickSearch workspaceId={model.workspace.id} onOpen={onSearchOpen} />
      <DocumentContextBar workspaceId={model.workspace.id} className="flex-1 px-3" />
    </header>
  );
}
