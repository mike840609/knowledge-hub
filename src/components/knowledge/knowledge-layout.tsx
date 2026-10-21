"use client";

import { Suspense, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { NavigationContext } from "@/components/shell/navigation-context";
import { usePathname } from "next/navigation";
import type { KnowledgeTreeItem, SourceView } from "@/modules/knowledge/application/knowledge-query-service";
import { SourceSidebar } from "./source-sidebar";
import { FolderNameDialogHost } from "./folder-name-dialog";
import { MoveDialogHost } from "./move-dialog";
import { PeekDialog } from "./peek-dialog";
import { PeekPane } from "./peek-pane";
import { PEEK_REQUEST_EVENT, type PeekRequest } from "./peek-request";
import { useIsWide } from "./use-is-wide";
import { ShareLinkDialogHost } from "./share-link-dialog";
import { InspectorContext } from "./inspector-context";
import { DocumentSkeleton, TreeSkeleton } from "./knowledge-skeletons";
import { useScrollRestoration } from "./use-scroll-restoration";
import { PanelLeftOpen } from "lucide-react";
import { buttonClasses } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { isBoolean, usePersistedJson } from "@/components/shell/use-persisted-state";

export function KnowledgeLayout({
  workspaceId,
  source,
  collections,
  includeArchived,
  children,
}: {
  workspaceId: string;
  source: SourceView | null;
  collections: { source: SourceView; tree: KnowledgeTreeItem[] }[];
  includeArchived: boolean;
  children: ReactNode;
}) {
  const navigation = useContext(NavigationContext);
  const [explorerTarget, setExplorerTarget] = useState<HTMLElement | null>(null);
  const pathname = usePathname();
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [peekRequest, setPeekRequest] = useState<PeekRequest | null>(null);
  const isWide = useIsWide();
  const contentRef = useRef<HTMLDivElement>(null);
  const [explorerCollapsed, setExplorerCollapsed] = usePersistedJson("kh:explorer-collapsed", false, isBoolean);
  const showExplorerRef = useRef<HTMLButtonElement>(null);
  // The button pressed is gone once the explorer changes; focus goes to the one that took its place.
  const toggleExplorer = (collapse: boolean) => {
    setExplorerCollapsed(collapse);
    requestAnimationFrame(() => (collapse ? showExplorerRef.current : explorerTarget?.querySelector<HTMLButtonElement>("[data-explorer-collapse]"))?.focus());
  };

  useScrollRestoration(contentRef, pathname);

  useEffect(() => {
    const close = () => setInspectorOpen(false);
    window.addEventListener("kh:open-nav", close);
    return () => {
      window.removeEventListener("kh:open-nav", close);
    };
  }, []);

  useEffect(() => {
    const open = (event: Event) => {
      const detail = (event as CustomEvent<Partial<PeekRequest>>).detail;
      if (typeof detail?.documentId === "string" && typeof detail?.sourceId === "string") {
        setPeekRequest({ documentId: detail.documentId, sourceId: detail.sourceId });
      }
    };
    window.addEventListener(PEEK_REQUEST_EVENT, open);
    return () => window.removeEventListener(PEEK_REQUEST_EVENT, open);
  }, []);

  const closePeek = () => setPeekRequest(null);

  const sidebar = (
    <SourceSidebar
      workspaceId={workspaceId}
      source={source}
      collections={collections}
      includeArchived={includeArchived}
      onCollapse={navigation?.mobileExplorerTarget ? undefined : () => toggleExplorer(true)}
    />
  );

  return (
    <InspectorContext.Provider value={{ open: inspectorOpen, setOpen: setInspectorOpen }}>
    <div className="flex h-full min-h-0 overflow-hidden">
      <div className={`hidden h-full shrink-0 lg:block ${explorerCollapsed ? "w-10" : "w-72"}`}>
        {explorerCollapsed ? (
          <div className="flex h-full justify-center border-r border-kh-border bg-kh-bg-explorer pt-2">
            <Tooltip label="Show documents" side="right">
              <button ref={showExplorerRef} type="button" aria-label="Show documents" onClick={() => toggleExplorer(false)} className={buttonClasses({ variant: "ghost", icon: true })}>
                <PanelLeftOpen className="h-4 w-4" aria-hidden="true" />
              </button>
            </Tooltip>
          </div>
        ) : null}
        {/* Hidden, not unmounted: open folders and the filter are as they were when it is shown again. */}
        <div ref={setExplorerTarget} className={explorerCollapsed ? "hidden" : "h-full"}>
          {!explorerTarget ? <div className="h-full border-r border-kh-border bg-kh-bg-explorer p-3"><TreeSkeleton /></div> : null}
        </div>
      </div>
      {/* One explorer instance: avoid duplicate filter IDs and competing persisted state. */}
      {navigation?.mobileExplorerTarget ? createPortal(<div className="h-full" onClick={(event) => {
        if ((event.target as HTMLElement).closest("a") && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) navigation.closeNavigation();
      }}>{sidebar}</div>, navigation.mobileExplorerTarget) : explorerTarget ? createPortal(sidebar, explorerTarget) : null}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex min-h-0 min-w-0 flex-1">
          <div ref={contentRef} className="min-h-0 min-w-0 flex-1 overflow-hidden overscroll-contain [&:not(:has([data-document-pane]))]:overflow-y-auto">
            <Suspense fallback={<DocumentSkeleton />}>{children}</Suspense>
          </div>
          {peekRequest && isWide ? (
            <div data-testid="side-peek" className="min-h-0 min-w-0 flex-1 border-l border-kh-border">
              <PeekPane request={peekRequest} onClose={closePeek} />
            </div>
          ) : null}
        </div>
      </div>
      <ShareLinkDialogHost />
      <FolderNameDialogHost />
      <MoveDialogHost collections={collections} />
      {peekRequest && !isWide ? (
        <PeekDialog
          request={peekRequest}
          onOpenChange={(next) => {
            if (!next) closePeek();
          }}
        />
      ) : null}
    </div>
    </InspectorContext.Provider>
  );
}
