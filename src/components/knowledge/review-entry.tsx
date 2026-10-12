"use client";

import { createContext, useContext, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";

/** What the document's header needs to offer a way into its discussions. */
export type ReviewEntry = { count: number; open: boolean; toggle: () => void };

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
