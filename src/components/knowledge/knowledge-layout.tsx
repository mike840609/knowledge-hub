"use client";

import { Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import type { KnowledgeTreeItem, SourceView } from "@/modules/knowledge/application/knowledge-query-service";
import { SourceSidebar } from "./source-sidebar";
import { Drawer } from "@/components/ui/drawer";
import { Skeleton } from "@/components/ui/skeleton";

function useDesktopLayout(): boolean {
  const [desktop, setDesktop] = useState<boolean>(
    () => typeof window === "undefined" || window.matchMedia("(min-width: 1024px)").matches,
  );
  useEffect(() => {
    const query = window.matchMedia("(min-width: 1024px)");
    const update = () => setDesktop(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return desktop;
}

function DocumentRegionSkeleton() {
  return (
    <div className="mx-auto w-full max-w-[860px] px-6 py-6" aria-hidden="true">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="mt-3 h-7 w-2/3" />
      <div className="mt-3 flex gap-2">
        <Skeleton className="h-5 w-16" />
        <Skeleton className="h-5 w-44" />
      </div>
      <div className="mt-6 space-y-3">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    </div>
  );
}

export function KnowledgeLayout({
  workspaceId,
  sources,
  source,
  tree,
  includeArchived,
  children,
}: {
  workspaceId: string;
  sources: SourceView[];
  source: SourceView;
  tree: KnowledgeTreeItem[];
  includeArchived: boolean;
  children: ReactNode;
}) {
  const desktop = useDesktopLayout();
  const pathname = usePathname();
  const [browseOpen, setBrowseOpen] = useState(false);
  const pathnameRef = useRef(pathname);

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

  const sidebar = (
    <SourceSidebar
      workspaceId={workspaceId}
      sources={sources}
      source={source}
      tree={tree}
      includeArchived={includeArchived}
    />
  );

  return (
    <div className="flex min-h-0 flex-1">
      {desktop ? (
        <Suspense
          fallback={
            <aside aria-label="Knowledge explorer" className="w-72 shrink-0 border-r border-kh-border bg-kh-bg p-3">
              <p className="text-sm text-kh-text-muted">Loading source tree…</p>
            </aside>
          }
        >
          {sidebar}
        </Suspense>
      ) : null}
      <div className="min-w-0 flex-1">
        {desktop ? null : (
          <div className="border-b border-kh-border bg-kh-bg px-3 py-2">
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
              className="inline-flex h-8 items-center rounded-md border border-kh-border bg-kh-bg px-3 text-[13px] font-medium text-kh-text hover:bg-kh-bg-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-kh-accent"
            >
              Browse
            </button>
          </div>
        )}
        <Suspense fallback={<DocumentRegionSkeleton />}>{children}</Suspense>
      </div>
      <Drawer
        open={browseOpen}
        onOpenChange={setBrowseOpen}
        modal={false}
        title="Browse knowledge"
      >
        <Suspense fallback={null}>{sidebar}</Suspense>
      </Drawer>
    </div>
  );
}
