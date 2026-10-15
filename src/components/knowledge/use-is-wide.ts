"use client";

import { useEffect, useState } from "react";

/**
 * Whether the viewport is at least `breakpoint` wide. Starts narrow so the
 * server and the first client render agree; the measured value applies in an
 * effect. The knowledge layout uses it to choose the side-peek split (>=lg)
 * over the Drawer dialog.
 */
export function useIsWide(breakpoint = 1024): boolean {
  const [isWide, setIsWide] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(`(min-width: ${breakpoint}px)`);
    const update = () => setIsWide(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, [breakpoint]);
  return isWide;
}
