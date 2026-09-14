"use client";

import { useState } from "react";
import { ImageOff } from "lucide-react";

export function MarkdownImage({ src, alt }: { src?: string; alt?: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <span
        role="img"
        aria-label={alt ? `Image unavailable: ${alt}` : "Image unavailable"}
        className="my-4 flex w-full items-center justify-center gap-2 rounded-md border border-kh-border bg-kh-bg-subtle px-4 py-8 text-sm text-kh-text-muted"
      >
        <ImageOff className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="truncate">{alt ? `Image unavailable: ${alt}` : "Image unavailable"}</span>
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
