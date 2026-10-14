"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { REVIEW_TOGGLE_SHORTCUT } from "@/components/actions/action-registry";
import { isSingleKeyShortcut } from "@/lib/shortcut-keys";

/**
 * `D` opens and closes the discussions, wherever a single key may act (not in a field, a dialog or
 * a menu — so not from the drawer the discussions are on a narrow window, which Esc closes).
 * `toggle` is absent where there is no control to press either.
 */
export function useReviewToggleKey(toggle: (() => void) | undefined) {
  useEffect(() => {
    if (!toggle) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.key.toLowerCase() !== REVIEW_TOGGLE_SHORTCUT.toLowerCase() || !isSingleKeyShortcut(event)) return;
      event.preventDefault();
      toggle();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [toggle]);
}

/** What the document's header needs to offer a way into its discussions. */
export type ReviewEntry = {
  /** Every discussion, and those still open — what the owner's list shows by default, so what the control shows. */
  count: number;
  awaiting: number;
  /** Share-link comments the owner has not seen; clears when the panel opens. */
  unread: number;
  open: boolean;
  toggle: () => void;
};

type Shared = {
  entry: ReviewEntry | null;
  publish: (entry: ReviewEntry | null) => void;
  /** The header's control, so the panel can hand focus back to it on closing. */
  buttonRef: RefObject<HTMLButtonElement | null>;
};

const Context = createContext<Shared | null>(null);

/**
 * Joins the discussions panel, which is under the article, to the document's header, which is
 * above it: the panel says how many discussions there are and whether they are open, and the
 * header draws the control. The header is pinned, so the control is in reach wherever the reader
 * is, and it is chrome that was already there, so a document's discussions arriving move nothing.
 */
export function ReviewEntryProvider({ children }: { children: ReactNode }) {
  const [entry, publish] = useState<ReviewEntry | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const shared = useMemo(() => ({ entry, publish, buttonRef }), [entry]);
  return <Context value={shared}>{children}</Context>;
}

export function useReviewEntry(): Shared | null {
  return useContext(Context);
}
