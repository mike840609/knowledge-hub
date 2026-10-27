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
  // Closing slides the pane out to the right before it goes; focus then returns to what opened it.
  const [leaving, setLeaving] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const lastFocus = useRef<HTMLElement | null>(null);
  const close = useCallback(() => {
    setRequest(null);
    setExpanding(null);
    setLeaving(false);
  }, []);
  const startLeaving = useCallback(() => setLeaving(true), []);
  const finishLeaving = useCallback(() => {
    close();
    const active = document.activeElement;
    // Only where focus would otherwise be lost: inside the pane that is going, or nowhere.
    if (active && active !== document.body && !active.closest("[data-testid=\"side-peek\"]")) return;
    const target = opener.current?.isConnected
      ? opener.current
      : contentRef.current?.querySelector<HTMLElement>('[role="region"][aria-label="Document content"]');
    target?.focus();
  }, [close]);

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
        setLeaving(false);
        // The row the menu was opened on is what Close returns to. The menu still holds focus here, and
        // gives it back only after its own exit, so the row is the last focus outside menus and the peek.
        opener.current = lastFocus.current;
      }
    };
    const track = (event: FocusEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && !target.closest('[role="menu"], [data-testid="side-peek"]')) lastFocus.current = target;
    };
    window.addEventListener(PEEK_REQUEST_EVENT, open);
    document.addEventListener("focusin", track);
    return () => {
      window.removeEventListener(PEEK_REQUEST_EVENT, open);
      document.removeEventListener("focusin", track);
    };
  }, []);

  return (
    <>
      <div className="relative flex h-full min-h-0 min-w-0 flex-1 overflow-hidden">
        <div ref={contentRef} className="contents">{children}</div>
        {request && isWide ? (
          <div
            data-testid="side-peek"
            className={`kh-peek-pane min-h-0 min-w-0 flex-1 border-l border-kh-border ${expanding ? "kh-peek-expanding" : leaving ? "kh-peek-leaving" : ""}`}
            onAnimationEnd={(event) => {
              // The pane's own motion, not an animation inside the document bubbling up.
              if (event.target !== event.currentTarget) return;
              if (event.animationName === "kh-peek-expand") setExpanding((current) => (current ? { ...current, grown: true } : current));
              if (event.animationName === "kh-peek-leave") finishLeaving();
            }}
          >
            <PeekPane
              request={request}
              onClose={startLeaving}
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

