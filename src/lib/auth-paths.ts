const SHARED_READ = /^\/s\/[A-Za-z0-9_-]{1,128}$/;
const SHARED_RETURN = /^\/s\/[A-Za-z0-9_-]{1,128}(?:\/open)?$/;
const WORKSPACE_RETURN = /^\/w\/[A-Za-z0-9-]+(?:\/[A-Za-z0-9._~/-]*)?$/;

export function isGooglePublicPath(pathname: string): boolean {
  if (pathname === "/login" || pathname === "/api/health" || pathname === "/s") return true;
  if (pathname.startsWith("/api/auth/")) return true;
  if (pathname.startsWith("/api/share-review/")) return true;
  if (pathname.startsWith("/sample-wiki/")) return true;
  return SHARED_READ.test(pathname);
}

/**
 * Only same-origin paths the app knows how to restore are accepted. Absolute
 * URLs, protocol-relative paths, and traversal segments all fall back to `/`.
 */
export function safeReturnTo(value: string | null | undefined): string {
  if (!value || value === "/") return "/";
  if (value.startsWith("//") || value.includes("..") || value.includes("\\")) return "/";
  if (WORKSPACE_RETURN.test(value) || SHARED_RETURN.test(value)) return value;
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

  const requested = input.pathname === "/" ? new URLSearchParams(input.search).get("returnTo") : input.pathname;
  const target = safeReturnTo(requested);
  return { kind: "redirect", location: `/login?returnTo=${encodeURIComponent(target)}` };
}
