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
/** The path being left, when the destination is not known: see `refreshOnArrivalElsewhere`. */
let pendingLeaving: string | null = null;

/** Call before pushing to `href`; the page there refreshes once it has mounted. */
export function refreshOnArrival(href: string): void {
  pendingPathname = new URL(href, window.location.origin).pathname;
}

/**
 * For a push whose destination the caller cannot name, because the route it pushes to redirects:
 * archiving the document that is open sends the reader to its source, which sends them on to the
 * first document there, or to an empty state. Whichever it is, that destination refreshes once
 * its page has committed, rather than when the redirect's URL first appears.
 */
export function refreshOnArrivalElsewhere(): void {
  pendingLeaving = window.location.pathname;
}

/** Pass the path belonging to the page's server data, so a pending navigation is not an arrival. */
export function useRefreshOnArrival(readyPathname: string): void {
  const pathname = usePathname();
  const router = useRouter();
  useEffect(() => {
    // A shared layout (or the previous document kept during a transition) can see the new
    // pathname before its page has committed. Refreshing then races the push/redirect.
    if (pathname !== readyPathname) return;
    if (pendingPathname === pathname) {
      pendingPathname = null;
      router.refresh();
    } else if (pendingLeaving !== null && pendingLeaving !== pathname) {
      pendingLeaving = null;
      router.refresh();
    }
  }, [pathname, readyPathname, router]);
}

/** For a server-rendered destination with no document inspector, such as an empty source. */
export function RefreshOnArrival({ pathname }: { pathname: string }) {
  useRefreshOnArrival(pathname);
  return null;
}
