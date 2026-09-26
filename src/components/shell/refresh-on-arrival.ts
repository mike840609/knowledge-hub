"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

/**
 * A mutation that navigates to its own result needs the whole route rendered
 * again, not just the page. The push fetches the page fresh, but a layout the
 * two routes share (the knowledge sidebar, with its tree, favorites and
 * recents) is kept as it was, so it went on naming a document by the title it
 * had before the save.
 *
 * `router.refresh()` re-renders the layouts too, but not in the same breath as
 * the push: a navigate dispatched while a refresh is pending discards the
 * refresh, and a refresh sent alongside a push was measured leaving the reader
 * on the editor (#49). So the refresh waits for the destination to have
 * mounted, when there is no navigation left for it to race.
 *
 * Module state rather than storage: it only has to survive a client
 * navigation, and a full load renders everything fresh anyway.
 */
let pendingPathname: string | null = null;

/** Call before pushing to `href`; the page there refreshes once it has mounted. */
export function refreshOnArrival(href: string): void {
  pendingPathname = new URL(href, window.location.origin).pathname;
}

/** Mounted by a page a mutation may navigate to. */
export function useRefreshOnArrival(): void {
  const pathname = usePathname();
  const router = useRouter();
  useEffect(() => {
    if (pendingPathname !== pathname) return;
    pendingPathname = null;
    router.refresh();
  }, [pathname, router]);
}
