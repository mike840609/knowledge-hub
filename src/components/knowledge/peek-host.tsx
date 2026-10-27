"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { PeekDialog } from "./peek-dialog";
import { PeekPane } from "./peek-pane";
import { PEEK_REQUEST_EVENT, type PeekRequest } from "./peek-request";
import { useIsWide } from "./use-is-wide";

/**
 * Answers requestPeek() for the page it wraps: a 50/50 split beside `children` from lg, the Drawer
 * below. Every page whose rows offer "Open in side peek" — the knowledge layout and Home — mounts one;
 * a page without one would offer an action that does nothing.
 */
export function PeekHost({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<PeekRequest | null>(null);
  const isWide = useIsWide();
  const pathname = usePathname();
  // "Open as full page": the pane grows left over the page while the route loads, and goes once the
  // growth has finished and the page has arrived — the route moved on *and* its content is no longer
  // the loading skeleton (`aria-busy`), which `loading.tsx` commits first — or never will move: the page
  // was this document. Going on the route change alone uncovered that skeleton, which read as a reload.
  const [expanding, setExpanding] = useState<{ from: string; to: string; grown: boolean } | null>(null);
  const close = useCallback(() => {
    setRequest(null);
    setExpanding(null);
  }, []);

  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!expanding?.grown) return;
    if (expanding.to === expanding.from) return close();
    const content = contentRef.current;
    if (pathname === expanding.from || !content) return;
    const arrived = () => !content.querySelector('[role="region"][aria-label="Document content"][aria-busy="true"]');
    if (arrived()) return close();
    const observer = new MutationObserver(() => { if (arrived()) close(); });
    observer.observe(content, { subtree: true, childList: true, attributes: true, attributeFilter: ["aria-busy"] });
    return () => observer.disconnect();
  }, [expanding, pathname, close]);

  useEffect(() => {
    const open = (event: Event) => {
      const detail = (event as CustomEvent<Partial<PeekRequest>>).detail;
      if (typeof detail?.documentId === "string" && typeof detail?.sourceId === "string") {
        setRequest({ documentId: detail.documentId, sourceId: detail.sourceId });
      }
    };
    window.addEventListener(PEEK_REQUEST_EVENT, open);
    return () => window.removeEventListener(PEEK_REQUEST_EVENT, open);
  }, []);

  return (
    <>
      <div className="relative flex h-full min-h-0 min-w-0 flex-1">
        <div ref={contentRef} className="contents">{children}</div>
        {request && isWide ? (
          <div
            data-testid="side-peek"
            className={`min-h-0 min-w-0 flex-1 border-l border-kh-border ${expanding ? "kh-peek-expanding" : ""}`}
            onAnimationEnd={(event) => {
              // The pane's own growth, not an animation inside the document bubbling up.
              if (event.target !== event.currentTarget) return;
              setExpanding((current) => (current ? { ...current, grown: true } : current));
            }}
          >
            <PeekPane
              request={request}
              onClose={close}
              onOpenFullPage={(to) => setExpanding({ from: pathname, to, grown: false })}
            />
          </div>
        ) : null}
      </div>
      {request && !isWide ? (
        <PeekDialog
          request={request}
          onOpenChange={(next) => {
            if (!next) close();
          }}
        />
      ) : null}
    </>
  );
}

