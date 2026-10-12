"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Drawer } from "@/components/ui/drawer";

export function ReviewPanelShell({ children, open, onOpenChange, returnFocus }: { children: ReactNode; open: boolean; onOpenChange: (open: boolean) => void; returnFocus: () => void }) {
  const [wide, setWide] = useState(false);
  const pendingThread = useRef<string | null>(null);
  const pendingPassage = useRef<(() => void) | null>(null);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 1200px)");
    const update = () => setWide(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    const show = (event: Event) => {
      pendingThread.current = (event as CustomEvent<string>).detail;
      pendingPassage.current = null;
      onOpenChange(true);
      if (window.matchMedia("(min-width: 1200px)").matches) {
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
    <div className="hidden h-full min-[1200px]:block [&>div]:h-full">{children}</div>
    <Drawer open={open && !wide} onOpenChange={onOpenChange} onOpenChangeComplete={afterTransition} finalFocus={false} title="Comments" label="Close discussions">{children}</Drawer>
  </>;
}
