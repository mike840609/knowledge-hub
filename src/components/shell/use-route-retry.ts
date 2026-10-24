"use client";

import { useRouter } from "next/navigation";
import { startTransition } from "react";

/**
 * Retry for a route error boundary. `reset()` alone re-renders the segment from
 * the server payload already on the client, so a read that failed on the server
 * fails again; refreshing first fetches the segment anew.
 */
export function useRouteRetry(reset: () => void) {
  const router = useRouter();
  return () => startTransition(() => { router.refresh(); reset(); });
}
