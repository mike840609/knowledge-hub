"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/** Counts down, then replaces the current entry (Back does not return to the dead address). */
export function RedirectCountdown({ href, seconds = 3, label }: { href: string; seconds?: number; label: string }) {
  const router = useRouter();
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    if (left <= 0) { router.replace(href); return; }
    const timer = setTimeout(() => setLeft(left - 1), 1000);
    return () => clearTimeout(timer);
  }, [left, href, router]);
  return <span aria-live="polite">{` Taking you to ${label} in ${left} second${left === 1 ? "" : "s"}…`}</span>;
}
