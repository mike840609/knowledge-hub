"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
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
  const close = useCallback(() => setRequest(null), []);

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
      <div className="flex h-full min-h-0 min-w-0 flex-1">
        {children}
        {request && isWide ? (
          <div data-testid="side-peek" className="min-h-0 min-w-0 flex-1 border-l border-kh-border">
            <PeekPane request={request} onClose={close} />
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

