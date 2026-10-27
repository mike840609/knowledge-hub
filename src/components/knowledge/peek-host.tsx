"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
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
  // "Open as full page": the pane grows left over the page while the route loads, and goes once both
  // the growth has finished and the route has moved on (or never will: the page was this document).
  const [expanding, setExpanding] = useState<{ from: string; to: string; grown: boolean } | null>(null);
  const close = useCallback(() => {
    setRequest(null);
    setExpanding(null);
  }, []);

  useEffect(() => {
    if (expanding?.grown && (pathname !== expanding.from || expanding.to === expanding.from)) close();
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
        {children}
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

