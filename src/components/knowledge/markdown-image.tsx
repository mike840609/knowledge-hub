"use client";

import { useState } from "react";
import { ImageOff } from "lucide-react";
import { isAllowedMarkdownImageSrc } from "./markdown-image-policy";

export function MarkdownImage({ src, alt }: { src?: string; alt?: string }) {
  const [failed, setFailed] = useState(false);
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
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt ?? ""}
      loading="lazy"
      onError={() => setFailed(true)}
      className="my-4 h-auto max-w-full rounded-md border border-kh-border"
    />
  );
}
