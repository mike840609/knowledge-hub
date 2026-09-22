"use client";

import { useEffect, useState } from "react";
import { SSR_TIME_ZONE, formatDate, formatDateTime } from "@/lib/format-date";

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
  className,
}: {
  value: Date | string;
  /** `date` drops the time and moves it to the tooltip, for narrow columns. */
  variant?: "datetime" | "date";
  className?: string;
}) {
  const zone = useDisplayTimeZone();
  const date = value instanceof Date ? value : new Date(value);
  return (
    <time
      dateTime={date.toISOString()}
      title={variant === "date" ? formatDateTime(date, zone) : undefined}
      className={className}
    >
      {variant === "date" ? formatDate(date, zone) : formatDateTime(date, zone)}
    </time>
  );
}
