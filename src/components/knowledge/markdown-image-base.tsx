"use client";

import { createContext, type ReactNode } from "react";

/** Where a document's relative images are served from; null leaves a `src` as written. */
export const MarkdownImageBase = createContext<string | null>(null);

export function MarkdownImageBaseProvider({ base, children }: { base: string; children: ReactNode }) {
  return <MarkdownImageBase.Provider value={base}>{children}</MarkdownImageBase.Provider>;
}

/** A relative `src` goes to the base, which resolves it on the server; a URL is never rewritten. */
export function imageUrl(base: string | null, src: string): string {
  return base && !/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(src.trim()) ? `${base}?src=${encodeURIComponent(src)}` : src;
}
