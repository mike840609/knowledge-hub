"use client";

import { Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import type { KnowledgeTreeItem, SourceView } from "@/modules/knowledge/application/knowledge-query-service";
import { SourceSidebar } from "./source-sidebar";
import { InspectorContext } from "./inspector-context";
import { Drawer } from "@/components/ui/drawer";
import { DocumentSkeleton, TreeSkeleton } from "./knowledge-skeletons";
import { useScrollRestoration } from "./use-scroll-restoration";
import { buttonClasses } from "@/components/ui/button";

function useDesktopLayout(): boolean {
  // Keep the server and first client render identical. Reading matchMedia in
  // the initializer causes a hydration mismatch on a narrow viewport.
  const [desktop, setDesktop] = useState(true);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 1024px)");
    const update = () => setDesktop(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return desktop;
}

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
  const desktop = useDesktopLayout();
  const pathname = usePathname();
  const [browseOpen, setBrowseOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const pathnameRef = useRef(pathname);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = () => setBrowseOpen(false);
    window.addEventListener("kh:open-inspector", close);
    window.addEventListener("kh:open-nav", close);
    return () => {
      window.removeEventListener("kh:open-inspector", close);
      window.removeEventListener("kh:open-nav", close);
    };
  }, []);

  useEffect(() => {
    if (pathnameRef.current !== pathname) {
      pathnameRef.current = pathname;
      setBrowseOpen(false);
    }
  }, [pathname]);

  useScrollRestoration(contentRef, pathname);

  useEffect(() => {
    const close = () => setInspectorOpen(false);
    window.addEventListener("kh:open-browse", close);
    window.addEventListener("kh:open-nav", close);
    return () => {
      window.removeEventListener("kh:open-browse", close);
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
      {desktop ? (
        <Suspense
          fallback={
            <aside aria-label="Knowledge explorer" className="w-72 shrink-0 border-r border-kh-border bg-kh-bg-sunken p-3">
              <TreeSkeleton />
            </aside>
          }
        >
          {sidebar}
        </Suspense>
      ) : null}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {desktop ? null : (
          <div className="shrink-0 border-b border-kh-border bg-kh-bg px-3 py-2">
            <button
              type="button"
              onClick={() => {
                if (browseOpen) {
                  setBrowseOpen(false);
                } else {
                  setBrowseOpen(true);
                  window.dispatchEvent(new CustomEvent("kh:open-browse"));
                }
              }}
              className={buttonClasses({ variant: "secondary" })}
            >
              Browse
            </button>
          </div>
        )}
        <div ref={contentRef} className="min-h-0 flex-1 overflow-hidden overscroll-contain [&:not(:has([data-document-pane]))]:overflow-y-auto">
          <Suspense fallback={<DocumentSkeleton />}>{children}</Suspense>
        </div>
      </div>
      <Drawer
        open={browseOpen}
        onOpenChange={setBrowseOpen}
        modal={false}
        title="Browse knowledge"
      >
        <div className="h-full" onClick={(event) => {
          const link = (event.target as HTMLElement).closest("a");
          if (link && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) setBrowseOpen(false);
        }}>
          <Suspense fallback={null}>{sidebar}</Suspense>
        </div>
      </Drawer>
    </div>
    </InspectorContext.Provider>
  );
}
