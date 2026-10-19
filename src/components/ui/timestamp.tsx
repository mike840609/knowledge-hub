"use client";

import { useEffect, useState } from "react";
import { SSR_TIME_ZONE, formatDate, formatDateTime, formatRelativeTime, formatShortTime } from "@/lib/format-date";

/**
 * A moment in time, shown in the reader's own zone.
 *
 * The server cannot know that zone — nothing in a request carries it — so this
 * renders twice on purpose. The first pass, on the server and again as the
 * first client render, formats in UTC so the two agree byte for byte and
 * React has nothing to reconcile. An effect then swaps in the browser's zone.
 *
 * The cost is honest and worth stating: for the moment before hydration, and
 * for a reader with JavaScript disabled, the visible zone is UTC. The
 * `dateTime` attribute always carries the exact instant, so what a machine
 * reads is never ambiguous. The alternative — resolving a zone server-side —
 * needs a stored preference or a company-wide zone, which is a product
 * decision this one is not.
 */
export function useDisplayTimeZone(): string {
  const [zone, setZone] = useState(SSR_TIME_ZONE);
  useEffect(() => {
    try {
      setZone(Intl.DateTimeFormat().resolvedOptions().timeZone || SSR_TIME_ZONE);
    } catch {
      // A runtime that cannot resolve its own zone keeps the agreed one.
    }
  }, []);
  return zone;
}

export function Timestamp({
  value,
  variant = "datetime",
  label,
  className,
}: {
  value: Date | string;
  /** `date` drops the time and moves it to the tooltip, for narrow columns; `short` is `5m`, `23h`, `Oct 12`. */
  variant?: "datetime" | "date" | "relative" | "short";
  /** Names the event in the tooltip ("Edited"), for a column too narrow to say it. */
  label?: string;
  className?: string;
}) {
  const zone = useDisplayTimeZone();
  const date = value instanceof Date ? value : new Date(value);
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (variant !== "relative" && variant !== "short") return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, [variant]);
  return (
    <time
      dateTime={date.toISOString()}
      title={variant !== "datetime" ? [label, formatDateTime(date, zone)].filter(Boolean).join(" ") : undefined}
      className={className}
    >
      {now !== null && variant === "relative" ? formatRelativeTime(Math.max(0, now - date.getTime()))
        : now !== null && variant === "short" ? formatShortTime(date, now, zone)
        : variant === "date" || variant === "short" ? formatDate(date, zone) : formatDateTime(date, zone)}
    </time>
  );
}
