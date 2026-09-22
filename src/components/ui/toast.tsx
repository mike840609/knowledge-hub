"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { X } from "lucide-react";
import { buttonClasses } from "@/components/ui/button";

/**
 * One toast region, in a corner, over the page.
 *
 * Feedback used to be `role="status"` text rendered inside whichever panel
 * performed the mutation, which pushed the rest of that panel down as it
 * appeared — the reader's next click landed somewhere else. A fixed region
 * costs no layout, and being outside the panel it also survives the
 * `router.refresh()` that follows every mutation here.
 *
 * The announcement was never the problem: `role="status"` carries an implicit
 * `aria-live="polite"`. The region keeps both, and stays mounted whether or
 * not a toast is showing, because a live region inserted at the same moment
 * as its content is not reliably announced.
 */

export type ToastUndo = {
  /** Run the reverse operation. Rejecting is reported rather than swallowed. */
  run: () => Promise<void>;
  label?: string;
};

export type ToastRequest = {
  message: string;
  tone?: "default" | "danger";
  undo?: ToastUndo;
};

type ActiveToast = ToastRequest & { id: number; state: "idle" | "undoing" };

const ToastContext = createContext<((request: ToastRequest) => void) | null>(null);

export function useToast(): (request: ToastRequest) => void {
  const show = useContext(ToastContext);
  if (!show) throw new Error("Toasts require the Toast provider from the app shell.");
  return show;
}

/**
 * An undo is worth reading before it goes; a bare confirmation is not. Both
 * are held while the pointer or the keyboard is on the toast, so nothing is
 * taken away from someone who is reaching for it.
 */
const DISMISS_MS = { plain: 4_000, undoable: 9_000 };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ActiveToast | null>(null);
  const nextId = useRef(0);
  const held = useRef(false);
  const pathname = usePathname();

  const show = useCallback((request: ToastRequest) => {
    // One at a time: a queue would mean a reader's undo waiting behind
    // something they have already read.
    setToast({ ...request, id: (nextId.current += 1), state: "idle" });
  }, []);

  // A toast describes what just happened here. Somewhere else, it is litter.
  useEffect(() => setToast(null), [pathname]);

  useEffect(() => {
    if (!toast || toast.state === "undoing") return;
    const duration = toast.undo ? DISMISS_MS.undoable : DISMISS_MS.plain;
    let timer = window.setTimeout(function expire() {
      if (held.current) {
        timer = window.setTimeout(expire, 1_000);
        return;
      }
      setToast((current) => (current?.id === toast.id ? null : current));
    }, duration);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const runUndo = async () => {
    if (!toast?.undo || toast.state === "undoing") return;
    const { undo } = toast;
    setToast({ ...toast, state: "undoing" });
    try {
      await undo.run();
      setToast({ message: "Undone.", id: (nextId.current += 1), state: "idle" });
    } catch {
      setToast({
        message: "Could not undo that. Nothing else changed.",
        tone: "danger",
        id: (nextId.current += 1),
        state: "idle",
      });
    }
  };

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        onMouseEnter={() => { held.current = true; }}
        onMouseLeave={() => { held.current = false; }}
        onFocusCapture={() => { held.current = true; }}
        onBlurCapture={() => { held.current = false; }}
        className="pointer-events-none fixed bottom-4 right-4 z-[70] flex max-w-panel flex-col items-end"
      >
        {toast ? (
          <div
            key={toast.id}
            className={`pointer-events-auto flex items-center gap-3 rounded-lg border bg-kh-bg px-4 py-3 shadow-modal ${
              toast.tone === "danger" ? "border-kh-danger-border" : "border-kh-border"
            }`}
          >
            <p className={`text-body ${toast.tone === "danger" ? "text-kh-danger" : "text-kh-text"}`}>
              {toast.message}
            </p>
            {toast.undo ? (
              <button
                type="button"
                onClick={() => void runUndo()}
                disabled={toast.state === "undoing"}
                className={buttonClasses({ variant: "secondary", size: "sm" })}
              >
                {toast.state === "undoing" ? "Undoing…" : (toast.undo.label ?? "Undo")}
              </button>
            ) : null}
            <button
              type="button"
              aria-label="Dismiss notification"
              onClick={() => setToast(null)}
              className={buttonClasses({ variant: "ghost", icon: true, size: "sm" })}
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        ) : null}
      </div>
    </ToastContext.Provider>
  );
}
