import { SHARED_DOCUMENT_ID } from "./share-paths";

const SHARED_READ = /^\/s\/[A-Za-z0-9_-]{1,128}$/;
/** A shared page or its opening route, with a folder page's `?d=<id>` and nothing else (folder share spec §4). */
const SHARED_RETURN = new RegExp(`^/s/[A-Za-z0-9_-]{1,128}(?:/open)?(?:\\?d=${SHARED_DOCUMENT_ID})?$`);
const WORKSPACE_RETURN = /^\/w\/[A-Za-z0-9-]+(?:\/[A-Za-z0-9._~/-]*)?$/;

export function isGooglePublicPath(pathname: string): boolean {
  if (pathname === "/login" || pathname === "/api/health" || pathname === "/s") return true;
  if (pathname.startsWith("/api/auth/")) return true;
  if (pathname.startsWith("/api/share-review/")) return true;
  if (pathname.startsWith("/sample-wiki/")) return true;
  return SHARED_READ.test(pathname);
}

/** Whether a sign-in may continue to this shared page or its opening route. */
export function isSharedReturn(value: string): boolean {
  return SHARED_RETURN.test(value);
}

/**
 * Only same-origin paths the app knows how to restore are accepted. Absolute
 * URLs, protocol-relative paths, and traversal segments all fall back to `/`.
 */
export function safeReturnTo(value: string | null | undefined): string {
  if (!value || value === "/") return "/";
  if (value.startsWith("//") || value.includes("..") || value.includes("\\")) return "/";
  if (WORKSPACE_RETURN.test(value) || isSharedReturn(value)) return value;
  return "/";
}

export type GoogleGateDecision =
  | { kind: "allow" }
  | { kind: "unauthorized" }
  | { kind: "redirect"; location: string };

export function googleGate(input: {
  pathname: string;
  search: string;
  hasSession: boolean;
}): GoogleGateDecision {
  if (isGooglePublicPath(input.pathname)) return { kind: "allow" };
  if (input.hasSession) return { kind: "allow" };
  if (input.pathname.startsWith("/api/")) return { kind: "unauthorized" };

  // A shared route keeps the query that names its document (`/s/:token/open?d=`); any other query is dropped.
  const withQuery = `${input.pathname}${input.search}`;
  const requested = input.pathname === "/" ? new URLSearchParams(input.search).get("returnTo") : isSharedReturn(withQuery) ? withQuery : input.pathname;
  const target = safeReturnTo(requested);
  return { kind: "redirect", location: `/login?returnTo=${encodeURIComponent(target)}` };
}
