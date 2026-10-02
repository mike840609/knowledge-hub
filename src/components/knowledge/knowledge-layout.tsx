"use client";

import { Suspense, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { NavigationContext } from "@/components/shell/navigation-context";
import { usePathname } from "next/navigation";
import type { KnowledgeTreeItem, SourceView } from "@/modules/knowledge/application/knowledge-query-service";
import { SourceSidebar } from "./source-sidebar";
import { FolderNameDialogHost } from "./folder-name-dialog";
import { MoveDialogHost } from "./move-dialog";
import { ShareLinkDialogHost } from "./share-link-dialog";
import { InspectorContext } from "./inspector-context";
import { DocumentSkeleton, TreeSkeleton } from "./knowledge-skeletons";
import { useScrollRestoration } from "./use-scroll-restoration";

export function KnowledgeLayout({
  workspaceId,
  source,
  collections,
  includeArchived,
  children,
}: {
  workspaceId: string;
  source: SourceView;
  collections: { source: SourceView; tree: KnowledgeTreeItem[] }[];
  includeArchived: boolean;
  children: ReactNode;
}) {
  const navigation = useContext(NavigationContext);
  const [explorerTarget, setExplorerTarget] = useState<HTMLElement | null>(null);
  const pathname = usePathname();
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  useScrollRestoration(contentRef, pathname);

  useEffect(() => {
    const close = () => setInspectorOpen(false);
    window.addEventListener("kh:open-nav", close);
    return () => {
      window.removeEventListener("kh:open-nav", close);
    };
  }, []);

  const sidebar = (
    <SourceSidebar
      workspaceId={workspaceId}
      source={source}
      collections={collections}
      includeArchived={includeArchived}
    />
  );

  return (
    <InspectorContext.Provider value={{ open: inspectorOpen, setOpen: setInspectorOpen }}>
    <div className="flex h-full min-h-0 overflow-hidden">
      <div ref={setExplorerTarget} className="hidden h-full w-72 shrink-0 lg:block">
        {!explorerTarget ? <div className="h-full border-r border-kh-border bg-kh-bg-sunken p-3"><TreeSkeleton /></div> : null}
      </div>
      {/* One explorer instance: avoid duplicate filter IDs and competing persisted state. */}
      {navigation?.mobileExplorerTarget ? createPortal(<div className="h-full" onClick={(event) => {
        if ((event.target as HTMLElement).closest("a") && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) navigation.closeNavigation();
      }}>{sidebar}</div>, navigation.mobileExplorerTarget) : explorerTarget ? createPortal(sidebar, explorerTarget) : null}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div ref={contentRef} className="min-h-0 flex-1 overflow-hidden overscroll-contain [&:not(:has([data-document-pane]))]:overflow-y-auto">
          <Suspense fallback={<DocumentSkeleton />}>{children}</Suspense>
        </div>
      </div>
      <ShareLinkDialogHost />
      <FolderNameDialogHost />
      <MoveDialogHost collections={collections} />
    </div>
    </InspectorContext.Provider>
  );
}
