"use client";

import type { ReactNode, Ref } from "react";

/** Shared geometry for a document and its loading state. */
export function DocumentPane({
  children,
  outline,
  inspector,
  inspectorOpen = false,
  contentRef,
  loading = false,
}: {
  children: ReactNode;
  outline?: ReactNode;
  inspector?: ReactNode;
  inspectorOpen?: boolean;
  contentRef?: Ref<HTMLDivElement>;
  loading?: boolean;
}) {
  return (
    <div data-document-pane className="flex h-full min-h-0 overflow-hidden bg-kh-bg">
      <div ref={contentRef} role="region" aria-label="Document content" aria-busy={loading || undefined} tabIndex={0}
        className="kh-document-pane min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain contain-layout kh-focus-ring">
        <div className="flex items-start">
          <div className="min-w-0 flex-1">{children}</div>
          {/* Reserve the wide-pane rail even for a document without headings.
              Its presence must not move the reading column during navigation. */}
          <div className="kh-outline-rail w-56 shrink-0 self-stretch">{outline}</div>
        </div>
      </div>
      {/* CSS reserves an open inspector's width before its media-query effect
          runs, and the loading state uses the same slot. Narrow drawers portal
          out of this wrapper and do not consume reading space. */}
      <div className={inspectorOpen ? "contents min-[1440px]:block min-[1440px]:h-full min-[1440px]:min-h-0 min-[1440px]:w-80 min-[1440px]:shrink-0" : "contents"}>
        {inspector}
      </div>
    </div>
  );
}
