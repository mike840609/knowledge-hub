"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { Drawer } from "@/components/ui/drawer";

/** `inline`: the discussions are a rail beside the article (`review-rail-mode.ts`); otherwise they open as a drawer. */
export function ReviewPanelShell({ children, open, inline: wide, onOpenChange, returnFocus }: { children: ReactNode; open: boolean; inline: boolean; onOpenChange: (open: boolean) => void; returnFocus: () => void }) {
  const pendingThread = useRef<string | null>(null);
  const pendingPassage = useRef<(() => void) | null>(null);
  useEffect(() => {
    const show = (event: Event) => {
      pendingThread.current = (event as CustomEvent<string>).detail;
      pendingPassage.current = null;
      onOpenChange(true);
      if (wide) {
        const id = pendingThread.current;
        // Both native text highlights and margin buttons enter through this event.
        requestAnimationFrame(() => requestAnimationFrame(() => {
          const section = Array.from(document.querySelectorAll<HTMLElement>("[data-review-thread]"))
            .find(element => element.dataset.reviewThread === id && element.getClientRects().length > 0);
          section?.focus({ preventScroll: true });
          pendingThread.current = null;
        }));
      }
    };
    const hide = (event: Event) => {
      if (!open || wide) return;
      // Locate the passage after the modal has released focus and scroll locking.
      pendingPassage.current = (event as CustomEvent<() => void>).detail;
      event.preventDefault();
      onOpenChange(false);
    };
    document.addEventListener("review-focus-thread", show);
    document.addEventListener("review-focus-passage", hide);
    return () => {
      document.removeEventListener("review-focus-thread", show);
      document.removeEventListener("review-focus-passage", hide);
    };
  }, [open, wide, onOpenChange]);
  function afterTransition(isOpen: boolean) {
    if (isOpen && pendingThread.current) {
      const section = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"] [data-review-thread]'))
        .find(element => element.dataset.reviewThread === pendingThread.current);
      section?.focus({ preventScroll: true });
      section?.scrollIntoView({ block: "nearest" });
      pendingThread.current = null;
    } else if (!isOpen && pendingPassage.current) {
      const locate = pendingPassage.current;
      pendingPassage.current = null;
      locate();
    } else if (!isOpen && !wide) {
      returnFocus();
    }
  }
  return <>
    <div className={wide ? "h-full [&>div]:h-full" : "hidden"}>{children}</div>
    <Drawer open={open && !wide} onOpenChange={onOpenChange} onOpenChangeComplete={afterTransition} finalFocus={false} title="Comments" label="Close discussions">{children}</Drawer>
  </>;
}
