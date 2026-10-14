"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { Tooltip } from "@base-ui-components/react/tooltip";

type Preview = { title: string; excerpt: string };

export function DocumentPreviewLink({ documentId, href, title, note, className, children }: {
  documentId: string; href: string; title: string; note?: string; className: string; children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setPreview(null);
    setFailed(false);
    void fetch(`/api/documents/${encodeURIComponent(documentId)}/preview`, { signal: controller.signal, cache: "no-store" })
      .then(async response => {
        if (!response.ok) throw new Error("Preview unavailable");
        const result: Preview = await response.json();
        if (!controller.signal.aborted) setPreview(result);
      })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [open, documentId]);

  return <Tooltip.Root open={open} onOpenChange={value => { setOpen(value); setPreview(null); setFailed(false); }}>
    <Tooltip.Trigger render={<Link href={href} prefetch={false} className={className} />} delay={400}>{children}</Tooltip.Trigger>
    <Tooltip.Portal>
      <Tooltip.Positioner side="bottom" align="start" sideOffset={8} className="z-[80]">
        <Tooltip.Popup className="max-w-[min(22rem,90vw)] rounded-lg border border-kh-border bg-kh-bg-raised p-3 text-body-sm text-kh-text shadow-popover">
          <span className="block font-semibold">{preview?.title ?? title}</span>
          {note ? <span className="block text-kh-text-muted">{note}</span> : null}
          <span className="mt-1 block whitespace-normal break-words text-kh-text-muted" aria-live="polite">{failed ? "Preview unavailable. Open the link to view the document." : preview ? preview.excerpt || "This document has no text to preview." : "Loading preview…"}</span>
        </Tooltip.Popup>
      </Tooltip.Positioner>
    </Tooltip.Portal>
  </Tooltip.Root>;
}
