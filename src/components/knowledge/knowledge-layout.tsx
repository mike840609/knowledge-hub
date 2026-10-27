"use client";

import { Suspense, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import type { SourceCollection } from "./source-tree-cache";
import { SourceTreesContext } from "./use-source-trees";
import { InspectorContext } from "./inspector-context";
import { DocumentSkeleton } from "./knowledge-skeletons";
import { useScrollRestoration } from "./use-scroll-restoration";

/** The Knowledge content area. The sidebar, its trees and the dialogs its rows open belong to the shell. */
export function KnowledgeLayout({ collections, children }: { collections: SourceCollection[]; children: ReactNode }) {
  const trees = useContext(SourceTreesContext);
  const adopt = trees?.adopt;
  const pathname = usePathname();
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  // Before paint, so the sidebar draws the current source's tree instead of asking the server for it.
  useLayoutEffect(() => adopt?.(collections), [adopt, collections]);

  useScrollRestoration(contentRef, pathname);

  useEffect(() => {
    const close = () => setInspectorOpen(false);
    window.addEventListener("kh:open-nav", close);
    return () => {
      window.removeEventListener("kh:open-nav", close);
    };
  }, []);

  return (
    <InspectorContext.Provider value={{ open: inspectorOpen, setOpen: setInspectorOpen }}>
      <div className="flex h-full min-h-0 overflow-hidden">
        <div ref={contentRef} className="min-h-0 min-w-0 flex-1 overflow-hidden overscroll-contain [&:not(:has([data-document-pane]))]:overflow-y-auto">
          <Suspense fallback={<DocumentSkeleton />}>{children}</Suspense>
        </div>
      </div>
    </InspectorContext.Provider>
  );
}
