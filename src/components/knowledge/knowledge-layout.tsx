"use client";

import { Suspense, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { NavigationContext } from "@/components/shell/navigation-context";
import { usePathname } from "next/navigation";
import type { KnowledgeTreeItem, SourceView } from "@/modules/knowledge/application/knowledge-query-service";
import { useSourceTrees } from "./use-source-trees";
import { SourceSidebar } from "./source-sidebar";
import { FolderNameDialogHost } from "./folder-name-dialog";
import { MoveDialogHost } from "./move-dialog";
import { PeekHost } from "./peek-host";
import { ShareLinkDialogHost } from "./share-link-dialog";
import { PublishDialogHost } from "@/components/publications/publish-request";
import type { PublicationListItem } from "@/modules/sources/application/publication-service";
import { InspectorContext } from "./inspector-context";
import { DocumentSkeleton, TreeSkeleton } from "./knowledge-skeletons";
import { useScrollRestoration } from "./use-scroll-restoration";
import { FolderTree } from "lucide-react";
import { buttonClasses } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { Tooltip } from "@/components/ui/tooltip";
import { isBoolean, usePersistedJson } from "@/components/shell/use-persisted-state";
import { useIsWide } from "./use-is-wide";

export function KnowledgeLayout({
  workspaceId,
  source,
  sources,
  collections,
  includeArchived,
  publications = [],
  publicationFolders = [],
  children,
}: {
  workspaceId: string;
  source: SourceView | null;
  sources?: SourceView[];
  collections: { source: SourceView; tree: KnowledgeTreeItem[] }[];
  includeArchived: boolean;
  publications?: readonly PublicationListItem[];
  publicationFolders?: readonly { folderNodeId: string; label: string }[];
  children: ReactNode;
}) {
  const headers = useMemo(() => sources ?? collections.map(c => c.source), [sources, collections]);
  const trees = useSourceTrees(workspaceId, headers, collections);
  const navigation = useContext(NavigationContext);
  const [explorerTarget, setExplorerTarget] = useState<HTMLElement | null>(null);
  const pathname = usePathname();
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const [explorerCollapsed, setExplorerCollapsed] = usePersistedJson("kh:explorer-collapsed", false, isBoolean);
  const showExplorerRef = useRef<HTMLButtonElement>(null);
  const overlayButtonRef = useRef<HTMLButtonElement>(null);
  const isDesktop = useIsWide(1024);
  const isWide = useIsWide(1280);
  // Between the narrow shell and the wide inline explorer, the explorer is a
  // drawer over the content instead of a 288px column. The CSS already hides
  // the inline column and shows the strip; this decides where the one
  // SourceSidebar instance renders. Closed, it stays mounted in the hidden
  // column: it is what records a document as Recent, at every width.
  const overlayExplorer = isDesktop && !isWide;
  const [overlayOpen, setOverlayOpen] = useState(false);
  useEffect(() => { if (!overlayExplorer) setOverlayOpen(false); }, [overlayExplorer]);
  // The palette, search, or Back can change the page without touching the drawer.
  useEffect(() => { setOverlayOpen(false); }, [pathname]);
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

  const sidebar = (
    <SourceSidebar
      workspaceId={workspaceId}
      source={source}
      collections={trees.collections}
      sources={headers}
      treeStates={trees.states}
      ensureTree={trees.ensure}
      retryTree={trees.retry}
      includeArchived={includeArchived}
      publications={publications}
      publicationFolders={publicationFolders}
      onCollapse={navigation?.mobileExplorerTarget || overlayExplorer ? undefined : () => toggleExplorer(true)}
    />
  );

  return (
    <InspectorContext.Provider value={{ open: inspectorOpen, setOpen: setInspectorOpen }}>
    <div className="flex h-full min-h-0 overflow-hidden">
      <div className={`hidden h-full shrink-0 xl:block ${explorerCollapsed ? "w-10" : "w-72"}`}>
        {explorerCollapsed ? (
          <div className="flex h-full justify-center border-r border-kh-border bg-kh-bg-explorer pt-2">
            <Tooltip label="Show documents" side="right">
              <button ref={showExplorerRef} type="button" aria-label="Show documents" onClick={() => toggleExplorer(false)} className={buttonClasses({ variant: "ghost", icon: true })}>
                <FolderTree className="h-4 w-4" aria-hidden="true" />
              </button>
            </Tooltip>
          </div>
        ) : null}
        {/* Hidden, not unmounted: open folders and the filter are as they were when it is shown again. */}
        <div ref={setExplorerTarget} className={explorerCollapsed ? "hidden" : "h-full"}>
          {!explorerTarget ? <div className="h-full border-r border-kh-border bg-kh-bg-explorer p-3"><TreeSkeleton /></div> : null}
        </div>
      </div>
      {/* The middle desktop range gets a strip and a drawer: the same explorer,
          without spending 288px of a 1024px window. */}
      <div className="hidden h-full w-10 shrink-0 flex-col items-center border-r border-kh-border bg-kh-bg-explorer pt-2 lg:flex xl:hidden">
        <Tooltip label="Show documents" side="right">
          <button ref={overlayButtonRef} type="button" aria-label="Show documents" aria-haspopup="dialog" aria-expanded={overlayOpen} onClick={() => setOverlayOpen(true)} className={buttonClasses({ variant: "ghost", icon: true })}>
            <FolderTree className="h-4 w-4" aria-hidden="true" />
          </button>
        </Tooltip>
      </div>
      {/* One explorer instance: avoid duplicate filter IDs and competing persisted state. */}
      {navigation?.mobileExplorerTarget ? createPortal(<div className="h-full" onClick={(event) => {
        if ((event.target as HTMLElement).closest("a") && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) navigation.closeNavigation();
      }}>{sidebar}</div>, navigation.mobileExplorerTarget) : explorerTarget && !(overlayExplorer && overlayOpen) ? createPortal(sidebar, explorerTarget) : null}
      {overlayExplorer ? (
        <Drawer side="left" open={overlayOpen} onOpenChange={(open) => {
          setOverlayOpen(open);
          if (!open) requestAnimationFrame(() => overlayButtonRef.current?.focus());
        }} title="Browse" surfaceClassName="bg-kh-bg-explorer">
          <div className="h-full [&>aside]:border-r-0" onClick={(event) => {
            if ((event.target as HTMLElement).closest("a") && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) setOverlayOpen(false);
          }}>{overlayOpen ? sidebar : null}</div>
        </Drawer>
      ) : null}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <PeekHost>
          <div ref={contentRef} className="min-h-0 min-w-0 flex-1 overflow-hidden overscroll-contain [&:not(:has([data-document-pane]))]:overflow-y-auto">
            <Suspense fallback={<DocumentSkeleton />}>{children}</Suspense>
          </div>
        </PeekHost>
      </div>
      <ShareLinkDialogHost />
      <PublishDialogHost />
      <FolderNameDialogHost />
      <MoveDialogHost collections={trees.collections} ensureTree={trees.ensure} retryTree={trees.retry} treeStates={trees.states} />
    </div>
    </InspectorContext.Provider>
  );
}
