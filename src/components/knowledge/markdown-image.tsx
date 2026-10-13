"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { Dialog } from "@base-ui-components/react/dialog";
import { Button, buttonClasses } from "@/components/ui/button";
import { dialogBackdropClasses, dialogPopupClasses } from "@/components/ui/dialog";
import { ImageOff } from "lucide-react";
import { isAllowedMarkdownImageSrc } from "./markdown-image-policy";

const ImageLinkContext = createContext(false);

/** Linked images retain their explicit destination instead of nesting interactive controls. */
export function LinkedImageScope({ children }: { children: ReactNode }) {
  return <ImageLinkContext.Provider value={true}>{children}</ImageLinkContext.Provider>;
}

export function MarkdownImage({ src, alt }: { src?: string; alt?: string }) {
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [naturalWidth, setNaturalWidth] = useState<number>();
  const linked = useContext(ImageLinkContext);
  // Issue #20: default-deny remote images. Blocked URLs render a "blocked"
  // placeholder and are never passed to <img>, so the browser issues no
  // request for them. Same-origin absolute URLs need the runtime origin.
  const blocked =
    !!src &&
    !isAllowedMarkdownImageSrc(src, {
      origin: typeof window !== "undefined" ? window.location.origin : undefined,
    });
  if (!src || blocked || failed) {
    const label = blocked
      ? alt
        ? `Image blocked: ${alt}`
        : "Image blocked"
      : alt
        ? `Image unavailable: ${alt}`
        : "Image unavailable";
    return (
      <span
        role="img"
        aria-label={label}
        data-blocked={blocked ? "true" : undefined}
        className="my-3 inline-flex max-w-full items-center gap-2 rounded-md bg-kh-bg-subtle px-2.5 py-1.5 text-caption text-kh-text-muted"
      >
        <ImageOff className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="truncate">{label}</span>
      </span>
    );
  }
  const thumbnail = (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt ?? ""} loading="lazy" onError={() => setFailed(true)} onLoad={event => setNaturalWidth(event.currentTarget.naturalWidth)} className="h-auto max-w-full rounded-md border border-kh-border" />
  );
  if (linked) return thumbnail;
  return (
    <Dialog.Root open={open} onOpenChange={(value) => { setOpen(value); if (!value) setZoom(1); }}>
      <Dialog.Trigger className="my-4 inline-block max-w-full cursor-zoom-in rounded-md kh-focus-ring" aria-label={alt ? `Enlarge image: ${alt}` : "Enlarge image"}>
        {thumbnail}
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop className={dialogBackdropClasses("z-[90]")} />
        <Dialog.Popup className={dialogPopupClasses("!z-[100] flex max-h-[94dvh] w-[94vw] flex-col")}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <Dialog.Title className="min-w-0 break-words text-title font-semibold">{alt || "Image preview"}</Dialog.Title>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="ghost" aria-label="Zoom out" disabled={zoom <= 1} onClick={() => setZoom(value => Math.max(1, value - 0.5))}>−</Button>
              <Button variant="ghost" aria-label="Reset zoom" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</Button>
              <Button variant="ghost" aria-label="Zoom in" disabled={zoom >= 3} onClick={() => setZoom(value => Math.min(3, value + 0.5))}>+</Button>
              <a href={src} target="_blank" rel="noopener noreferrer" className={buttonClasses({ variant: "ghost" })}>Open original</a>
              <Dialog.Close className={buttonClasses({ variant: "ghost" })}>Close</Dialog.Close>
            </div>
          </div>
          <Dialog.Description className="sr-only">Use zoom controls to inspect the image. Press Escape to close.</Dialog.Description>
          <div className="min-h-0 overflow-auto" tabIndex={0} role="region" aria-label="Image preview">
            <div style={{ width: `${zoom * 100}%` }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt={alt ?? ""} className="mx-auto h-auto max-w-full" style={{ width: naturalWidth ? naturalWidth * zoom : "auto", maxHeight: `${zoom * 70}dvh`, objectFit: "contain" }} />
            </div>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
