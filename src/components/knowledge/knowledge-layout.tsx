"use client";

import { Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { InspectorContext } from "./inspector-context";
import { DocumentSkeleton } from "./knowledge-skeletons";
import { useScrollRestoration } from "./use-scroll-restoration";

export function KnowledgeLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  useScrollRestoration(contentRef, pathname);

  useEffect(() => {
    const close = () => setInspectorOpen(false);
    window.addEventListener("kh:open-nav", close);
    return () => window.removeEventListener("kh:open-nav", close);
  }, []);

  return (
    <InspectorContext.Provider value={{ open: inspectorOpen, setOpen: setInspectorOpen }}>
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
        <div ref={contentRef} className="min-h-0 flex-1 overflow-hidden overscroll-contain [&:not(:has([data-document-pane]))]:overflow-y-auto">
          <Suspense fallback={<DocumentSkeleton />}>{children}</Suspense>
        </div>
      </div>
    </InspectorContext.Provider>
  );
}
